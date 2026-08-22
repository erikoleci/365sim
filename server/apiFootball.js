// API-Football (api-sports.io) client — supplementary league/fixture source.
//
// Free plan: 100 requests/day, 10 req/min, resets 00:00 UTC. Set API_FOOTBALL_KEY
// in your environment. Get a free key at https://dashboard.api-football.com/register
//
// This is additive to the existing oddsUtils.js (The Odds API) — use it to pull
// fixtures/leagues that your primary odds source doesn't cover. Odds quality on
// the free plan is limited; fixtures/leagues/standings coverage is the main value.

const BASE_URL = 'https://v3.football.api-sports.io';
const API_KEY = process.env.API_FOOTBALL_KEY;

// Simple in-memory cache to stay within the 100 req/day free cap.
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function apiFootballFetch(endpoint, params = {}) {
  if (!API_KEY) {
    throw new Error('API_FOOTBALL_KEY not set. Get a free key at https://dashboard.api-football.com/register');
  }

  const cacheKey = `${endpoint}?${new URLSearchParams(params)}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = `${BASE_URL}${endpoint}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: { 'x-apisports-key': API_KEY },
  });

  if (!res.ok) {
    throw new Error(`API-Football error ${res.status} for ${endpoint}`);
  }

  const data = await res.json();

  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(`API-Football returned errors: ${JSON.stringify(data.errors)}`);
  }

  // Log remaining daily quota so you can see how close you are to the cap.
  const remaining = res.headers.get('x-ratelimit-requests-remaining');
  if (remaining !== null) {
    console.log(`[api-football] requests remaining today: ${remaining}`);
  }

  cache.set(cacheKey, { data, ts: Date.now() });
  return data;
}

// List all available leagues/competitions (cache this — it barely changes).
export async function fetchLeagues({ country, season } = {}) {
  const params = {};
  if (country) params.country = country;
  if (season) params.season = season;
  const data = await apiFootballFetch('/leagues', params);
  return data.response;
}

// Fixtures for a given league + season (and optionally a date).
export async function fetchFixtures({ league, season, date, live } = {}) {
  const params = {};
  if (league) params.league = league;
  if (season) params.season = season;
  if (date) params.date = date; // YYYY-MM-DD
  if (live) params.live = 'all';
  const data = await apiFootballFetch('/fixtures', params);
  return data.response;
}

// Standings for a league + season.
export async function fetchStandings({ league, season }) {
  const data = await apiFootballFetch('/standings', { league, season });
  return data.response;
}

// Odds for a specific fixture (free plan coverage/depth is limited —
// treat this as a fallback/cross-check, not your primary odds feed).
export async function fetchFixtureOdds({ fixture, bookmaker } = {}) {
  const params = { fixture };
  if (bookmaker) params.bookmaker = bookmaker;
  const data = await apiFootballFetch('/odds', params);
  return data.response;
}

// Quota check — call this to see how many requests you have left today.
export async function checkStatus() {
  const data = await apiFootballFetch('/status');
  return data.response;
}
