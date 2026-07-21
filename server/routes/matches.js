import express from 'express';
import pool from '../db.js';
import { afMapRowToMatch } from '../afMapper.js';
import { settleMatch } from '../matchSettlement.js';
import {
  TOP_LEAGUES,
  fetchJson,
  hasApiKey,
  shouldSkipForBudget,
  canRefreshFixtures,
  canRefreshOdds,
} from '../apiFootballClient.js';

const router = express.Router();

// Maps API-Football's status code to our status, and auto-settles the match
// via the shared settlement module the moment it's reported finished.
async function mapAndSettleIfNeeded(id, fx) {
  const code = fx.fixture.status.short;
  const FINISHED_CODES = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);
  const LIVE_CODES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);

  if (FINISHED_CODES.has(code)) {
    if (fx.goals?.home != null && fx.goals?.away != null) {
      await settleMatch(id, fx.goals.home, fx.goals.away);
    }
    return 'FINISHED';
  }
  if (LIVE_CODES.has(code)) return 'LIVE';
  return 'UPCOMING';
}

// Pulls the fixture list (schedule + live status + live score, all in one
// call) for a league's "today .. +6 days" window, and upserts each fixture
// into matches_cache. If a fixture is now reported FINISHED, auto-settle it
// with the real score via the shared settlement module — this is what makes
// "matches that already happened" get a real result instead of hanging
// around forever, and what pays out every ticket automatically.
async function refreshLeagueFixtures(league) {
  if (!(await canRefreshFixtures(league.id))) return;
  if (await shouldSkipForBudget()) {
    console.warn(`[api-football] Skipping fixtures refresh for ${league.name}: low on today's request budget.`);
    return;
  }

  const season = league.seasonFor(new Date());
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let fixtures;
  try {
    fixtures = await fetchJson(`/fixtures?league=${league.id}&season=${season}&from=${from}&to=${to}&timezone=Europe/Tirane`);
  } catch (err) {
    console.error(`[api-football] Failed refreshing fixtures for ${league.name} (league=${league.id}, season=${season}):`, err.message);
    return;
  }

  const now = Date.now();
  for (const fx of fixtures) {
    const id = String(fx.fixture.id);
    const status = await mapAndSettleIfNeeded(id, fx);

    const { rows: existingRows } = await pool.query('SELECT raw_json FROM matches_cache WHERE id = $1', [id]);
    let bookmakers = [];
    try {
      bookmakers = existingRows[0] ? (JSON.parse(existingRows[0].raw_json).bookmakers || []) : [];
    } catch { /* corrupt/old row shape, just start fresh */ }

    await pool.query(
      `INSERT INTO matches_cache (id, league, home_team, away_team, start_time, status, raw_json, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         status = CASE WHEN matches_cache.status = 'FINISHED' THEN matches_cache.status ELSE excluded.status END,
         raw_json = excluded.raw_json, fetched_at = excluded.fetched_at`,
      [id, String(league.id), fx.teams.home.name, fx.teams.away.name, fx.fixture.date, status,
       JSON.stringify({ fixture: fx, bookmakers }), now]
    );

    if (status === 'LIVE' && fx.goals?.home != null && fx.goals?.away != null) {
      await pool.query(
        `UPDATE matches_cache SET live_home_score = $1, live_away_score = $2 WHERE id = $3 AND status != 'FINISHED'`,
        [fx.goals.home, fx.goals.away, id]
      );
    }
  }
}

// Pulls pre-match odds for a league's fixtures in one bulk call (cheaper than
// one request per fixture) and merges them into each cached fixture's row.
async function refreshLeagueOdds(league) {
  if (!(await canRefreshOdds(league.id))) return;
  if (await shouldSkipForBudget()) {
    console.warn(`[api-football] Skipping odds refresh for ${league.name}: low on today's request budget.`);
    return;
  }

  const season = league.seasonFor(new Date());
  const today = new Date().toISOString().slice(0, 10);

  let oddsResponses;
  try {
    oddsResponses = await fetchJson(`/odds?league=${league.id}&season=${season}&date=${today}&timezone=Europe/Tirane`);
  } catch (err) {
    console.error(`[api-football] Failed refreshing odds for ${league.name} (league=${league.id}, season=${season}):`, err.message);
    return;
  }

  const now = Date.now();
  for (const entry of oddsResponses) {
    const id = String(entry.fixture.id);
    const { rows } = await pool.query('SELECT raw_json FROM matches_cache WHERE id = $1', [id]);
    if (!rows[0]) continue; // fixture not in our cache (outside the from/to window we track) — skip
    let parsed;
    try {
      parsed = JSON.parse(rows[0].raw_json);
    } catch {
      continue;
    }
    parsed.bookmakers = entry.bookmakers || [];
    await pool.query('UPDATE matches_cache SET raw_json = $1, fetched_at = $2 WHERE id = $3', [JSON.stringify(parsed), now, id]);
  }
}

// GET /api/matches?league=39 (optional filter by API-Football league id, default: curated TOP_LEAGUES)
router.get('/', async (req, res) => {
  if (!hasApiKey()) {
    return res.json({ matches: [], hasLiveApiKey: false });
  }

  const targetLeagues = req.query.league
    ? TOP_LEAGUES.filter((l) => String(l.id) === req.query.league)
    : TOP_LEAGUES;

  for (const league of targetLeagues) {
    try {
      await refreshLeagueFixtures(league);
      await refreshLeagueOdds(league);
    } catch (err) {
      console.error(`[api-football] Unexpected error refreshing ${league.name}:`, err.message);
    }
  }

  const leagueIds = targetLeagues.map((l) => String(l.id));
  const { rows } = leagueIds.length
    ? await pool.query(
        `SELECT * FROM matches_cache WHERE league = ANY($1::text[]) ORDER BY start_time ASC`,
        [leagueIds]
      )
    : await pool.query('SELECT * FROM matches_cache ORDER BY start_time ASC');

  res.json({ matches: rows.map(afMapRowToMatch), hasLiveApiKey: true });
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM matches_cache WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Match not found' });
  res.json({ match: afMapRowToMatch(rows[0]) });
});

export default router;
