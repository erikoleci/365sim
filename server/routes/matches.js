import express from 'express';
import pool, { getKV, setKV } from '../db.js';
import { mapEventToMatch } from '../oddsUtils.js';
import { settleMatch } from '../matchSettlement.js';
import { refreshOddsPapi } from '../oddspapi.js';
import { refreshBsd } from '../bsd.js';
import { refreshHighlightly } from '../highlightly.js';
import { refreshOddsApiIo } from '../oddsapiio.js';

const router = express.Router();

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// Markets we ask for per match. NOTE: btts / double_chance / draw_no_bet are
// NOT included here because they returned "422 Markets not supported by this
// endpoint" on this account's plan tier (confirmed via Render runtime logs).
const MARKETS = 'h2h,totals,spreads';

// COST MATH (The Odds API): every /odds call costs (markets × regions) credits.
// With 3 markets × 1 region (eu) = 3 credits per league per refresh. The
// /scores endpoint is separate: 2 credits per league per call (with daysFrom,
// needed to catch recently-finished matches, not just currently-live ones).
const LEAGUES_REFRESH_MS = 24 * 60 * 60 * 1000;  // sport list changes rarely -> 24h
const ODDS_REFRESH_MS = 48 * 60 * 60 * 1000;      // odds move slowly -> every 2 days
const SCORES_REFRESH_MS = 24 * 60 * 60 * 1000;    // results checked daily so finished matches settle promptly

// CREDIT BUDGET (500/month on The Odds API free plan): each league costs
// 3 credits/odds-refresh + 2 credits/scores-refresh = 5 credits per full
// cycle. At a 24h cycle, N leagues costs N*5*30 credits/month. With N=4
// that's 600/month — still tight, so we trimmed the list to the leagues
// that matter most rather than trying to cover everything. If you want
// MORE leagues, increase ODDS_REFRESH_MS/SCORES_REFRESH_MS proportionally
// (e.g. 12 leagues needs roughly a 3-4 day cycle to stay under budget).
const TOP_LEAGUES = [
  'soccer_epl',
  'soccer_uefa_champs_league',
  'soccer_spain_la_liga',
  'soccer_fifa_world_cup',
  'soccer_usa_mls',
];

// Keyword matching still catches World Cup / Champions League / Europa /
// Conference League fixtures under any sport_key the provider uses,
// without needing every exact key hardcoded above.
const TOP_LEAGUE_KEYWORDS = ['world cup', 'champions league'];

function isTopLeague(l) {
  if (TOP_LEAGUES.includes(l.key)) return true;
  const title = (l.title || '').toLowerCase();
  return TOP_LEAGUE_KEYWORDS.some((kw) => title.includes(kw));
}

const MIN_REMAINING_CREDITS_BUFFER = 20;

// --- PERSISTED STATE (survives restarts/redeploys via kv_store), loaded
// lazily on first use since module-import happens before initDb() runs. ---
let leaguesCache = { data: [], fetchedAt: 0 };
let oddsRefreshTimers = new Map();
let scoresRefreshTimers = new Map();
let lastKnownRemaining = Infinity;
let lastTopLeagueKeys = [];
let stateLoaded = false;

async function ensureStateLoaded() {
  if (stateLoaded) return;
  stateLoaded = true;
  leaguesCache = await getKV('leaguesCache', { data: [], fetchedAt: 0 });
  oddsRefreshTimers = new Map(Object.entries(await getKV('oddsRefreshTimers', {})));
  scoresRefreshTimers = new Map(Object.entries(await getKV('scoresRefreshTimers', {})));
  lastKnownRemaining = await getKV('lastKnownRemaining', Infinity);
  lastTopLeagueKeys = await getKV('lastTopLeagueKeys', []);
}

async function fetchJson(url) {
  await ensureStateLoaded();
  const resp = await fetch(url);
  const remaining = resp.headers.get('x-requests-remaining');
  const used = resp.headers.get('x-requests-used');
  if (remaining !== null) {
    lastKnownRemaining = Number(remaining);
    await setKV('lastKnownRemaining', lastKnownRemaining);
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
  await ensureStateLoaded();
  const now = Date.now();
  if (leaguesCache.data.length && now - leaguesCache.fetchedAt < LEAGUES_REFRESH_MS) {
    return leaguesCache.data;
  }
  if (!ODDS_API_KEY) return [];
  const all = await fetchJson(`${ODDS_API_BASE}/sports/?apiKey=${ODDS_API_KEY}`);
  const soccer = all.filter((s) => s.group === 'Soccer' && s.active);
  leaguesCache = { data: soccer, fetchedAt: now };
  await setKV('leaguesCache', leaguesCache);
  return soccer;
}

async function refreshLeagueOdds(leagueKey) {
  await ensureStateLoaded();
  const now = Date.now();
  const last = oddsRefreshTimers.get(leagueKey) || 0;
  if (now - last < ODDS_REFRESH_MS) return;
  if (lastKnownRemaining <= MIN_REMAINING_CREDITS_BUFFER) {
    console.warn(`[the-odds-api] Skipping odds refresh of ${leagueKey}: low on monthly credits (${lastKnownRemaining} left).`);
    return;
  }
  oddsRefreshTimers.set(leagueKey, now);
  await setKV('oddsRefreshTimers', Object.fromEntries(oddsRefreshTimers));

  const url = `${ODDS_API_BASE}/sports/${leagueKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=${MARKETS}&oddsFormat=decimal`;
  let events;
  try {
    events = await fetchJson(url);
  } catch (err) {
    console.error(`Failed refreshing odds for ${leagueKey}:`, err.message);
    return;
  }

  for (const ev of events) {
    const status = new Date(ev.commence_time) > new Date() ? 'UPCOMING' : 'LIVE';
    await pool.query(
      `INSERT INTO matches_cache (id, league, home_team, away_team, start_time, status, raw_json, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         status = CASE WHEN matches_cache.status = 'FINISHED' THEN matches_cache.status ELSE excluded.status END,
         raw_json = excluded.raw_json, fetched_at = excluded.fetched_at`,
      [ev.id, leagueKey, ev.home_team, ev.away_team, ev.commence_time, status, JSON.stringify(ev), now]
    );
  }
}

// Pulls real scores (in-play + completed within the last day) and:
//  - auto-settles any match the provider reports as completed via settleMatch()
//  - flips still-in-progress matches to LIVE with a live scoreline
async function refreshLeagueScores(leagueKey) {
  await ensureStateLoaded();
  const now = Date.now();
  const last = scoresRefreshTimers.get(leagueKey) || 0;
  if (now - last < SCORES_REFRESH_MS) return;
  if (lastKnownRemaining <= MIN_REMAINING_CREDITS_BUFFER) {
    console.warn(`[the-odds-api] Skipping scores refresh of ${leagueKey}: low on monthly credits (${lastKnownRemaining} left).`);
    return;
  }
  scoresRefreshTimers.set(leagueKey, now);
  await setKV('scoresRefreshTimers', Object.fromEntries(scoresRefreshTimers));

  const url = `${ODDS_API_BASE}/sports/${leagueKey}/scores/?apiKey=${ODDS_API_KEY}&daysFrom=2&dateFormat=iso`;
  let events;
  try {
    events = await fetchJson(url);
  } catch (err) {
    console.error(`Failed refreshing scores for ${leagueKey}:`, err.message);
    return;
  }

  for (const ev of events) {
    const { rows } = await pool.query('SELECT * FROM matches_cache WHERE id = $1', [ev.id]);
    const existing = rows[0];
    if (!existing || existing.status === 'FINISHED') continue;
    if (!Array.isArray(ev.scores)) continue;

    const homeEntry = ev.scores.find((s) => s.name === ev.home_team);
    const awayEntry = ev.scores.find((s) => s.name === ev.away_team);
    const homeScore = homeEntry ? parseInt(homeEntry.score, 10) : null;
    const awayScore = awayEntry ? parseInt(awayEntry.score, 10) : null;
    if (homeScore === null || awayScore === null || Number.isNaN(homeScore) || Number.isNaN(awayScore)) continue;

    if (ev.completed) {
      await settleMatch(ev.id, homeScore, awayScore);
    } else {
      await pool.query(
        `UPDATE matches_cache SET status = 'LIVE', live_home_score = $1, live_away_score = $2 WHERE id = $3 AND status != 'FINISHED'`,
        [homeScore, awayScore, ev.id]
      );
    }
  }
}

router.get('/leagues', async (req, res) => {
  try {
    const leagues = await getSoccerLeagues();
    res.json({ leagues: leagues.map((l) => ({ key: l.key, title: l.title, group: l.group })) });
  } catch (err) {
    res.status(502).json({ error: 'Could not load leagues from odds provider', detail: err.message });
  }
});

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
      lastTopLeagueKeys = targetLeagues.map((l) => l.key);
      await setKV('lastTopLeagueKeys', lastTopLeagueKeys);
    }
    await refreshOddsPapi();
    await refreshBsd();
    await refreshHighlightly();
    await refreshOddsApiIo();
  } catch (err) {
    console.error('Error refreshing odds:', err.message);
  }

  const { rows } = req.query.league
    ? await pool.query('SELECT * FROM matches_cache WHERE league = $1 ORDER BY start_time ASC', [req.query.league])
    : lastTopLeagueKeys.length
      ? await pool.query('SELECT * FROM matches_cache WHERE league = ANY($1::text[]) ORDER BY start_time ASC', [lastTopLeagueKeys])
      : await pool.query('SELECT * FROM matches_cache ORDER BY start_time ASC');

  res.json({ matches: rows.map(mapEventToMatch), hasLiveApiKey: true });
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM matches_cache WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Match not found' });
  res.json({ match: mapEventToMatch(rows[0]) });
});

export default router;
