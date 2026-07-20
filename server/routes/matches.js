import express from 'express';
import db, { getKV, setKV } from '../db.js';
import { mapEventToMatch } from '../oddsUtils.js';
import { settleMatch } from '../matchSettlement.js';

const router = express.Router();

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// Markets we ask for per match. NOTE: btts / double_chance / draw_no_bet are
// NOT included here because they returned "422 Markets not supported by this
// endpoint" on this account's plan tier (confirmed via Render runtime logs).
// Only request markets your plan actually supports, or every single refresh
// fails outright and no matches ever get cached.
const MARKETS = 'h2h,totals,spreads';

// COST MATH (The Odds API): every /odds call costs (markets × regions) credits.
// With 3 markets × 1 region (eu) = 3 credits per league per refresh. The
// /scores endpoint is separate: 2 credits per league per call (with daysFrom,
// needed to catch recently-finished matches, not just currently-live ones).
//
// Levers, all persisted to kv_store so a redeploy doesn't reset them and
// re-trigger a full-cost refresh of every league (see PERSISTED STATE below):
//  1) ODDS_REFRESH_MS — how often any given league's ODDS are allowed to refresh.
//  2) SCORES_REFRESH_MS — how often any given league's SCORES are checked.
//  3) TOP_LEAGUES — the default "All Top Football" view only refreshes THIS
//     curated list (+ keyword matches), not every competition the provider has.
const LEAGUES_REFRESH_MS = 6 * 60 * 60 * 1000;   // sport list changes rarely -> 6h
const ODDS_REFRESH_MS = 4 * 60 * 60 * 1000;      // odds/lines move slowly -> 4h
const SCORES_REFRESH_MS = 15 * 60 * 1000;        // scores -> check every 15 min so
                                                  // finished matches settle same-day
                                                  // without polling constantly

// Curated set for the default (no-filter) view.
const TOP_LEAGUES = [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'soccer_uefa_champs_league',
  'soccer_uefa_europa_league',
  'soccer_uefa_europa_conference_league',
  'soccer_fifa_world_cup',
  'soccer_fifa_world_cup_qualifiers_europe',
  // The big-5 European leagues are on their summer break roughly June-August,
  // so without these two there can be zero matches for weeks at a time.
  'soccer_usa_mls',
  'soccer_brazil_campeonato',
];

// The provider occasionally renames/adds sport_keys (World Cup qualifiers
// per confederation, cup rebrands, etc). Exact keys above can go stale, so
// also match by title keywords as a fallback net — this is why "world cup"
// and "conference league" show up even if we didn't hardcode the exact key.
const TOP_LEAGUE_KEYWORDS = ['world cup', 'conference league', 'europa league', 'champions league'];

function isTopLeague(l) {
  if (TOP_LEAGUES.includes(l.key)) return true;
  const title = (l.title || '').toLowerCase();
  return TOP_LEAGUE_KEYWORDS.some((kw) => title.includes(kw));
}

// Safety net: if the provider tells us we're nearly out of monthly credits,
// stop calling out entirely and just serve whatever is already cached, so a
// traffic spike can't lock the key out for the rest of the month.
const MIN_REMAINING_CREDITS_BUFFER = 20;

// --- PERSISTED STATE (survives restarts/redeploys via kv_store) ---
let leaguesCache = getKV('leaguesCache', { data: [], fetchedAt: 0 });
let oddsRefreshTimers = new Map(Object.entries(getKV('oddsRefreshTimers', {})));
let scoresRefreshTimers = new Map(Object.entries(getKV('scoresRefreshTimers', {})));
let lastKnownRemaining = getKV('lastKnownRemaining', Infinity);
let lastTopLeagueKeys = getKV('lastTopLeagueKeys', []);

async function fetchJson(url) {
  const resp = await fetch(url);
  const remaining = resp.headers.get('x-requests-remaining');
  const used = resp.headers.get('x-requests-used');
  if (remaining !== null) {
    lastKnownRemaining = Number(remaining);
    setKV('lastKnownRemaining', lastKnownRemaining);
    console.log(`[the-odds-api] requests used=${used} remaining=${remaining}`);
    if (lastKnownRemaining <= MIN_REMAINING_CREDITS_BUFFER) {
      console.warn(`[the-odds-api] WARNING: only ${remaining} credits left this month — throttling further refreshes.`);
    }
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
  setKV('leaguesCache', leaguesCache);
  return soccer;
}

async function refreshLeagueOdds(leagueKey) {
  const now = Date.now();
  const last = oddsRefreshTimers.get(leagueKey) || 0;
  if (now - last < ODDS_REFRESH_MS) return; // still fresh, skip external call
  if (lastKnownRemaining <= MIN_REMAINING_CREDITS_BUFFER) {
    console.warn(`[the-odds-api] Skipping odds refresh of ${leagueKey}: low on monthly credits (${lastKnownRemaining} left).`);
    return; // serve stale cache rather than risk exhausting the plan
  }
  oddsRefreshTimers.set(leagueKey, now);
  setKV('oddsRefreshTimers', Object.fromEntries(oddsRefreshTimers));

  // regions=eu -> vetëm bookmakers evropianë (jo UK/US)
  // oddsFormat=decimal -> koeficient evropian (p.sh. 2.50), JO fractional
  // anglez (3/2) dhe JO american/moneyline (+150)
  const url = `${ODDS_API_BASE}/sports/${leagueKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=${MARKETS}&oddsFormat=decimal`;
  let events;
  try {
    events = await fetchJson(url);
  } catch (err) {
    console.error(`Failed refreshing odds for ${leagueKey}:`, err.message);
    return;
  }

  const insert = db.prepare(`
    INSERT INTO matches_cache (id, league, home_team, away_team, start_time, status, raw_json, fetched_at)
    VALUES (@id, @league, @home_team, @away_team, @start_time, @status, @raw_json, @fetched_at)
    ON CONFLICT(id) DO UPDATE SET
      status=CASE WHEN matches_cache.status = 'FINISHED' THEN matches_cache.status ELSE excluded.status END,
      raw_json=excluded.raw_json, fetched_at=excluded.fetched_at
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

// Pulls real scores (in-play + completed within the last day) and:
//  - auto-settles any match the provider reports as completed (real result,
//    real win/loss on every pending bet) via the shared settleMatch()
//  - flips still-in-progress matches to LIVE with a live scoreline
// This is what makes "matches that already happened" disappear from the
// upcoming list (they become FINISHED with a result) instead of sitting
// there forever marked LIVE with no score, which is what was happening before.
async function refreshLeagueScores(leagueKey) {
  const now = Date.now();
  const last = scoresRefreshTimers.get(leagueKey) || 0;
  if (now - last < SCORES_REFRESH_MS) return;
  if (lastKnownRemaining <= MIN_REMAINING_CREDITS_BUFFER) {
    console.warn(`[the-odds-api] Skipping scores refresh of ${leagueKey}: low on monthly credits (${lastKnownRemaining} left).`);
    return;
  }
  scoresRefreshTimers.set(leagueKey, now);
  setKV('scoresRefreshTimers', Object.fromEntries(scoresRefreshTimers));

  // daysFrom=2 -> also catch matches that finished up to 2 days ago (e.g. the
  // server was asleep / no traffic when a match actually ended).
  const url = `${ODDS_API_BASE}/sports/${leagueKey}/scores/?apiKey=${ODDS_API_KEY}&daysFrom=2&dateFormat=iso`;
  let events;
  try {
    events = await fetchJson(url);
  } catch (err) {
    console.error(`Failed refreshing scores for ${leagueKey}:`, err.message);
    return;
  }

  const updateLive = db.prepare(`
    UPDATE matches_cache SET status = 'LIVE', live_home_score = ?, live_away_score = ?
    WHERE id = ? AND status != 'FINISHED'
  `);

  for (const ev of events) {
    const existing = db.prepare('SELECT * FROM matches_cache WHERE id = ?').get(ev.id);
    if (!existing || existing.status === 'FINISHED') continue; // not tracked, or already settled

    if (!Array.isArray(ev.scores)) continue; // not started yet / no score data

    const homeEntry = ev.scores.find((s) => s.name === ev.home_team);
    const awayEntry = ev.scores.find((s) => s.name === ev.away_team);
    const homeScore = homeEntry ? parseInt(homeEntry.score, 10) : null;
    const awayScore = awayEntry ? parseInt(awayEntry.score, 10) : null;
    if (homeScore === null || awayScore === null || Number.isNaN(homeScore) || Number.isNaN(awayScore)) continue;

    if (ev.completed) {
      settleMatch(ev.id, homeScore, awayScore);
    } else {
      updateLive.run(homeScore, awayScore, ev.id);
    }
  }
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

// GET /api/matches?league=soccer_epl (optional filter, default: curated TOP_LEAGUES only —
// see cost-math comment near TOP_LEAGUES above for why "all provider leagues" isn't the default)
router.get('/', async (req, res) => {
  if (!ODDS_API_KEY) {
    return res.json({ matches: [], hasLiveApiKey: false });
  }

  try {
    const leagues = await getSoccerLeagues();
    const targetLeagues = req.query.league
      ? leagues.filter((l) => l.key === req.query.league)
      : leagues.filter(isTopLeague);

    for (const l of targetLeagues) {
      await refreshLeagueOdds(l.key);
      await refreshLeagueScores(l.key);
    }

    if (!req.query.league) {
      // Remember exactly which keys matched this cycle (title-keyword matches
      // can vary as the provider's list changes) so the SELECT below stays
      // in sync with what was actually just refreshed.
      lastTopLeagueKeys = targetLeagues.map((l) => l.key);
      setKV('lastTopLeagueKeys', lastTopLeagueKeys);
    }
  } catch (err) {
    console.error('Error refreshing odds:', err.message);
    // fall through and serve whatever is already cached
  }

  const rows = req.query.league
    ? db.prepare('SELECT * FROM matches_cache WHERE league = ? ORDER BY start_time ASC').all(req.query.league)
    : lastTopLeagueKeys.length
      ? db.prepare(`SELECT * FROM matches_cache WHERE league IN (${lastTopLeagueKeys.map(() => '?').join(',')}) ORDER BY start_time ASC`).all(...lastTopLeagueKeys)
      : db.prepare('SELECT * FROM matches_cache ORDER BY start_time ASC').all();

  res.json({ matches: rows.map(mapEventToMatch), hasLiveApiKey: true });
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM matches_cache WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Match not found' });
  res.json({ match: mapEventToMatch(row) });
});

export default router;
