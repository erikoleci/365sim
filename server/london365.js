// LondonPro365 data provider for 365sim.
//
// Pulls every match, market, and coefficient from the londonpro365.com
// backend API (real host: eccoplay365.com) and stores it in matches_cache
// using the canonical The-Odds-API event shape the rest of the app consumes,
// so listing, match detail, bet verification, odds history, and settlement
// all work on this data without changes. A background loop syncs in-play
// scores and real-time odds movement from the livegames endpoint.
//
// Env:
//   LONDON365_ENABLED            1 (default) or 0
//   LONDON365_API                default https://eccoplay365.com
//   LONDON365_ORIGIN             default https://londonpro365.com
//   LONDON365_SPORTS             csv sport ids. DEFAULT '1' (Soccer only).
//                                'all' discovers every sport the provider
//                                exposes (opt-in).
//   LONDON365_ONLY_COUNTRIES     THE catalogue whitelist (csv of the provider's
//                                own country names, case-insensitive).
//                                DEFAULT England,France,Spain,Italy,Germany.
//                                The "International" bucket is always added
//                                and then narrowed by competition NAME (UEFA
//                                Champions/Europa/Conference League, Nations
//                                League, other UEFA/Euro competitions -- never
//                                youth/women's/friendlies, never other
//                                confederations). '*' or 'all' turns the
//                                whitelist OFF (worldwide import, opt-in).
//   LONDON365_MAJOR_ONLY         1 (default) = additionally drop youth /
//                                reserve / women's / amateur / friendly /
//                                virtual leagues and clearly regional or
//                                amateur lower tiers inside the allowed
//                                countries.
//   LONDON365_EXCLUDE_LEAGUE_PATTERN  extra regex of league names to drop
//   LONDON365_INTERNATIONAL_EXTRA     extra regex of International competition
//                                names to KEEP (default none; e.g. 'fifa|world cup')
//   LONDON365_LEAGUES            league cap per sport, 0 = all. Applied AFTER the
//                                filters above, so it can only ever cut wanted
//                                leagues, never let unwanted ones use up slots.
//   LONDON365_PRIORITY_COUNTRIES csv of real country names (as returned by
//                                /ajax/countries, e.g. "England,France,Spain,
//                                Italy,Germany") — when set, ONLY these
//                                countries get the expensive full-detail
//                                fetch (every market/coefficient); every
//                                other country still imports (basic 1X2 +
//                                whatever the list endpoint already includes)
//                                but skips the extra per-game detail request.
//                                Lets you keep full depth for the leagues
//                                that matter most while running "all sports,
//                                no league cap" on limited server memory.
//                                Empty/unset (default) = full detail for
//                                everyone, same as before this option existed.
//   LONDON365_FULL                1 (default) = fetch every market via the detail
//                                endpoint for leagues that ALREADY passed the
//                                filters. It only controls how much detail is
//                                fetched per accepted match; it never widens
//                                (or narrows) WHICH matches are accepted.
//   LONDON365_LIVE_INTERVAL_MS   default 30000 (min 10000)
//   LONDON365_IMPORT_THROTTLE_MS default 600000

// This file keeps the public API of the provider integration; the code lives in ./london365/.
export { resolveSports } from './london365/api.js';
export { isEuropeanInternationalCompetition, isAllowedInternationalCompetition, leagueRejectionReason, getLondon365FilterConfig, logLondon365FilterConfig, isAllowedByCountryFilter } from './london365/leagueRules.js';
export { isLondon365Enabled } from './london365/config.js';
export { parseOddString, decodeMarketName, CANONICAL_KEYS, mapMarketKey, isSparseEvent, fetchDetailRows, fetchLiveRows, buildEvent } from './london365/markets.js';
export { isLiveGameWanted, loadPersistedLeagueMap, getLondon365LeagueNames, getLondon365LeagueMeta } from './london365/leagueRegistry.js';
export { leagueKeyFromCountry, leagueKey, getLondon365CountryDebug } from './london365/leagueKeys.js';
export { isoFromWholeDate, parseScore, statusFromCommence, normalizeLiveMinute, minuteToNumber, eventMinuteFromClock } from './london365/clock.js';
export { upsertMatch, withDbLock, recordGoalIfChanged } from './london365/persist.js';
export { refreshLiveTracker, importLondon365, ensureLondon365Import } from './london365/importer.js';
export { setLondon365SocketConnected } from './london365/liveState.js';
export { shouldSettleMissingLiveMatch, hasRealLiveResult, shouldLogMissingLive, liveConcurrencyFor, runPool, liveCycleDecision, syncLondon365Live, startLondon365LiveLoop } from './london365/liveSync.js';
export { applySocketCoefs, applySocketGame, markLondon365GameEnded, removeSocketCoef } from './london365/socketHandlers.js';
export { repairSparseEvents, purgeStaleLeagues, purgeCrossCountryMisclassifiedLeagues, reconcileGameDetailsSubscriptions, startGameDetailsSubscriptionReconcileLoop, purgeCountryPrefixedDuplicateLeagues, purgeExcludedCountries, purgeCountriesNotInOnlyList, wipeLondon365Data, purgeLegacyLeagueKeyFormat } from './london365/maintenance.js';
export { getLondon365MemoryDiagnostics, getLondon365Status } from './london365/status.js';
