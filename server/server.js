import 'dotenv/config';
import express from 'express';
// MUST be imported before any router: patches Express 4 so a rejected
// promise inside an `async (req, res) => {...}` route handler is forwarded
// to the error-handling middleware below, instead of silently hanging the
// request forever (client sees "pending" with no response, no error, no
// timeout — this was happening on /api/auth/login and any other route
// whenever a DB query was slow/failed, e.g. Render/Neon free-tier cold
// starts or connection drops).
import 'express-async-errors';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import authRouter, { JWT_SECRET } from './routes/auth.js';
import matchesRouter from './routes/matches.js';
import betsRouter from './routes/bets.js';
import adminRouter from './routes/admin.js';
import agentRouter from './routes/agent.js';
import casinoRouter from './routes/casino.js';
import scrapeRouter from './routes/scrape.js';
import favoritesRouter from './routes/favorites.js';
import { initDb, cleanupOldData } from './db.js';
import { mapDbError } from './dbErrors.js';
import { initWebSocket } from './ws.js';
import { refreshLiveTracker, logLondon365FilterConfig, startLondon365LiveLoop, ensureLondon365Import, repairSparseEvents, purgeExcludedCountries, purgeStaleLeagues, purgeLegacyLeagueKeyFormat, purgeCountryPrefixedDuplicateLeagues, purgeCrossCountryMisclassifiedLeagues, purgeCountriesNotInOnlyList, wipeLondon365Data, loadPersistedLeagueMap, startGameDetailsSubscriptionReconcileLoop, getLondon365MemoryDiagnostics } from './london365.js';
import { startLondon365Socket, startLondon365GameDetailsSocket, getSocketMemoryDiagnostics } from './london365Socket.js';
import { getGameDetailsMemoryDiagnostics } from './london365GameDetails.js';
import { getMatchesResponseCacheSize } from './routes/matches.js';
import { startKeepAliveSelfPing } from './keepAlive.js';
import { startFeedStatsLog } from './feedStats.js';
import { hydrateBetMatchIds } from './oddsHistoryPolicy.js';

let dbReady = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, '..', 'dist');

const app = express();
// Render (and most PaaS hosts) sit behind a reverse proxy that sets
// X-Forwarded-For. Without this, express-rate-limit throws
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR because it can't safely trust that
// header. `1` = trust exactly one hop (Render's own proxy), not arbitrary
// client-supplied headers.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

app.use(helmet());
// Bandwidth is metered on Render's free tier (5 GB/month) — the API
// responses here are JSON (matches list, odds, live ticks), which
// compresses very well. Cuts outbound bytes ~70-80% at negligible CPU
// cost, so it's on for every response, not just the biggest ones.
app.use(compression());
// Restrict cross-origin requests to known frontend origin(s). Falls back to
// allowing all origins only when FRONTEND_ORIGIN is unset (e.g. local dev
// where frontend and API are served together on one origin anyway).
const allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use('/api', cors(
  allowedOrigins.length
    ? {
        origin: (origin, callback) => {
          // Allow same-origin/non-browser requests (no Origin header) and
          // any explicitly whitelisted origin.
          if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
          callback(new Error('Not allowed by CORS'));
        },
      }
    : undefined
));
app.use(express.json());

// Brute-force protection on auth endpoints: 20 attempts / 15 min per IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Shumë përpjekje. Provo përsëri pas disa minutash.' },
});

// Key by the AUTHENTICATED USER when the request carries a valid JWT,
// falling back to IP only for logged-out requests. Keying by IP alone (the
// old behavior) meant every device sharing a public IP — same WiFi/office,
// or a mobile carrier's shared/CGNAT IP, which is common — drew from the
// SAME 120-req/min bucket. In practice that meant a second admin (or any
// second user) opening the site could exhaust the shared bucket and make
// the FIRST person's session appear to silently stop working, even though
// nothing was wrong with their own usage. Per-user keys mean one person's
// traffic can never count against another's, no matter how many people
// share a network.
function keyByUserOrIp(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const { id } = jwt.verify(token, JWT_SECRET);
      if (id) return 'user:' + id;
    } catch {
      // invalid/expired token — fall through to IP-based keying below
    }
  }
  return req.ip;
}

// General API protection: generous enough for normal browsing/polling, but
// stops scripted abuse (e.g. spam bet placement, scraping matches on a tight
// loop) from one identity.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  message: { error: 'Shumë kërkesa. Provo përsëri pas pak.' },
});

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/bets', betsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/agent', agentRouter);
app.use('/api/casino', casinoRouter);
app.use('/api/scrape', scrapeRouter);
app.use('/api/favorites', favoritesRouter);

// Catch-all error handler: any unhandled error thrown/rejected inside a route
// (e.g. Postgres unreachable, quota exceeded) returns a clean 503 instead of
// crashing the entire Node process (which was causing full 502s + restart
// loops on transient DB issues).
app.use((err, req, res, next) => {
  console.error('[unhandled route error]', (err && err.code ? '[' + err.code + '] ' : '') + (err && err.message), req.method, req.originalUrl);
  if (res.headersSent) return next(err);
  const mapped = mapDbError(err);
  res.status(mapped.status).json(mapped.body);
});

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

// Without this, a synchronous throw ANYWHERE outside a promise chain (a bad
// property access in a socket/timer callback, a bug in a library) has
// nowhere to go but Node's default handler, which kills the entire process
// immediately with no useful log beyond a bare stack trace, and Render then
// has to fully cold-boot a replacement. Logging and staying up mirrors the
// posture already taken for unhandledRejection and the DB pool's own
// 'error' listener above (in db.js) — this app treats an unexpected error
// in one code path as something to survive and report, not a reason to take
// every live match/bet/socket connection down with it. Node's process state
// can in theory be left inconsistent after an uncaughtException, but for
// this app (no in-memory financial state that isn't also durably in
// Postgres) that risk is far smaller than the cost of an avoidable full
// restart on every transient bug.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

app.get('/api/health', (req, res) => res.status(dbReady ? 200 : 503).json({ ok: true, db: dbReady ? 'up' : 'down' }));

// Mobile-friendly, no-login diagnostic: open this URL directly in any
// browser address bar (no console, no fetch, no CORS, no Bearer token) to
// see the same data as /api/admin/london365/status. Protected by a static
// key (LONDON365_STATUS_KEY env var) instead of a JWT specifically so it can
// be a plain URL. Disabled entirely (404) unless that env var is set.
app.get('/api/london365-status', async (req, res) => {
  const key = process.env.LONDON365_STATUS_KEY;
  if (!key) return res.status(404).json({ error: 'not enabled — set LONDON365_STATUS_KEY to use this' });
  if (req.query.key !== key) return res.status(403).json({ error: 'wrong key' });
  const { getLondon365Status } = await import('./london365.js');
  res.json(await getLondon365Status());
});

// Serve the built frontend (npm run build -> dist/) from the same origin/process
// as the API. This avoids CORS and cross-domain /api URL issues in production.
// If dist/ doesn't exist (e.g. pure API-only deploy), this is skipped silently.
if (fs.existsSync(distPath)) {
  const indexHtmlPath = path.join(distPath, 'index.html');
  console.log(`[static] Serving frontend from ${distPath} (index.html present: ${fs.existsSync(indexHtmlPath)})`);
  app.use(express.static(distPath));
  app.get(/^(?!\/api\/).*/, (req, res) => {
    if (!fs.existsSync(indexHtmlPath)) {
      console.error(`[static] index.html missing at ${indexHtmlPath} — did "npm run build" actually run?`);
      return res.status(500).send('Frontend build not found on server (dist/index.html missing). Check build logs.');
    }
    res.sendFile(indexHtmlPath);
  });
} else if (process.env.PUBLIC_FRONTEND_URL) {
  // Expected/intentional in an API-only deploy (Build Command skips
  // "vite build" on purpose so this service never serves the JS/CSS
  // bundle itself -- see the bandwidth note above PUBLIC_FRONTEND_URL in
  // .env.example). Anyone still landing on this bare API URL for a page
  // (not an /api or /ws request) gets sent to wherever the frontend
  // actually lives (e.g. the Netlify deploy) instead of a raw 404/500.
  const frontendUrl = process.env.PUBLIC_FRONTEND_URL.replace(/\/$/, '');
  console.log(`[static] No local dist/ -- redirecting non-API requests to ${frontendUrl}`);
  app.get(/^(?!\/api\/|\/ws).*/, (req, res) => res.redirect(302, frontendUrl));
} else {
  console.error(`[static] dist/ not found at ${distPath} — run "npm run build" before starting the server, or check your Build Command, or set PUBLIC_FRONTEND_URL to redirect instead.`);
}

async function start() {
  console.log(
    '[boot] commit=' + (process.env.RENDER_GIT_COMMIT || 'unknown') +
    ' branch=' + (process.env.RENDER_GIT_BRANCH || 'unknown') +
    ' service=' + (process.env.RENDER_SERVICE_NAME || 'unknown')
  );
  if (process.env.DATABASE_URL) {
    try {
      const u = new URL(process.env.DATABASE_URL);
      console.log('[boot] DATABASE_URL -> host=' + u.hostname + ' port=' + (u.port || '5432') + ' database=' + u.pathname.replace(/^\//, ''));
    } catch (err) {
      console.error('[boot] DATABASE_URL is set but failed to parse:', err.message);
    }
  } else {
    console.error('[boot] DATABASE_URL is NOT set — every DB query will fail.');
  }

  try {
    await initDb();
    dbReady = true;
    console.log('[db] connected and initialized');
  } catch (err) {
    dbReady = false;
    console.error('[db] init failed; starting server without database:', err);
  }

  const httpServer = app.listen(PORT, () => {
    console.log(`365sim backend listening on http://localhost:${PORT}`);
    if (!process.env.JWT_SECRET) {
      console.error(
        'SECURITY WARNING: JWT_SECRET is not set. Using an insecure hardcoded fallback ' +
        'means ANYONE can forge a valid admin login token. Set JWT_SECRET in your ' +
        'environment (Render: Environment tab -> Generate) before letting real users in.'
      );
    }
  });
  initWebSocket(httpServer);

  // LondonPro365 provider: seed the full catalog in the background (throttled,
  // never blocks startup), start the in-play REST safety-net loop, and open the
  // native Socket.IO feed for sub-second odds/score/lifecycle updates.
  //
  // LONDON365_FORCE_RESET=1 wipes every l365 row + cursor/cache BEFORE any of
  // that starts, so the next import is a genuinely clean slate instead of
  // layering on top of however much has accumulated across every past fix.
  // Remove the env var again after one successful deploy with it set — it's
  // not meant to run on every boot.
  // Print the EFFECTIVE catalogue filter once at boot (whitelist, MAJOR_ONLY,
  // FULL, cap...) so what is actually being imported is never a guess.
  logLondon365FilterConfig();
  const bootPurges = [];
  (async () => {
    if (process.env.LONDON365_FORCE_RESET === '1') {
      try {
        await wipeLondon365Data();
      } catch (err) {
        console.error('[server] wipeLondon365Data failed:', err.message);
      }
    }
    // Load "which matches do we hold / which are live / which have bets" into
    // memory BEFORE the sockets start filtering on it. Until each finishes the
    // corresponding check is fail-open (old behaviour), so a slow/failed load
    // can never cause updates to be dropped.
    await refreshLiveTracker().catch((err) => console.error('[server] refreshLiveTracker failed:', err.message));
    await hydrateBetMatchIds().catch((err) => console.error('[server] hydrateBetMatchIds failed:', err.message));
    ensureLondon365Import();
    loadPersistedLeagueMap().catch((err) => console.error('[server] loadPersistedLeagueMap failed:', err.message));
    bootPurges.push(
      purgeExcludedCountries().catch((err) => console.error('[server] purgeExcludedCountries failed:', err.message)),
      purgeStaleLeagues().catch((err) => console.error('[server] purgeStaleLeagues failed:', err.message)),
      purgeLegacyLeagueKeyFormat().catch((err) => console.error('[server] purgeLegacyLeagueKeyFormat failed:', err.message))
    );
    // Legacy rows from before the catalogue filter (Zambia, India, youth...) were
    // loaded into the in-memory tracker above; once the boot purges have removed
    // them, reload it so the global GameDetails / odds feeds stop treating them as
    // "ours" (they would otherwise still cost a lookup until the next import).
    await Promise.allSettled(bootPurges);
    await refreshLiveTracker().catch((err) => console.error('[server] refreshLiveTracker (post-purge) failed:', err.message));
  })();
  // Runs against whatever leagueById the persisted map just restored — a
  // second, fuller pass happens automatically at the end of every completed
  // import (once leagueNameIndex has this run's real data), this is just
  // for immediate cleanup right after boot using last run's saved map.
  bootPurges.push(
    purgeCountryPrefixedDuplicateLeagues().catch((err) => console.error('[server] purgeCountryPrefixedDuplicateLeagues failed:', err.message)),
    purgeCrossCountryMisclassifiedLeagues().catch((err) => console.error('[server] purgeCrossCountryMisclassifiedLeagues failed:', err.message)),
    purgeCountriesNotInOnlyList().catch((err) => console.error('[server] purgeCountriesNotInOnlyList failed:', err.message))
  );
  startFeedStatsLog();
  startLondon365LiveLoop();
  startLondon365Socket();
  startLondon365GameDetailsSocket();
  // Fix for the "purge*() orphans a LIVE gamedetails subscription -> fast
  // runaway feed -> heap OOM within ~10 minutes" bug. See the comment on
  // startGameDetailsSubscriptionReconcileLoop in london365.js.
  startGameDetailsSubscriptionReconcileLoop();
  // Periodically restore full market detail for events whose initial detail
  // fetch failed (provider rate limits on hosting). Without this, most
  // LondonPro365 matches on Render only show the sparse 1-4 list-level
  // markets instead of the full catalog.
  setTimeout(function () { repairSparseEvents({ limit: 40 }).catch(function () {}); }, 45 * 1000);
  setInterval(function () { repairSparseEvents({ limit: 40 }).catch(function () {}); }, 3 * 60 * 1000);

  // Diagnostic visibility requested after the OOM crash investigation:
  // logs process memory alongside every known unbounded-risk in-memory
  // cache's current size, so a future leak shows up in Render logs as a
  // steadily growing number long before it crashes the process, instead
  // of only being discoverable after the fact from a heap dump.
  setInterval(function () {
    const mem = process.memoryUsage();
    const toMB = (n) => Math.round(n / 1024 / 1024);
    console.log('[memory] rss=' + toMB(mem.rss) + 'MB heapUsed=' + toMB(mem.heapUsed) + 'MB heapTotal=' + toMB(mem.heapTotal) + 'MB' +
      ' | london365=' + JSON.stringify(getLondon365MemoryDiagnostics()) +
      ' | gamedetails=' + JSON.stringify(getGameDetailsMemoryDiagnostics()) +
      ' | socket=' + JSON.stringify(getSocketMemoryDiagnostics()) +
      ' | matchesResponseCache=' + getMatchesResponseCacheSize());
  }, 60 * 1000);
  // Prevent the free-tier PG storage cap from filling up with unbounded
  // append-only history (odds_history, match_events, audit_log) and stale
  // finished matches. First run 2 min after boot, then every 6 hours.
  setTimeout(function () { cleanupOldData().catch(function () {}); }, 2 * 60 * 1000);
  setInterval(function () { cleanupOldData().catch(function () {}); }, 6 * 60 * 60 * 1000);
  // See server/keepAlive.js — stops the free-tier "S'arritem te lidhemi me
  // serverin" / stuck-on-"Duke ngarkuar..." symptom by keeping Render from
  // ever spinning the service down in the first place, instead of only
  // retrying through the wait once someone's already hit it.
  startKeepAliveSelfPing();
}

start().catch((err) => {
  console.error('FATAL: failed to start server:', err);
  process.exit(1);
});
