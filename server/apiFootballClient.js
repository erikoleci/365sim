import { getKV, setKV } from './db.js';

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || '';
const BASE = 'https://v3.football.api-sports.io';

// Free plan = 100 requests/DAY (not per-minute) — this is the hard constraint
// that shapes every interval below. Every function here is throttled AND
// persisted via kv_store so a redeploy never resets the clock and re-spends
// the day's budget.
const MIN_REMAINING_BUFFER = 5; // stop calling out once this close to the daily cap

// League IDs are API-Football's own numbering (different from The Odds API's
// string keys). These are the well-known, stable IDs for major competitions.
// seasonFor(date) returns the "season year" API-Football expects: European
// domestic leagues + UEFA cups run Aug-May and are keyed by their START year
// (so July 2026 is still season 2025 for these); calendar-year competitions
// (World Cup, MLS, Brazil) are keyed by the current year instead.
const EURO_SEASON = (d) => (d.getMonth() + 1 >= 7 ? d.getFullYear() : d.getFullYear() - 1);
const CALENDAR_SEASON = (d) => d.getFullYear();

export const TOP_LEAGUES = [
  { id: 39, name: 'Premier League', seasonFor: EURO_SEASON },
  { id: 140, name: 'La Liga', seasonFor: EURO_SEASON },
  { id: 135, name: 'Serie A', seasonFor: EURO_SEASON },
  { id: 78, name: 'Bundesliga', seasonFor: EURO_SEASON },
  { id: 61, name: 'Ligue 1', seasonFor: EURO_SEASON },
  { id: 2, name: 'UEFA Champions League', seasonFor: EURO_SEASON },
  { id: 3, name: 'UEFA Europa League', seasonFor: EURO_SEASON },
  { id: 848, name: 'UEFA Europa Conference League', seasonFor: EURO_SEASON },
  { id: 1, name: 'World Cup', seasonFor: CALENDAR_SEASON },
  { id: 253, name: 'MLS', seasonFor: CALENDAR_SEASON },
  { id: 71, name: 'Brazil Serie A', seasonFor: CALENDAR_SEASON },
];

let lastKnownRemaining = getKV('af_lastKnownRemaining', Infinity);
let fixturesRefreshTimers = new Map(Object.entries(getKV('af_fixturesRefreshTimers', {})));
let oddsRefreshTimers = new Map(Object.entries(getKV('af_oddsRefreshTimers', {})));

const FIXTURES_REFRESH_MS = 20 * 60 * 1000;   // status/live-score freshness
const ODDS_REFRESH_MS = 4 * 60 * 60 * 1000;   // odds move slowly, and cost the same 1 req either way

export async function fetchJson(path) {
  const resp = await fetch(`${BASE}${path}`, {
    headers: { 'x-apisports-key': API_FOOTBALL_KEY },
  });
  const remaining = resp.headers.get('x-ratelimit-requests-remaining');
  if (remaining !== null) {
    lastKnownRemaining = Number(remaining);
    setKV('af_lastKnownRemaining', lastKnownRemaining);
    console.log(`[api-football] requests remaining today: ${remaining}`);
    if (lastKnownRemaining <= MIN_REMAINING_BUFFER) {
      console.warn(`[api-football] WARNING: only ${remaining} requests left today — throttling further refreshes.`);
    }
  }
  const body = await resp.json();
  const errCount = Array.isArray(body.errors) ? body.errors.length : Object.keys(body.errors || {}).length;
  if (!resp.ok || errCount) {
    throw new Error(`API-Football error: ${resp.status} ${JSON.stringify(body.errors || body)}`);
  }
  return body.response;
}

export function shouldSkipForBudget() {
  return lastKnownRemaining <= MIN_REMAINING_BUFFER;
}

function throttled(map, kvKey, key, minIntervalMs) {
  const now = Date.now();
  const last = map.get(key) || 0;
  if (now - last < minIntervalMs) return false; // still fresh, skip
  map.set(key, now);
  setKV(kvKey, Object.fromEntries(map));
  return true;
}

export function canRefreshFixtures(leagueId) {
  return throttled(fixturesRefreshTimers, 'af_fixturesRefreshTimers', leagueId, FIXTURES_REFRESH_MS);
}
export function canRefreshOdds(leagueId) {
  return throttled(oddsRefreshTimers, 'af_oddsRefreshTimers', leagueId, ODDS_REFRESH_MS);
}

export function hasApiKey() {
  return !!API_FOOTBALL_KEY;
}
