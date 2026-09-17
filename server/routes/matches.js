import express from 'express';
import { queryWithRetry } from '../db.js';
import { mapEventToMatch } from '../oddsUtils.js';
import { ensureLondon365Import, getLondon365LeagueNames, getLondon365LeagueMeta } from '../london365.js';
import { wrap } from '../asyncHandler.js';

const router = express.Router();

// --- Fixture de-duplication safety net -------------------------------
// LondonPro365 is the ONLY match source. Every row's id is 'l365-<gameId>',
// which is already unique per fixture, so true duplicates shouldn't occur —
// this stays only as a defensive net (e.g. a fixture briefly reachable
// under two different league classifications during a country/league
// remap) and to keep the richer LIVE/FINISHED status when it does.
function outcomeCount(m) {
  let n = 0;
  for (const mk of m.markets || []) n += (mk.options || []).length;
  return n;
}
function normTeam(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(fc|cf|sc|ac|afc|fk|if|bk|sk|cd|sd|ud|club)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
function teamSim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}
function sameFixture(a, b) {
  const ah = normTeam(a.homeTeam), aa = normTeam(a.awayTeam);
  const bh = normTeam(b.homeTeam), ba = normTeam(b.awayTeam);
  const direct = teamSim(ah, bh) >= 0.75 && teamSim(aa, ba) >= 0.75;
  const swapped = teamSim(ah, ba) >= 0.75 && teamSim(aa, bh) >= 0.75;
  return direct || swapped;
}
const STATUS_RANK = { UPCOMING: 0, LIVE: 1, FINISHED: 2 };
function dedupeMatches(list) {
  const WINDOW_MS = 3 * 60 * 60 * 1000;
  const sorted = [...list].sort((x, y) => Date.parse(x.startTime) - Date.parse(y.startTime));
  const groups = []; // {rep, candidates, time}
  for (const m of sorted) {
    const t = Date.parse(m.startTime);
    let placed = false;
    if (!Number.isNaN(t)) {
      for (const g of groups) {
        if (Math.abs(t - g.time) > WINDOW_MS) continue;
        if (sameFixture(g.rep, m)) {
          g.candidates.push(m);
          placed = true;
          break;
        }
      }
    }
    if (!placed) groups.push({ rep: m, candidates: [m], time: t });
  }
  return groups.map((g) => {
    let best = g.candidates[0];
    for (const c of g.candidates) {
      const cs = outcomeCount(c);
      const bs = outcomeCount(best);
      if (cs > bs) best = c;
    }
    best = { ...best };
    for (const c of g.candidates) {
      if (c === best || (STATUS_RANK[c.status] || 0) <= (STATUS_RANK[best.status] || 0)) continue;
      best.status = c.status;
      best.isLive = c.isLive;
      best.liveHomeScore = c.liveHomeScore ?? best.liveHomeScore;
      best.liveAwayScore = c.liveAwayScore ?? best.liveAwayScore;
      best.currentMinute = c.currentMinute ?? best.currentMinute;
    }
    return best;
  });
}

// LondonPro365 is the sole match/odds source. Every request kicks a
// throttled background import (ensureLondon365Import no-ops if one already
// ran recently or is in progress — see LONDON365_IMPORT_THROTTLE_MS) and
// then serves whatever's currently cached, so the response is always fast
// regardless of import progress.
//
// Response cache: the DB query + dedupeMatches() (fuzzy team-name matching,
// O(n) per existing time-window group) together cost 100-200ms of pure
// synchronous CPU time with a realistic few-thousand-match, same-kickoff-
// time-cluster load (measured) — and because Node is single-threaded, that
// time fully blocks EVERY other request (other phones' /api/matches calls,
// live WebSocket broadcasts, logins) while it runs. Worse, it was being
// redone from scratch for every single client poll even though the
// underlying matches_cache data only actually changes when the throttled
// import runs. Caching the fully-computed response for a few seconds means
// many phones polling around the same time share one computation instead
// of each paying the full cost — this is the main lever for "many phones
// at once" responsiveness, bigger than micro-optimizing dedupeMatches
// itself. TTL is short enough that no one perceives stale data (live
// scores/odds flow separately over WebSocket in real time regardless).
const MATCHES_CACHE_TTL_MS = 8000;
const matchesResponseCache = new Map(); // key -> { body, computedAt }

// Only the columns mapEventToMatch()/dedupeMatches() actually read (see
// server/oddsUtils.js). `SELECT *` was also pulling settled_at and
// sportmonks_fixture_id across every row for nothing — small on its own,
// but free to drop.
const MATCH_COLUMNS = `id, league, league_id, country_id, home_team, away_team,
  start_time, status, raw_json, live_home_score, live_away_score,
  live_minute, live_status, result_home, result_away`;

// ROOT CAUSE (measured 2026-09-17): the unfiltered branch below is the one
// the frontend ALWAYS hits — App.tsx's loadMatches() calls fetchMatches()
// with no `league` argument on every load/reconnect and does all
// league/live/search filtering client-side over the full list (see
// App.tsx comment above loadMatches). So this single query was trying to
// pull ~900 rows in one round trip, each carrying a full raw_json odds
// blob (the dominant cost per row) — confirmed by measurement to take
// >6s total once past a couple hundred rows, which is exactly
// queryWithRetry's per-attempt timeout (NOT Postgres's own 15s
// statement_timeout — the app was giving up on a query Postgres would
// have finished, well before LIMIT 4000 rows are ever reached).
// `LIMIT 100` "fixed" the timeout by silently dropping ~800 rows (whole
// leagues disappearing) — not acceptable.
//
// Fix: fetch the exact same bounded window (2 days back / 21 days
// forward, every league) but in several smaller LIMIT/OFFSET pages
// instead of one giant query, running a few pages concurrently. Every
// row in range is still returned — nothing is truncated — but no single
// DB round trip ever carries more than PAGE_SIZE rows of raw_json, so no
// single query gets anywhere near the timeout even though the total
// result set doesn't fit in one 6s window. Concurrency is capped well
// under the pool's `max: 6` (server/db.js) since this endpoint's queries
// share that pool with every other route, the live WebSocket sync loop,
// and the background London365 import.
const MATCHES_PAGE_SIZE = 200;
const MAX_CONCURRENT_MATCH_PAGES = 3;
const MATCHES_PAGE_HARD_CAP = 30; // 30 * 200 = 6000-row safety ceiling against a runaway loop

async function fetchUpcomingMatchRowsPaged() {
  const allRows = [];
  for (let page = 0; page < MATCHES_PAGE_HARD_CAP; page += MAX_CONCURRENT_MATCH_PAGES) {
    const pageIndexes = Array.from({ length: MAX_CONCURRENT_MATCH_PAGES }, (_, i) => page + i);
    const results = await Promise.all(pageIndexes.map((p) => queryWithRetry(
      `SELECT ${MATCH_COLUMNS}
       FROM matches_cache
       WHERE id LIKE 'l365-%'
         AND start_time_tz(start_time) > NOW() - interval '2 days'
         AND start_time_tz(start_time) < NOW() + interval '21 days'
       ORDER BY start_time ASC, id ASC
       LIMIT $1 OFFSET $2`,
      [MATCHES_PAGE_SIZE, p * MATCHES_PAGE_SIZE],
      // A bit more headroom than the 6000ms default: each page is a much
      // smaller, bounded slice (measured well under this), so this is
      // real margin for a slow page, not a blanket "make timeouts bigger"
      // — and it's still comfortably under Postgres's own 15s
      // statement_timeout in server/db.js.
      { attemptTimeoutMs: 8000 }
    )));
    let anyShortPage = false;
    for (const { rows } of results) {
      allRows.push(...rows);
      if (rows.length < MATCHES_PAGE_SIZE) anyShortPage = true;
    }
    if (anyShortPage) break; // reached the end of the window
  }
  return allRows;
}

router.get('/', wrap(async (req, res) => {
  ensureLondon365Import();

  const cacheKey = req.query.league || '__all__';
  const cached = matchesResponseCache.get(cacheKey);
  if (cached && Date.now() - cached.computedAt < MATCHES_CACHE_TTL_MS) {
    return res.json(cached.body);
  }

  // Bounded by time: the UI only ever shows "today" through ~3 weeks ahead,
  // plus recently-finished/live matches from the last couple of days — so
  // there's no reason to keep pulling EVERY match_cache row ever imported
  // (which only grows over time and was making first-load, especially for
  // a brand-new visitor with no local cache, get slower and slower as the
  // table accumulated old finished fixtures with their full raw_json
  // market blobs). start_time is TEXT, so the timestamptz cast is required
  // for a valid comparison (see server/oddsUtils.js normalizeStatus for
  // the same pattern).
  //
  // 21 days forward (not the original 10) because continental competitions
  // (UEFA Champions/Europa/Conference League, Nations League...) play in
  // rounds spaced 3-4 weeks apart, unlike domestic leagues' weekly
  // schedule — a 10-day window meant the entire "International" group
  // went empty for most of the gap between rounds even though the
  // fixtures existed and were correctly imported/classified.
  // queryWithRetry (not plain pool.query): this is the endpoint the
  // frontend hits on every load and every poll, so a brief DB hiccup here
  // (Aiven connection reset, a pool slot momentarily full during a Render
  // rolling deploy) is exactly the kind of thing that should self-heal
  // with one quick retry instead of surfacing a 502/503 to the user.
  const rows = req.query.league
    ? (await queryWithRetry(
        `SELECT ${MATCH_COLUMNS} FROM matches_cache WHERE league = $1 ORDER BY start_time ASC`,
        [req.query.league]
      )).rows
    : await fetchUpcomingMatchRowsPaged();
  console.log(`[matches] GET / -> ${rows.length} cached row(s)${req.query.league ? ` for league=${req.query.league}` : ''}`);
  const body = { matches: dedupeMatches(rows.map(mapEventToMatch)), leagueNames: getLondon365LeagueNames(), leagueMeta: getLondon365LeagueMeta() };
  matchesResponseCache.set(cacheKey, { body, computedAt: Date.now() });
  res.json(body);
}));

router.get('/:id/odds-history', wrap(async (req, res) => {
  const { rows } = await queryWithRetry(
    'SELECT market_id, selection_id, old_odds, new_odds, changed_by, reason, created_at FROM odds_history WHERE match_id = $1 ORDER BY created_at ASC',
    [req.params.id]
  );
  res.json({ history: rows });
}));

// Live stats + match events for the Match Details "Statistika"/"Ngjarjet"
// tabs. Both tables are already populated by the live sync above when the
// source feed provides them (see persistEvent/syncSource) — this just
// exposes what was already being written but never read back.
router.get('/:id/live-detail', wrap(async (req, res) => {
  const [{ rows: statsRows }, { rows: eventRows }, { rows: cacheRows }] = await Promise.all([
    queryWithRetry('SELECT * FROM live_statistics WHERE match_id = $1', [req.params.id]),
    queryWithRetry(
      'SELECT minute, type, team, player, detail, created_at FROM match_events WHERE match_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    ),
    queryWithRetry('SELECT live_minute, live_home_score, live_away_score, status FROM matches_cache WHERE id = $1', [req.params.id]),
  ]);
  // The provider's live feed carries the real in-play clock (e.g. "62:14")
  // even when the stats table has no minute yet — expose it so the pitch
  // shows a genuine running minute for LondonPro365 games.
  let statistics = statsRows[0] || null;
  const cache = cacheRows[0];
  if (cache) {
    const m = String(cache.live_minute || '').match(/^(\d+)/);
    if (!statistics) {
      statistics = {
        minute: m ? Number(m[1]) : null,
        home_score: cache.live_home_score,
        away_score: cache.live_away_score,
      };
    } else if (statistics.minute == null && m) {
      statistics = { ...statistics, minute: Number(m[1]) };
    }
  }
  res.json({ statistics, events: eventRows });
}));

router.get('/:id', wrap(async (req, res) => {
  const { rows } = await queryWithRetry('SELECT * FROM matches_cache WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Match not found' });
  res.json({ match: mapEventToMatch(rows[0]) });
}));

export default router;
