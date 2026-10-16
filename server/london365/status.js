// Diagnostics: memory/state sizes and the status report behind the admin endpoints.
import pool, { getKV } from '../db.js';
import { oddsHistoryMode } from '../oddsHistoryPolicy.js';
import { getLiveTrackerDiagnostics } from '../liveTracker.js';
import { snapshot as feedStatsSnapshot } from '../feedStats.js';
import { countryMapCache, leagueById, leagueNameIndex } from './leagueRegistry.js';
import { marketNameById } from './markets.js';
import { dbWriteLocks } from './persist.js';
import { missedLiveCycles, socketConnected, lastLiveSyncAt } from './liveState.js';
import { ENABLED, API_BASE, SPORTS_RAW, FULL_DETAIL, LEAGUE_LIMIT, PRIORITY_COUNTRIES, ONLY_COUNTRIES, LIVE_INTERVAL_MS } from './config.js';
import { resolvedSports } from './api.js';
import { getLondon365FilterConfig } from './leagueRules.js';
import { lastImportMemo } from './importState.js';

export function getLondon365MemoryDiagnostics() {
  return {
    countryMapCache: countryMapCache.size,
    leagueById: leagueById.size,
    leagueNameIndex: leagueNameIndex.size,
    marketNameById: marketNameById.size,
    dbWriteLocks: dbWriteLocks.size,
    missedLiveCycles: missedLiveCycles.size,
  };
}
export async function getLondon365Status() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS matches,
            COUNT(*) FILTER (WHERE status = 'LIVE')::int AS live,
            COUNT(*) FILTER (WHERE status = 'UPCOMING')::int AS upcoming,
            COUNT(*) FILTER (WHERE status = 'FINISHED')::int AS finished
     FROM matches_cache WHERE id LIKE 'l365-%'`
  );
  return {
    enabled: ENABLED,
    socketConnected: socketConnected,
    apiBase: API_BASE,
    sports: resolvedSports || SPORTS_RAW,
    fullDetail: FULL_DETAIL,
    leagueLimit: LEAGUE_LIMIT,
    priorityCountries: Array.from(PRIORITY_COUNTRIES),
    onlyCountries: Array.from(ONLY_COUNTRIES),
    filter: getLondon365FilterConfig(),
    liveIntervalMs: LIVE_INTERVAL_MS,
    matches: rows[0].matches,
    liveMatches: rows[0].live,
    upcomingMatches: rows[0].upcoming,
    finishedMatches: rows[0].finished,
    lastImport: lastImportMemo != null ? lastImportMemo : await getKV('l365_last_import', 0),
    lastLiveSync: lastLiveSyncAt || null,
    oddsHistoryMode: oddsHistoryMode(),
    liveTracker: getLiveTrackerDiagnostics(),
    // Rolling counters since the last [feed-stats] log line (default 10 min):
    // how many upserts were written vs skipped as unchanged, socket messages
    // dropped without touching the DB, odds_history rows written/skipped, etc.
    feedStats: feedStatsSnapshot(),
    leagues: (await getKV('l365_leagues', [])).length,
    // Raw league names exactly as the provider sends them — paste this list
    // back for an accurate country-name mapping instead of guessing at the
    // provider's naming format.
    leagueNames: await getKV('l365_leagues', []),
  };
}
