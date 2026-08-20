import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import authRouter from './routes/auth.js';
import matchesRouter from './routes/matches.js';
import betsRouter from './routes/bets.js';
import adminRouter from './routes/admin.js';
import { initDb } from './db.js';

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
// Restrict cross-origin requests to known frontend origin(s). Falls back to
// allowing all origins only when FRONTEND_ORIGIN is unset (e.g. local dev
// where frontend and API are served together on one origin anyway).
const allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors(
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

// General API protection: generous enough for normal browsing/polling, but
// stops scripted abuse (e.g. spam bet placement, scraping matches on a tight
// loop) from one IP.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Shumë kërkesa. Provo përsëri pas pak.' },
});

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/bets', betsRouter);
app.use('/api/admin', adminRouter);

// Catch-all error handler: any unhandled error thrown/rejected inside a route
// (e.g. Postgres unreachable, quota exceeded) returns a clean 503 instead of
// crashing the entire Node process (which was causing full 502s + restart
// loops on transient DB issues).
app.use((err, req, res, next) => {
  console.error('[unhandled route error]', err.message);
  if (res.headersSent) return next(err);
  res.status(503).json({ error: 'Service temporarily unavailable. Please try again shortly.' });
});

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

app.get('/api/health', (req, res) => res.status(dbReady ? 200 : 503).json({ ok: true, db: dbReady ? 'up' : 'down' }));

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
} else {
  console.error(`[static] dist/ not found at ${distPath} — run "npm run build" before starting the server, or check your Build Command.`);
}

async function start() {
  try {
    await initDb();
    dbReady = true;
    console.log('[db] connected and initialized');
  } catch (err) {
    dbReady = false;
    console.error('[db] init failed; starting server without database:', err);
  }

  app.listen(PORT, () => {
    console.log(`365sim backend listening on http://localhost:${PORT}`);
    if (!process.env.ODDS_API_KEY) {
      console.warn('WARNING: ODDS_API_KEY is not set — /api/matches will return an empty list until you add one in .env');
    }
    if (!process.env.JWT_SECRET) {
      console.error(
        'SECURITY WARNING: JWT_SECRET is not set. Using an insecure hardcoded fallback ' +
        'means ANYONE can forge a valid admin login token. Set JWT_SECRET in your ' +
        'environment (Render: Environment tab -> Generate) before letting real users in.'
      );
    }
  });
}

start().catch((err) => {
  console.error('FATAL: failed to start server:', err);
  process.exit(1);
});
