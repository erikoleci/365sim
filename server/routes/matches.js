import express from 'express';
import db from '../db.js';
import { mapEventToMatch } from '../oddsUtils.js';

const router = express.Router();

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// Markets we ask for per match. The Odds API soccer coverage typically
// includes: h2h (1X2), totals (over/under goals), btts, double_chance,
// draw_no_bet, spreads (Asian handicap) — availability varies by league/plan.
const MARKETS = 'h2h,totals,btts,double_chance,draw_no_bet,spreads';

// How often we refresh from the external API. This is the main lever
// against burning through your monthly request quota — do NOT lower this
// without checking your plan's remaining-requests header (logged below).
const LEAGUES_REFRESH_MS = 6 * 60 * 60 * 1000; // sport list changes rarely -> 6h
const ODDS_REFRESH_MS = 5 * 60 * 1000;          // 5 min is a reasonable default

let leaguesCache = { data: [], fetchedAt: 0 };
let oddsRefreshTimers = new Map(); // leagueKey -> last fetch timestamp

async function fetchJson(url) {
  const resp = await fetch(url);
  const remaining = resp.headers.get('x-requests-remaining');
  const used = resp.headers.get('x-requests-used');
  if (remaining !== null) {
    console.log(`[the-odds-api] requests used=${used} remaining=${remaining}`);
  }
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Odds API ${resp.status}: ${body}`);
  }
  return resp.json();
}

async function getSoccerLeagues() {
  const now = Date.now();
  if (leaguesCache.data.length && now - leaguesCache.fetchedAt < LEAGUES_REFRESH_MS) {
    return leaguesCache.data;
  }
  if (!ODDS_API_KEY) return [];
  const all = await fetchJson(`${ODDS_API_BASE}/sports/?apiKey=${ODDS_API_KEY}`);
  const soccer = all.filter((s) => s.group === 'Soccer' && s.active);
  leaguesCache = { data: soccer, fetchedAt: now };
  return soccer;
}

async function refreshLeagueOdds(leagueKey) {
  const now = Date.now();
  const last = oddsRefreshTimers.get(leagueKey) || 0;
  if (now - last < ODDS_REFRESH_MS) return; // still fresh, skip external call
  oddsRefreshTimers.set(leagueKey, now);

  const url = `${ODDS_API_BASE}/sports/${leagueKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu,uk&markets=${MARKETS}&oddsFormat=decimal`;
  let events;
  try {
    events = await fetchJson(url);
  } catch (err) {
    console.error(`Failed refreshing ${leagueKey}:`, err.message);
    return;
  }

  const insert = db.prepare(`
    INSERT INTO matches_cache (id, league, home_team, away_team, start_time, status, raw_json, fetched_at)
    VALUES (@id, @league, @home_team, @away_team, @start_time, @status, @raw_json, @fetched_at)
    ON CONFLICT(id) DO UPDATE SET
      status=excluded.status, raw_json=excluded.raw_json, fetched_at=excluded.fetched_at
  `);
  const tx = db.transaction((rows) => rows.forEach((r) => insert.run(r)));
  tx(events.map((ev) => ({
    id: ev.id,
    league: leagueKey,
    home_team: ev.home_team,
    away_team: ev.away_team,
    start_time: ev.commence_time,
    status: new Date(ev.commence_time) > new Date() ? 'UPCOMING' : 'LIVE',
    raw_json: JSON.stringify(ev),
    fetched_at: now,
  })));
}

// GET /api/matches/leagues -> list of available competitions for a filter dropdown
router.get('/leagues', async (req, res) => {
  try {
    const leagues = await getSoccerLeagues();
    res.json({ leagues: leagues.map((l) => ({ key: l.key, title: l.title, group: l.group })) });
  } catch (err) {
    res.status(502).json({ error: 'Could not load leagues from odds provider', detail: err.message });
  }
});

// GET /api/matches?league=soccer_epl (optional filter, default: all cached leagues)
router.get('/', async (req, res) => {
  if (!ODDS_API_KEY) {
    return res.json({ matches: [], hasLiveApiKey: false });
  }

  try {
    const leagues = await getSoccerLeagues();
    const targetLeagues = req.query.league
      ? leagues.filter((l) => l.key === req.query.league)
      : leagues; // ALL soccer leagues currently offered by the provider

    for (const l of targetLeagues) {
      await refreshLeagueOdds(l.key);
    }
  } catch (err) {
    console.error('Error refreshing odds:', err.message);
    // fall through and serve whatever is already cached
  }

  const rows = req.query.league
    ? db.prepare('SELECT * FROM matches_cache WHERE league = ? ORDER BY start_time ASC').all(req.query.league)
    : db.prepare('SELECT * FROM matches_cache ORDER BY start_time ASC').all();

  res.json({ matches: rows.map(mapEventToMatch), hasLiveApiKey: true });
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM matches_cache WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Match not found' });
  res.json({ match: mapEventToMatch(row) });
});

export default router;
