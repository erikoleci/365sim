import pool, { getKV, setKV } from './db.js';

// API-Football (api-sports.io) — supplementary fixtures+odds source.
// Free plan: 100 requests/day, 10 req/min, resets 00:00 UTC.
//
// COST MATH: per league we spend 2 requests (1x /fixtures + 1x /odds bulk-
// by-league), so ~40 leagues/day fits inside 100 with a safety buffer.
// This runs once per 24h (fixtures/odds for a whole league don't need
// faster refresh on a free plan) and stops early if the account is close
// to its daily cap, so it never starves the primary providers.

const KEY = process.env.API_FOOTBALL_KEY || '';
const BASE = 'https://v3.football.api-sports.io';
const REFRESH_MS = 24 * 60 * 60 * 1000;
const DAILY_BUDGET = 100;
const SAFETY_BUFFER = 15; // stop once fewer than this many requests remain today
const SEASON = new Date().getUTCFullYear();

// Curated leagues across many countries/confederations — id = API-Football
// league id, slug = internal league key used in matches_cache (prefixed
// 'apifootball_' so it never collides with The Odds API's sport_key space).
// Not already covered by the other providers in this repo (oddsUtils/
// oddsapiio) get treated as PRIMARY (own matches_cache rows); everything
// here is currently primary-only for simplicity.
const LEAGUES = [
  { id: 39, slug: 'apifootball_england_premier', country: 'England' },
  { id: 140, slug: 'apifootball_spain_laliga', country: 'Spain' },
  { id: 135, slug: 'apifootball_italy_seriea', country: 'Italy' },
  { id: 78, slug: 'apifootball_germany_bundesliga', country: 'Germany' },
  { id: 61, slug: 'apifootball_france_ligue1', country: 'France' },
  { id: 94, slug: 'apifootball_portugal_liga', country: 'Portugal' },
  { id: 88, slug: 'apifootball_netherlands_eredivisie', country: 'Netherlands' },
  { id: 203, slug: 'apifootball_turkey_superlig', country: 'Turkey' },
  { id: 144, slug: 'apifootball_belgium_proleague', country: 'Belgium' },
  { id: 179, slug: 'apifootball_scotland_premiership', country: 'Scotland' },
  { id: 218, slug: 'apifootball_albania_superliga', country: 'Albania' },
  { id: 331, slug: 'apifootball_kosovo_superliga', country: 'Kosovo' },
  { id: 172, slug: 'apifootball_serbia_superliga', country: 'Serbia' },
  { id: 210, slug: 'apifootball_croatia_1hnl', country: 'Croatia' },
  { id: 197, slug: 'apifootball_greece_superleague', country: 'Greece' },
  { id: 71, slug: 'apifootball_brazil_serieA', country: 'Brazil' },
  { id: 128, slug: 'apifootball_argentina_liga', country: 'Argentina' },
  { id: 253, slug: 'apifootball_usa_mls', country: 'USA' },
  { id: 262, slug: 'apifootball_mexico_liga_mx', country: 'Mexico' },
  { id: 307, slug: 'apifootball_saudi_prolg', country: 'Saudi Arabia' },
  { id: 98, slug: 'apifootball_japan_j1', country: 'Japan' },
  { id: 292, slug: 'apifootball_southkorea_kleague1', country: 'South Korea' },
  { id: 2, slug: 'apifootball_uefa_champions_league', country: 'Europe' },
  { id: 3, slug: 'apifootball_uefa_europa_league', country: 'Europe' },
  { id: 848, slug: 'apifootball_uefa_conference_league', country: 'Europe' },
];

let remainingToday = Infinity;

async function callApi(endpoint, params) {
  if (!KEY) return null;
  const url = `${BASE}${endpoint}?${new URLSearchParams(params)}`;
  let res;
  try {
    res = await fetch(url, { headers: { 'x-apisports-key': KEY } });
  } catch (err) {
    console.error(`[api-football] network error on ${endpoint}:`, err.message);
    return null;
  }
  const remainingHeader = res.headers.get('x-ratelimit-requests-remaining');
  if (remainingHeader !== null) remainingToday = Number(remainingHeader);

  if (!res.ok) {
    console.error(`[api-football] HTTP ${res.status} on ${endpoint}`);
    return null;
  }
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length > 0) {
    console.error(`[api-football] API error on ${endpoint}:`, JSON.stringify(data.errors));
    return null;
  }
  return data.response;
}

function mapFixtureStatus(shortStatus) {
  if (['1H', '2H', 'HT', 'ET', 'P', 'LIVE'].includes(shortStatus)) return 'LIVE';
  if (['FT', 'AET', 'PEN'].includes(shortStatus)) return 'FINISHED';
  return 'UPCOMING';
}

// Bet365's bookmaker id in API-Football's /odds/bookmakers list — falls
// back to whatever the first bookmaker in the response is if unavailable.
const PREFERRED_BOOKMAKER_ID = 8;

async function refreshLeague({ id, slug }) {
  const fixtures = await callApi('/fixtures', { league: id, season: SEASON, next: 20 });
  if (!fixtures || !fixtures.length) return;

  const oddsResp = await callApi('/odds', { league: id, season: SEASON, bookmaker: PREFERRED_BOOKMAKER_ID });
  const oddsByFixture = new Map();
  for (const entry of oddsResp || []) {
    oddsByFixture.set(entry.fixture?.id, entry.bookmakers || []);
  }

  for (const f of fixtures) {
    const fixtureId = f.fixture?.id;
    const home = f.teams?.home?.name;
    const away = f.teams?.away?.name;
    const homeLogo = f.teams?.home?.logo || null;
    const awayLogo = f.teams?.away?.logo || null;
    const startTime = f.fixture?.date;
    if (!fixtureId || !home || !away || !startTime) continue;

    const status = mapFixtureStatus(f.fixture?.status?.short);
    const rawBookmakers = oddsByFixture.get(fixtureId) || [];
    const bookmakers = rawBookmakers.map((bm) => ({
      title: `API-Football:${bm.name || 'bookmaker'}`,
      markets: (bm.bets || [])
        .filter((bet) => bet.name === 'Match Winner')
        .map((bet) => ({
          key: 'h2h',
          outcomes: bet.values.map((v) => ({
            name: v.value === 'Home' ? home : v.value === 'Away' ? away : 'Draw',
            price: Number(v.odd),
          })),
        })),
    }));

    const id = `apifootball_${fixtureId}`;
    await pool.query(
      `INSERT INTO matches_cache (id, league, home_team, away_team, start_time, status, raw_json, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         status = excluded.status, raw_json = excluded.raw_json, fetched_at = excluded.fetched_at`,
      [id, slug, home, away, startTime, status, JSON.stringify({ id, home_team: home, away_team: away, home_team_logo: homeLogo, away_team_logo: awayLogo, bookmakers }), Date.now()]
    );
  }
}

export async function refreshApiFootball() {
  if (!KEY) return;
  const last = await getKV('apifootball_last', 0);
  if (Date.now() - last < REFRESH_MS) return;
  await setKV('apifootball_last', Date.now());

  for (const league of LEAGUES) {
    if (remainingToday < SAFETY_BUFFER) {
      console.log(`[api-football] stopping early — ${remainingToday} requests left today (buffer ${SAFETY_BUFFER})`);
      break;
    }
    try {
      await refreshLeague(league);
    } catch (err) {
      console.error(`[api-football] failed to refresh ${league.slug}:`, err.message);
    }
  }
}

export function apiFootballLeagueSlugs() {
  return LEAGUES.map((l) => l.slug);
}
