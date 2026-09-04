import express from 'express';
import pool, { getKV, setKV } from '../db.js';
import { mapEventToMatch, diffOddsChanges } from '../oddsUtils.js';
import { pushOddsChanged, pushGoal } from '../ws.js';
import { settleMatch } from '../matchSettlement.js';
import { refreshOddsPapi } from '../oddspapi.js';
import { refreshBsd } from '../bsd.js';
import { refreshHighlightly } from '../highlightly.js';
import { refreshOddsApiIo, refreshPrimaryLeagues } from '../oddsapiio.js';
import { refreshApiFootball, apiFootballLeagueSlugs } from '../apiFootballRefresh.js';
import { refreshSportmonks } from '../sportmonks.js';
import { ensureLondon365Import } from '../london365.js';

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
const ODDS_REFRESH_MS = 96 * 60 * 60 * 1000;      // 9 leagues -> every 4 days
const SCORES_REFRESH_MS = 48 * 60 * 60 * 1000;    // every 2 days (leagues with no live match)
const LIVE_SCORES_REFRESH_MS = 60 * 1000;          // every 60s for leagues currently showing a LIVE match

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
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'soccer_brazil_campeonato',
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

const MIN_REMAINING_CREDITS_BUFFER = 0; // no safety buffer (user request) — refresh runs until the account hits 0 credits

// --- Cross-provider fixture deduplication ---------------------------------
// The same game can be cached twice: once from The Odds API (only h2h/totals/
// spreads -> 2-4 markets) and once from LondonPro365 (the full catalog, 80+
// markets). The frontend would then show the sparse card and the user would
// conclude LondonPro365 only has a few markets. This keeps, per fixture, the
// card with the most markets+odds (LondonPro365 wins in practice), while
// preserving the most advanced status (LIVE/FINISHED) from any duplicate.
// Team names are compared fuzzily to survive transliteration differences
// ("Al-Fayha" vs "Al Feiha", "Al-Ittihad" vs "Al Ittihad").
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
function outcomeCount(m) {
  let n = 0;
  for (const mk of m.markets || []) n += (mk.options || []).length;
  return n;
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
      if (cs > bs || (cs === bs && String(c.id).startsWith('l365-') && !String(best.id).startsWith('l365-'))) best = c;
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

    // Odds Engine: diff against what we had before overwriting raw_json.
    const { rows: existingRows } = await pool.query('SELECT raw_json FROM matches_cache WHERE id = $1', [ev.id]);
    if (existingRows[0]) {
      try {
        const oldEv = JSON.parse(existingRows[0].raw_json);
        const changes = diffOddsChanges(ev.id, oldEv, ev);
        for (const c of changes) {
          await pool.query(
            `INSERT INTO odds_history (match_id, market_id, selection_id, old_odds, new_odds, changed_by, reason, created_at)
             VALUES ($1,$2,$3,$4,$5,'SYSTEM','auto_refresh',$6)`,
            [c.matchId, c.marketId, c.selectionId, c.oldOdds, c.newOdds, now]
          );
        }
        if (changes.length > 0) pushOddsChanged(ev.id, { changes });
      } catch (err) {
        console.error('Failed recording odds_history:', err.message);
      }
    }

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

  // Leagues with a match currently LIVE get a much shorter refresh interval
  // so goals show up almost instantly instead of waiting up to 48h.
  const { rows: liveRows } = await pool.query(
    `SELECT 1 FROM matches_cache WHERE league = $1 AND status = 'LIVE' LIMIT 1`,
    [leagueKey]
  );
  const interval = liveRows.length ? LIVE_SCORES_REFRESH_MS : SCORES_REFRESH_MS;
  if (now - last < interval) return;
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
      const prevHome = existing.live_home_score ?? 0;
      const prevAway = existing.live_away_score ?? 0;
      const scoreChanged = homeScore !== prevHome || awayScore !== prevAway;

      await pool.query(
        `UPDATE matches_cache SET status = 'LIVE', live_home_score = $1, live_away_score = $2 WHERE id = $3 AND status != 'FINISHED'`,
        [homeScore, awayScore, ev.id]
      );

      // Live Match Engine: a score bump means a goal happened. Log the
      // event and push it live — the frontend suspends markets for a few
      // seconds and updates the scoreline without any polling/refresh.
      if (scoreChanged) {
        const scoringTeam = homeScore > prevHome ? ev.home_team : ev.away_team;
        await pool.query(
          `INSERT INTO match_events (match_id, minute, type, team, detail, created_at)
           VALUES ($1,NULL,'GOAL',$2,$3,$4)`,
          [ev.id, scoringTeam, `${homeScore}-${awayScore}`, now]
        );
        await pool.query(
          `INSERT INTO live_statistics (match_id, home_score, away_score, updated_at)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (match_id) DO UPDATE SET home_score = excluded.home_score, away_score = excluded.away_score, updated_at = excluded.updated_at`,
          [ev.id, homeScore, awayScore, now]
        );
        pushGoal(ev.id, { homeScore, awayScore, scoringTeam });
      }
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
    try {
      await refreshApiFootball();
    } catch (err) {
      console.error('Error refreshing API-Football:', err.message);
    }
    // No The Odds API key configured: LondonPro365 becomes the primary data
    // source. Seed it in the background (throttled, never blocks the request)
    // and return everything currently cached, including the l365 rows.
    ensureLondon365Import();
    const { rows } = await pool.query('SELECT * FROM matches_cache ORDER BY start_time ASC');
    return res.json({ matches: dedupeMatches(rows.map(mapEventToMatch)), hasLiveApiKey: false });
  }

  try {
    const leagues = await getSoccerLeagues();
    const targetLeagues = req.query.league
      ? leagues.filter((l) => l.key === req.query.league)
      : leagues; // no whitelist — every soccer league the provider returns

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
    await refreshPrimaryLeagues();
    await refreshApiFootball();
    await refreshSportmonks();
    ensureLondon365Import();
  } catch (err) {
    console.error('Error refreshing odds:', err.message);
  }

  // LondonPro365 rows (id 'l365-%') are ALWAYS included — the user wants
  // every match and every coefficient from that source visible regardless
  // of which The Odds API leagues the whitelist currently covers.
  const { rows } = req.query.league
    ? await pool.query('SELECT * FROM matches_cache WHERE league = $1 OR id LIKE $2 ORDER BY start_time ASC', [req.query.league, 'l365-%'])
    : lastTopLeagueKeys.length
      ? await pool.query("SELECT * FROM matches_cache WHERE league = ANY($1::text[]) OR id LIKE 'l365-%' ORDER BY start_time ASC", [[...lastTopLeagueKeys, 'oddsapiio_albania_superiore', ...apiFootballLeagueSlugs()]])
      : await pool.query('SELECT * FROM matches_cache ORDER BY start_time ASC');

  res.json({ matches: dedupeMatches(rows.map(mapEventToMatch)), hasLiveApiKey: true });
});

router.get('/:id/odds-history', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT market_id, selection_id, old_odds, new_odds, changed_by, reason, created_at FROM odds_history WHERE match_id = $1 ORDER BY created_at ASC',
    [req.params.id]
  );
  res.json({ history: rows });
});

// Live stats + match events for the Match Details "Statistika"/"Ngjarjet"
// tabs. Both tables are already populated by the live sync above when the
// source feed provides them (see persistEvent/syncSource) — this just
// exposes what was already being written but never read back.
router.get('/:id/live-detail', async (req, res) => {
  const [{ rows: statsRows }, { rows: eventRows }] = await Promise.all([
    pool.query('SELECT * FROM live_statistics WHERE match_id = $1', [req.params.id]),
    pool.query(
      'SELECT minute, type, team, player, detail, created_at FROM match_events WHERE match_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    ),
  ]);
  res.json({ statistics: statsRows[0] || null, events: eventRows });
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM matches_cache WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Match not found' });
  res.json({ match: mapEventToMatch(rows[0]) });
});

export default router;
