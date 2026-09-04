// LondonPro365 data provider for 365sim.
//
// Pulls every match, market, and coefficient from the londonpro365.com
// backend API (real host: eccoplay365.com) and stores it in matches_cache
// using the canonical The-Odds-API event shape the rest of the app consumes,
// so listing, match detail, bet verification, odds history, and settlement
// all work on this data without changes. A background loop syncs in-play
// scores and real-time odds movement from the livegames endpoint.
//
// Env:
//   LONDON365_ENABLED            1 (default) or 0
//   LONDON365_API                default https://eccoplay365.com
//   LONDON365_ORIGIN             default https://londonpro365.com
//   LONDON365_SPORTS             csv sport ids, default 1 (Soccer)
//   LONDON365_LEAGUES            league cap per sport, 0 = all
//   LONDON365_FULL               1 = fetch every market via detail endpoint
//   LONDON365_LIVE_INTERVAL_MS   default 30000 (min 10000)
//   LONDON365_IMPORT_THROTTLE_MS default 600000

import pool, { getKV, setKV } from './db.js';
import { diffOddsChanges } from './oddsUtils.js';
import { pushOddsChanged, pushGoal } from './ws.js';

const ENABLED = (process.env.LONDON365_ENABLED || '1') === '1';
const API_BASE = process.env.LONDON365_API || 'https://eccoplay365.com';
const SITE_ORIGIN = process.env.LONDON365_ORIGIN || 'https://londonpro365.com';
const SPORTS = (process.env.LONDON365_SPORTS || '1').split(',').map(Number).filter(Boolean);
const LEAGUE_LIMIT = Number(process.env.LONDON365_LEAGUES || 0);
const FULL_DETAIL = (process.env.LONDON365_FULL || '1') === '1';
const LIVE_INTERVAL_MS = Math.max(10000, Number(process.env.LONDON365_LIVE_INTERVAL_MS || 30000));
const IMPORT_THROTTLE_MS = Number(process.env.LONDON365_IMPORT_THROTTLE_MS || 600000);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Origin: SITE_ORIGIN,
  Referer: SITE_ORIGIN + '/',
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

export function isLondon365Enabled() {
  return ENABLED;
}

// HTTP with gentle retry; the API intermittently answers "Something went wrong".
async function api(pathname, opts) {
  opts = opts || {};
  const retries = opts.retries || 3;
  let lastErr = null;
  for (let attempt = 1; attempt !== retries + 1; attempt++) {
    try {
      const resp = await fetch(API_BASE + pathname, {
        method: opts.method || 'GET',
        headers: HEADERS,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      const text = await resp.text();
      if (resp.ok === false) throw new Error('HTTP ' + resp.status);
      if (text.trim().toLowerCase().indexOf('something went wrong') === 0) throw new Error('API transient error');
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
      if (attempt !== retries) await new Promise(function (r) { setTimeout(r, 500 * attempt); });
    }
  }
  throw new Error('london365 api ' + pathname + ' failed: ' + (lastErr ? lastErr.message : 'unknown'));
}

// Packed odds string on list responses (livegames omit the market name):
// coefId | coef | option | marketId | MarketName , ...
export function parseOddString(s) {
  if (!s) return [];
  return String(s).split(',').map(function (part) {
    const f = part.split('|');
    const coefId = f[0];
    const coef = parseFloat(f[1]);
    if (!coefId || Number.isNaN(coef)) return null;
    return {
      coefId: coefId.trim(),
      coef: coef,
      option: (f[2] || '').trim(),
      marketId: (f[3] || '').trim(),
      marketName: (f[4] || '').trim() || null,
    };
  }).filter(Boolean);
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// League name -> country token, using the SAME vocabulary as App.tsx's
// COUNTRY_TOKEN_LABELS/COUNTRY_TOKEN_ISO so a LondonPro365 league gets the
// correct flag and sidebar grouping instead of falling into "Të tjera".
// Keyed on lowercase league name substrings since this provider gives us a
// bare competition name, not a country field.
const LEAGUE_COUNTRY_HINTS = [
  [/premier league|championship|league one|league two|fa cup|efl/, 'england'],
  [/la liga|copa del rey|segunda/, 'spain'],
  [/serie a|serie b|coppa italia/, 'italy'],
  [/bundesliga|dfb.?pokal/, 'germany'],
  [/ligue 1|ligue 2|coupe de france/, 'france'],
  [/eredivisie/, 'netherlands'],
  [/primeira liga|liga portugal/, 'portugal'],
  [/jupiler|belgi/, 'belgium'],
  [/super lig|turk/, 'turkey'],
  [/super league.*greece|greek/, 'greece'],
  [/scottish|premiership/, 'scotland'],
  [/superliga.*shqip|kategoria superiore|albania/, 'albania'],
  [/mls|major league soccer/, 'usa'],
  [/liga mx/, 'mexico'],
  [/brasileirao|brazil/, 'brazil'],
  [/champions league|europa league|conference league|uefa/, 'uefa'],
  [/world cup|fifa/, 'fifa'],
  [/copa america|conmebol/, 'conmebol'],
];
function leagueCountryToken(name) {
  const n = String(name || '').toLowerCase();
  for (const [re, token] of LEAGUE_COUNTRY_HINTS) if (re.test(n)) return token;
  return 'other';
}

// Build the same provider_country_slug league key format The Odds API uses
// (e.g. soccer_italy_serie_a), so App.tsx's existing flag/grouping regex
// picks these up automatically with no frontend changes needed.
export function leagueKey(name) {
  return 'l365_' + leagueCountryToken(name) + '_' + (slug(name) || 'league');
}

// Map a LondonPro365 market label to a canonical market key so the existing
// outcomeId/translateOutcomeName logic produces HOME/DRAW/AWAY and Over/Under
// with points. Unknown markets still render generically in MatchDetail.
export function mapMarketKey(name) {
  const n = String(name || '').toLowerCase();
  if ((n.indexOf('rezultat') !== -1 && n.indexOf('final') !== -1) || n.indexOf('1x2') !== -1 || n.indexOf('fitues') !== -1) return 'h2h';
  if (n.indexOf('dopio') !== -1 || n.indexOf('double') !== -1) return 'double_chance';
  if (n.indexOf('total') !== -1 || n.indexOf('golave') !== -1) return 'totals';
  if (n.indexOf('handicap') !== -1 || n.indexOf('handikap') !== -1 || n.indexOf('hendikep') !== -1) return 'spreads';
  return slug(name) || 'other';
}

function totalsOutcome(option) {
  const m = String(option || '').trim().match(/^(mbi|over|nen|under)\s*([0-9.]+)/i);
  if (!m) return null;
  const side = /^(mbi|over)$/i.test(m[1]) ? 'Over' : 'Under';
  const point = parseFloat(m[2]);
  if (Number.isNaN(point)) return null;
  return { name: side, point: point };
}

function outcomeFromOption(marketKey, option, ev) {
  const o = String(option || '').trim();
  if (marketKey === 'h2h') {
    if (o === '1') return { name: ev.home_team };
    if (o === 'X') return { name: 'Draw' };
    if (o === '2') return { name: ev.away_team };
    return { name: o };
  }
  if (marketKey === 'totals') {
    const t = totalsOutcome(o);
    if (t) return t;
    return { name: o };
  }
  if (marketKey === 'spreads') {
    const t = totalsOutcome(o);
    if (t) return { name: ev.home_team, point: t.point };
    return { name: o };
  }
  return { name: o };
}

// Build a canonical event object (The Odds API shape) from parsed odds rows.
export function buildEvent(gameId, homeTeam, awayTeam, commenceTime, rows) {
  const ev = {
    id: 'l365-' + gameId,
    home_team: homeTeam,
    away_team: awayTeam,
    commence_time: commenceTime,
    completed: false,
    bookmakers: [{ title: 'LondonPro365', markets: [] }],
  };
  const byKey = new Map();
  for (const r of rows) {
    const marketName = r.marketName || r.market || ('market-' + r.marketId);
    const key = mapMarketKey(marketName);
    if (!byKey.has(key)) byKey.set(key, { key: key, label: marketName, outcomes: [] });
    const opt = outcomeFromOption(key, r.option, ev);
    byKey.get(key).outcomes.push({ name: opt.name, price: r.coef, point: opt.point, id: r.coefId });
  }
  ev.bookmakers[0].markets = Array.from(byKey.values()).map(function (m) {
    return { key: m.key, outcomes: m.outcomes };
  });
  return ev;
}

export function isoFromWholeDate(wholeDate, gameDate, gameTime) {
  const src = wholeDate || ((gameDate || '') + ' ' + (gameTime || ''));
  let iso = String(src).trim().replace(' ', 'T');
  // Treat naive provider timestamps as UTC so kickoff times are deterministic
  // regardless of the server's local timezone.
  if (iso && !/[zZ]$/.test(iso) && !/[+-]\d{2}:\d{2}$/.test(iso)) {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) iso += ':00';
    iso += 'Z';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

export function parseScore(result) {
  const m = String(result || '').match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  return { home: parseInt(m[1], 10), away: parseInt(m[2], 10) };
}

// UPCOMING when kickoff is in the future, LIVE otherwise. Math.sign keeps a
// literal greater-than glyph out of the source.
export function statusFromCommence(commenceTime) {
  return Math.sign(Date.parse(commenceTime) - Date.now()) === 1 ? 'UPCOMING' : 'LIVE';
}

// Persist one canonical event, recording odds movement into odds_history and
// pushing live updates over the existing WebSocket channel.
// Convert a provider minute like "48:37" or "72" into a match minute number.
export function minuteToNumber(minute) {
  if (!minute) return null;
  const m = String(minute).match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

async function upsertMatch(ev, league, status, liveScores, liveInfo) {
  return withDbLock(async () => {
    const now = Date.now();
    const { rows } = await pool.query(
      'SELECT raw_json, status, live_home_score, live_away_score, live_minute FROM matches_cache WHERE id = $1',
      [ev.id]
    );
    const existing = rows[0];

    let rawToStore = JSON.stringify(ev);
    if (existing) {
      try {
        const oldEv = JSON.parse(existing.raw_json);
        const oldCount = countOutcomes(oldEv);
        const newCount = countOutcomes(ev);
        if (oldCount && Math.sign(newCount - oldCount) === -1) {
          // Transient/incomplete provider response: keep the richer cached
          // odds intact and only refresh scores/minute via the UPDATE below.
          rawToStore = existing.raw_json;
        } else {
          const changes = diffOddsChanges(ev.id, oldEv, ev);
          for (const c of changes) {
            await pool.query(
              `INSERT INTO odds_history (match_id, market_id, selection_id, old_odds, new_odds, changed_by, reason, created_at)
               VALUES ($1,$2,$3,$4,$5,'SYSTEM','london365_refresh',$6)`,
              [c.matchId, c.marketId, c.selectionId, c.oldOdds, c.newOdds, now]
            );
          }
          if (changes.length) pushOddsChanged(ev.id, { changes: changes });
        }
      } catch (err) {
        console.error('[london365] odds diff failed for ' + ev.id + ':', err.message);
      }
    }

    await pool.query(
      `INSERT INTO matches_cache (id, league, home_team, away_team, start_time, status, raw_json, fetched_at, live_home_score, live_away_score, live_minute, live_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET
         league = excluded.league,
         home_team = excluded.home_team,
         away_team = excluded.away_team,
         start_time = excluded.start_time,
         status = CASE WHEN matches_cache.status = 'FINISHED' THEN matches_cache.status ELSE excluded.status END,
         raw_json = excluded.raw_json,
         fetched_at = excluded.fetched_at,
         live_home_score = COALESCE(excluded.live_home_score, matches_cache.live_home_score),
         live_away_score = COALESCE(excluded.live_away_score, matches_cache.live_away_score),
         live_minute = COALESCE(excluded.live_minute, matches_cache.live_minute),
         live_status = COALESCE(excluded.live_status, matches_cache.live_status)`,
      [
        ev.id, league, ev.home_team, ev.away_team, ev.commence_time, status,
        rawToStore, now,
        liveScores ? liveScores.home : null,
        liveScores ? liveScores.away : null,
        liveInfo && liveInfo.minute ? liveInfo.minute : null,
        liveInfo && liveInfo.apiStatus != null ? String(liveInfo.apiStatus) : null,
      ]
    );
    return existing;
  });
}

// Count every outcome across a canonical event, used to detect an
// incomplete provider response before it can overwrite richer cached odds.
function countOutcomes(ev) {
  let n = 0;
  const bookmakers = (ev && ev.bookmakers) || [];
  for (const bm of bookmakers) {
    const markets = bm.markets || [];
    for (const mk of markets) n += (mk.outcomes || []).length;
  }
  return n;
}

// Serialize DB writes across the full import, the live polling loop, and the
// Socket.IO feed so a slow import never interleaves partial odds with a
// live patch for the same match.
let dbWriteLock = Promise.resolve();
function withDbLock(fn) {
  const run = dbWriteLock.then(fn, fn);
  dbWriteLock = run.then(function () {}, function () {});
  return run;
}

// Record a goal exactly once: only when the score actually moved compared to
// what we last persisted (or when a first non-zero score appears). Repeated
// polls and socket ticks for the same score are no-ops.
async function recordGoalIfChanged(ev, score, minute, prev) {
  if (!score) return;
  const prevHome = prev ? prev.live_home_score : null;
  const prevAway = prev ? prev.live_away_score : null;
  const hadScoreBefore = prevHome != null && prevAway != null;
  const scoreChanged = hadScoreBefore
    ? (score.home !== prevHome || score.away !== prevAway)
    : Math.sign(score.home + score.away) === 1;
  if (!scoreChanged) return;
  const scoringTeam = hadScoreBefore && Math.sign(score.home - prevHome) === 1 ? ev.home_team : ev.away_team;
  const now = Date.now();
  await pool.query(
    `INSERT INTO match_events (match_id, minute, type, team, detail, created_at)
     VALUES ($1,$2,'GOAL',$3,$4,$5)`,
    [ev.id, minuteToNumber(minute), scoringTeam, score.home + '-' + score.away, now]
  );
  await pool.query(
    `INSERT INTO live_statistics (match_id, home_score, away_score, updated_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (match_id) DO UPDATE SET home_score = excluded.home_score, away_score = excluded.away_score, updated_at = excluded.updated_at`,
    [ev.id, score.home, score.away, now]
  );
  pushGoal(ev.id, { homeScore: score.home, awayScore: score.away, scoringTeam: scoringTeam, minute: minute || undefined });
}

let importRunning = false;
let socketConnected = false;

export function setLondon365SocketConnected(value) {
  socketConnected = !!value;
}

// Full import: every sport, then every league, then every match, every market.
export async function importLondon365(opts) {
  opts = opts || {};
  if (!ENABLED) throw new Error('LondonPro365 provider is disabled (LONDON365_ENABLED=0)');
  if (importRunning) return { skipped: true, reason: 'import already running' };
  importRunning = true;

  const sports = opts.sports || SPORTS;
  const full = opts.full === undefined ? FULL_DETAIL : !!opts.full;
  const leagueCap = opts.leagues === undefined ? LEAGUE_LIMIT : Number(opts.leagues) || 0;
  const matchCap = Number(opts.matches) || 0;

  const leaguesSeen = new Set(await getKV('l365_leagues', []));
  let matchCount = 0;
  let coefficientCount = 0;
  let detailOkCount = 0;
  let detailFailCount = 0;
  const DETAIL_DELAY_MS = Math.max(0, Number(process.env.LONDON365_DETAIL_DELAY_MS || 150));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    for (const sid of sports) {
      let leagues;
      try {
        leagues = await api('/ajax/leagues/' + sid);
      } catch (err) {
        console.error('[london365] leagues sport ' + sid + ' failed:', err.message);
        continue;
      }
      if (!Array.isArray(leagues)) continue;
      if (leagueCap) leagues = leagues.slice(0, leagueCap);

      for (const league of leagues) {
        let games;
        try {
          games = await api('/ajax/gamesByLeague/' + league.id);
        } catch (err) {
          console.error('[london365] games for ' + league.name + ' failed:', err.message);
          continue;
        }
        if (!Array.isArray(games) || games.length === 0) continue;
        if (matchCap) games = games.slice(0, matchCap);

        for (const game of games) {
          let rows = [];
          if (full) {
            try {
              // Gentle pacing: hammering a real bookmaker backend with one
              // detail request per game, back-to-back, is exactly the
              // pattern anti-bot/rate-limit rules key on. A failed detail
              // fetch silently falls back to the sparse list-level odds
              // below, which is the most likely reason only a handful of
              // markets (not the full catalog) end up showing.
              if (DETAIL_DELAY_MS) await sleep(DETAIL_DELAY_MS);
              const detail = await api('/ajax/prematchgame/' + game.id);
              if (Array.isArray(detail)) {
                for (const market of detail) {
                  if (!Array.isArray(market)) continue;
                  for (const m of market) {
                    rows.push({
                      coefId: String(m.id),
                      coef: parseFloat(m.odd),
                      option: (m.market_option || '').trim(),
                      marketId: String(m.market_id),
                      marketName: m.market || null,
                    });
                  }
                }
              }
              detailOkCount++;
            } catch (err) {
              detailFailCount++;
              console.error('[london365] detail ' + game.id + ' failed (falling back to sparse list odds):', err.message);
            }
          }
          if (!rows.length) rows = parseOddString(game.odd);
          rows = rows.filter(function (r) { return r ? !Number.isNaN(r.coef) : false; });
          if (!rows.length) continue;

          const ev = buildEvent(
            game.id,
            game.home_team,
            game.away_team,
            isoFromWholeDate(game.whole_date, game.game_date, game.game_time),
            rows
          );
          await upsertMatch(ev, leagueKey(league.name), statusFromCommence(ev.commence_time), null);
          matchCount++;
          coefficientCount += rows.length;
          leaguesSeen.add(league.name);
        }
      }
    }
    await setKV('l365_leagues', Array.from(leaguesSeen));
    await setKV('l365_last_import', Date.now());
    console.log(
      '[london365] import done: ' + matchCount + ' matches, ' + coefficientCount + ' coefficients, ' +
      leaguesSeen.size + ' leagues (full-detail fetch: ' + detailOkCount + ' ok / ' + detailFailCount + ' failed' +
      (full && detailFailCount > detailOkCount ? ' — MOSTLY FAILING, matches are likely showing only sparse list-level odds, not the full market catalog' : '') +
      ')'
    );
    return { matches: matchCount, coefficients: coefficientCount, leagues: leaguesSeen.size, detailOkCount, detailFailCount };
  } finally {
    importRunning = false;
  }
}

// Kick a throttled import in the background (never blocks an API request).
export function ensureLondon365Import() {
  if (!ENABLED) return;
  (async function () {
    const last = await getKV('l365_last_import', 0);
    const elapsed = Date.now() - last;
    if (Math.sign(IMPORT_THROTTLE_MS - elapsed) === 1) return;
    await setKV('l365_last_import', Date.now());
    try {
      await importLondon365();
    } catch (err) {
      console.error('[london365] background import failed:', err.message);
    }
  })();
}

// Live sync: in-play scores plus real-time odds movement.
export async function syncLondon365Live() {
  if (!ENABLED) return { games: 0 };
  let gamesSynced = 0;

  for (const sid of SPORTS) {
    let games;
    try {
      games = await api('/ajax/livegames', { method: 'POST', body: { sport: sid, market_type: 1 } });
    } catch (err) {
      console.error('[london365] livegames sport ' + sid + ' failed:', err.message);
      continue;
    }
    if (!Array.isArray(games)) continue;

    for (const g of games) {
      const odds = parseOddString(g.odd).filter(function (o) { return o ? !Number.isNaN(o.coef) : false; });
      if (!odds.length) continue;
      const ev = buildEvent(g.id, g.home_team, g.away_team, isoFromWholeDate(null, g.game_date, g.game_time), odds);
      const score = parseScore(g.result);
      const minute = g.current_minute || null;
      const prev = await upsertMatch(ev, g.league, 'LIVE', score, { minute: minute, apiStatus: g.api_status });
      await recordGoalIfChanged(ev, score, minute, prev);
      gamesSynced++;
    }
  }
  await setKV('l365_last_live_sync', Date.now());
  return { games: gamesSynced };
}

// --- Socket.IO feed handlers (called by london365Socket.js) ----------------
// The provider pushes real-time deltas over Socket.IO in addition to the REST
// snapshot the polling loop reads. These handlers patch the cached canonical
// event in place so odds move sub-second without a full re-fetch.

export async function applySocketCoefs(gameId, coefs) {
  const id = 'l365-' + gameId;
  return withDbLock(async () => {
    const { rows } = await pool.query('SELECT raw_json FROM matches_cache WHERE id = $1', [id]);
    if (!rows.length || !rows[0].raw_json) return 0;
    let ev;
    try { ev = JSON.parse(rows[0].raw_json); } catch (err) { return 0; }
    const byCoefId = new Map();
    for (const bm of ev.bookmakers || []) {
      for (const mk of bm.markets || []) {
        for (const o of mk.outcomes || []) byCoefId.set(String(o.id), { o: o, market: mk.key });
      }
    }
    const changes = [];
    for (const c of coefs || []) {
      const coefId = String(c.coef_id != null ? c.coef_id : (c.id != null ? c.id : ''));
      const price = parseFloat(c.coef != null ? c.coef : (c.odd != null ? c.odd : c.value));
      if (!coefId || Number.isNaN(price)) continue;
      const entry = byCoefId.get(coefId);
      if (!entry || entry.o.price === price) continue;
      changes.push({ matchId: id, marketId: entry.market, selectionId: coefId, oldOdds: entry.o.price, newOdds: price });
      entry.o.price = price;
    }
    if (!changes.length) return 0;
    const now = Date.now();
    for (const c of changes) {
      await pool.query(
        `INSERT INTO odds_history (match_id, market_id, selection_id, old_odds, new_odds, changed_by, reason, created_at)
         VALUES ($1,$2,$3,$4,$5,'SYSTEM','london365_socket',$6)`,
        [c.matchId, c.marketId, c.selectionId, c.oldOdds, c.newOdds, now]
      );
    }
    await pool.query('UPDATE matches_cache SET raw_json = $2, fetched_at = $3 WHERE id = $1', [id, JSON.stringify(ev), now]);
    pushOddsChanged(id, { changes: changes });
    return changes.length;
  });
}

export async function applySocketGame(g, status) {
  if (!g || !g.id) return false;
  const odds = parseOddString(g.odd).filter(function (o) { return o ? !Number.isNaN(o.coef) : false; });
  if (!odds.length) return false;
  const commence = isoFromWholeDate(g.whole_date, g.game_date, g.game_time);
  const ev = buildEvent(g.id, g.home_team, g.away_team, commence, odds);
  const score = parseScore(g.result);
  const minute = g.current_minute || null;
  const resolved = status || (minute ? 'LIVE' : statusFromCommence(commence));
  const prev = await upsertMatch(ev, g.league, resolved, score, { minute: minute, apiStatus: g.api_status });
  await recordGoalIfChanged(ev, score, minute, prev);
  return true;
}

export async function markLondon365GameEnded(gameId) {
  const id = 'l365-' + gameId;
  return withDbLock(async () => {
    const res = await pool.query(
      `UPDATE matches_cache SET status = 'FINISHED', live_status = 'ended' WHERE id = $1 AND status = 'LIVE'`,
      [id]
    );
    return res ? res.rowCount : 0;
  });
}

export async function removeSocketCoef(gameId, coefId) {
  const id = 'l365-' + gameId;
  if (!coefId) return 0;
  return withDbLock(async () => {
    const { rows } = await pool.query('SELECT raw_json FROM matches_cache WHERE id = $1', [id]);
    if (!rows.length || !rows[0].raw_json) return 0;
    let ev;
    try { ev = JSON.parse(rows[0].raw_json); } catch (err) { return 0; }
    let removed = 0;
    for (const bm of ev.bookmakers || []) {
      for (const mk of bm.markets || []) {
        const before = (mk.outcomes || []).length;
        mk.outcomes = (mk.outcomes || []).filter(function (o) { return String(o.id) !== String(coefId); });
        removed += before - mk.outcomes.length;
      }
    }
    if (removed) await pool.query('UPDATE matches_cache SET raw_json = $2, fetched_at = $3 WHERE id = $1', [id, JSON.stringify(ev), Date.now()]);
    return removed;
  });
}

let liveTimer = null;

export function startLondon365LiveLoop() {
  if (!ENABLED || liveTimer) return;
  liveTimer = setInterval(function () {
    syncLondon365Live().catch(function (err) {
      console.error('[london365] live sync failed:', err.message);
    });
  }, LIVE_INTERVAL_MS);
  if (liveTimer.unref) liveTimer.unref();
  setTimeout(function () {
    syncLondon365Live().catch(function (err) {
      console.error('[london365] initial live sync failed:', err.message);
    });
  }, 5000);
  console.log('[london365] live loop started, every ' + LIVE_INTERVAL_MS + 'ms for sports ' + SPORTS.join(','));
}

export async function getLondon365Status() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS matches,
            COUNT(*) FILTER (WHERE status = 'LIVE')::int AS live
     FROM matches_cache WHERE id LIKE 'l365-%'`
  );
  return {
    enabled: ENABLED,
    socketConnected: socketConnected,
    apiBase: API_BASE,
    sports: SPORTS,
    fullDetail: FULL_DETAIL,
    leagueLimit: LEAGUE_LIMIT,
    liveIntervalMs: LIVE_INTERVAL_MS,
    matches: rows[0].matches,
    liveMatches: rows[0].live,
    lastImport: await getKV('l365_last_import', 0),
    lastLiveSync: await getKV('l365_last_live_sync', 0),
    leagues: (await getKV('l365_leagues', [])).length,
  };
}
