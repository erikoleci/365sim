// The prematch import: every league, game and market the provider carries.
import { bump } from '../feedStats.js';
import pool, { setKV, getKV } from '../db.js';
import { applyTrackerSnapshot } from '../liveTracker.js';
import { hydrateBetMatchIds } from '../oddsHistoryPolicy.js';
import { ENABLED, FULL_DETAIL, LEAGUE_LIMIT, EXCLUDED_COUNTRIES, ONLY_COUNTRIES, TOP_PRIORITY_COUNTRIES, SORT_PRIORITY_COUNTRIES, TEST_MODE, TEST_LEAGUE_NAMES, TEST_CONCURRENCY, PRIORITY_COUNTRIES, wantsFullDetailFor, DETAIL_CONCURRENCY, DETAIL_DELAY_MS, sleep, runWithConcurrency, IMPORT_THROTTLE_MS } from './config.js';
import { ensureMarketNamesLoaded, fetchDetailRows, parseOddString, hydrateRowNames, buildEvent, marketNameById } from './markets.js';
import { resolveSports, api } from './api.js';
import { getCountryMap, leagueById, registerLeagueName } from './leagueRegistry.js';
import { leagueRejectionReason } from './leagueRules.js';
import { leagueKeyFromCountry, leagueCountryToken } from './leagueKeys.js';
import { isoFromWholeDate, statusFromCommence } from './clock.js';
import { upsertMatch } from './persist.js';
import { purgeCountryPrefixedDuplicateLeagues, purgeCountriesNotInOnlyList, reconcileGameDetailsSubscriptions } from './maintenance.js';
import { setLastImportAt, lastImportMemo, getLastImportAt } from './importState.js';

export let importRunning = false;
// Resume cursors are a crash-recovery aid, not data. Writing one per country
// and per league (dozens-hundreds of kv_store UPSERTs per import) bought
// nothing over writing at most one per CURSOR_MIN_INTERVAL_MS: after an
// interruption the import resumes at most that many seconds of work behind.
// The cursors are still cleared unconditionally when a pass completes.
export const CURSOR_MIN_INTERVAL_MS = Math.max(0, Number(process.env.LONDON365_CURSOR_WRITE_MS || 30000));
export const cursorLastWrite = new Map();
export async function setCursorThrottled(key, value) {
  const now = Date.now();
  if (now - (cursorLastWrite.get(key) || 0) < CURSOR_MIN_INTERVAL_MS) { bump('kv.cursor_skipped'); return; }
  cursorLastWrite.set(key, now);
  await setKV(key, value);
}
// (Re)load which l365 matches exist / are LIVE from the DB. Called at boot and
// after every completed import (after the purges, so deleted rows drop out).
export async function refreshLiveTracker() {
  const startedAt = Date.now();
  const { rows } = await pool.query("SELECT id, status FROM matches_cache WHERE id LIKE 'l365-%'");
  applyTrackerSnapshot(rows, startedAt);
  return rows.length;
}
// Full import: every sport, then every league, then every match, every market.
export async function importLondon365(opts) {
  opts = opts || {};
  if (!ENABLED) throw new Error('LondonPro365 provider is disabled (LONDON365_ENABLED=0)');
  if (importRunning) return { skipped: true, reason: 'import already running' };
  importRunning = true;

  await ensureMarketNamesLoaded();
  const sports = opts.sports || (await resolveSports());
  const full = opts.full === undefined ? FULL_DETAIL : !!opts.full;
  const leagueCap = opts.leagues === undefined ? LEAGUE_LIMIT : Number(opts.leagues) || 0;
  const matchCap = Number(opts.matches) || 0;

  const leaguesSeen = new Set(await getKV('l365_leagues', []));
  let matchCount = 0;
  let coefficientCount = 0;
  let detailOkCount = 0;
  let detailFailCount = 0;
  let skippedDateCount = 0;
  let skippedNoOddsCount = 0;
  // Every league seen this run, with how many of its games actually made it
  // into matches_cache vs got skipped for a bad date — so "England only
  // shows 3 leagues" or "Premier League has 0 matches" can be confirmed or
  // ruled out directly from this one log line instead of guessed at.
  const leagueSummary = new Map(); // countryName -> [{ name, id, imported, skipped }]

  try {
    // Soccer (sport id 1) first, always — it's where every priority country
    // config lives and what people actually check first. Same interruption
    // concern as the league-level sort below, one level up.
    const sportsOrdered = sports.slice().sort((a, b) => (Number(a) === 1 ? 0 : 1) - (Number(b) === 1 ? 0 : 1));
    for (const sid of sportsOrdered) {
      // Real country.id -> country.name map for this sport (cached — see
      // getCountryMap). A failure here never aborts the import: it just
      // means every league in this sport falls back to the name heuristic
      // below, same as before this change.
      let countryMap = new Map();
      try {
        countryMap = await getCountryMap(sid);
      } catch (err) {
        console.error('[london365] countries sport ' + sid + ' failed (falling back to name-based country guessing):', err.message);
      }

      // CONFIRMED against the live provider (real request/response pairs,
      // not guessed): /ajax/leagues/{X} is keyed by COUNTRY id, not sport
      // id — every league object it returns shares the SAME country_id as
      // whatever id you passed in (e.g. /ajax/leagues/64 -> only England's
      // leagues, every one with country_id: "64"). There is no single
      // "all leagues for this sport" endpoint. The previous code called
      // /ajax/leagues/{sportId} once (e.g. /ajax/leagues/1) expecting every
      // country's leagues back — that request is really just "leagues of
      // country #1" (whatever the provider's country id 1 actually is),
      // which is exactly why the import only ever saw ~14 leagues total and
      // England/France/Spain/Italy/Germany (real country ids like 64) never
      // appeared. The correct path is sport -> countries -> leagues(per
      // country) -> games, so we now fetch /ajax/leagues/{countryId} once
      // per country instead.
      //
      // Countries are visited priority-first (same rationale the old
      // pre-cap sort used) so a redeploy/crash/throttle mid-import still
      // lands England/Spain/Italy/Germany/France before anything else, and
      // EXCLUDED_COUNTRIES/ONLY_COUNTRIES are applied here — before any
      // network call — so an unwanted country never even costs a request.
      const countryEntries = Array.from(countryMap.entries()) // [countryId, countryName][]
        .filter(([, name]) => !EXCLUDED_COUNTRIES.has(String(name).toLowerCase()))
        .filter(([, name]) => !ONLY_COUNTRIES.size || ONLY_COUNTRIES.has(String(name).toLowerCase()))
        .sort((a, b) => {
          const rank = (name) => {
            const n = String(name).toLowerCase();
            if (TOP_PRIORITY_COUNTRIES.has(n)) return 0; // International/UEFA/World first, always
            if (SORT_PRIORITY_COUNTRIES.has(n)) return 1; // then England/Spain/Italy/Germany/France/...
            return 2; // everyone else
          };
          return rank(a[1]) - rank(b[1]);
        });

      // RESUME CURSOR — a redeploy/env-var-change/crash mid-import used to
      // always restart processing from index 0 of the (priority-sorted)
      // list, i.e. it NEVER got past England if anything interrupted it
      // before finishing. We now persist which country we finished last and
      // rotate the list to continue from there, so repeated interruptions
      // make forward progress across the whole catalog instead of hammering
      // the same first few countries forever. Once a full pass completes,
      // the cursor resets to the top so priority countries get refreshed
      // regularly on a healthy/uninterrupted run.
      const cursorCountry = await getKV('l365_country_cursor', null);
      let orderedCountryEntries = countryEntries;
      if (cursorCountry) {
        const idx = countryEntries.findIndex(([, name]) => name === cursorCountry);
        if (idx > 0) orderedCountryEntries = [...countryEntries.slice(idx), ...countryEntries.slice(0, idx)];
      }

      let leagues = [];
      for (const [countryId, countryName] of orderedCountryEntries) {
        let countryLeagues;
        try {
          countryLeagues = await api('/ajax/leagues/' + countryId);
        } catch (err) {
          console.error('[london365] leagues for country ' + countryName + ' (id=' + countryId + ') failed:', err.message);
          continue;
        }
        if (Array.isArray(countryLeagues)) leagues.push(...countryLeagues);
        await setCursorThrottled('l365_country_cursor', countryName);
      }
      // Full pass completed with nothing left to interrupt it — reset the
      // cursor so the next run starts from the top (International/England)
      // again instead of resuming mid-list forever.
      // FILTER FIRST, cap second. Applying the catalogue rule here (in addition
      // to the per-league guard in processLeague) means (a) rejected leagues
      // never reach the per-league loop, and (b) LONDON365_LEAGUES can only ever
      // trim WANTED leagues -- before this, International's unwanted leagues
      // (Copa Libertadores, AFC...) sorted first and consumed the cap.
      {
        const rejected = {};
        const kept = [];
        for (const l of leagues) {
          const cName = l.country_id != null ? countryMap.get(String(l.country_id)) : null;
          const reason = leagueRejectionReason(l.name, cName);
          if (reason) { rejected[reason] = (rejected[reason] || 0) + 1; bump('import.league_rejected'); continue; }
          kept.push(l);
        }
        console.log(
          '[london365] catalogue filter (sport ' + sid + '): kept ' + kept.length + '/' + leagues.length +
          ' leagues' + (Object.keys(rejected).length ? ' — rejected ' + JSON.stringify(rejected) : '')
        );
        leagues = kept;
      }
      if (leagueCap) leagues = leagues.slice(0, leagueCap);

      if (TEST_MODE) {
        const before = leagues.length;
        leagues = leagues.filter((l) => TEST_LEAGUE_NAMES.has(String(l.name || '').toLowerCase()));
        console.log('[london365] TEST MODE: England, Spain, Germany, France, Italy + UCL + UEL');
        console.log('[london365] parallel workers: ' + TEST_CONCURRENCY + ' (' + leagues.length + '/' + before + ' leagues matched)');
      }

      // RESUME CURSOR (correct spot this time) — the SLOW part of the
      // import is THIS loop (one HTTP request per league for games, then
      // one more per game for full market detail), not the league-list
      // collection above (which is fast, just metadata, and normally
      // finishes even on an interrupted run). A redeploy/crash/env-var
      // change used to always restart THIS loop from leagues[0] — which,
      // since leagues[] is built in country-priority order, meant it kept
      // re-doing International/England's leagues and never reliably got
      // through Spain/Italy/Germany/France on a host that redeploys often.
      // Persist the last successfully-processed league id and rotate the
      // array to continue right after it; once a full lap completes with
      // nothing left to interrupt it, the cursor clears so priority
      // leagues resume getting refreshed first on healthy runs.
      const leagueCursor = TEST_MODE ? null : await getKV('l365_league_cursor', null);
      if (leagueCursor) {
        const idx = leagues.findIndex((l) => String(l.id) === String(leagueCursor));
        if (idx >= 0 && idx + 1 < leagues.length) leagues = [...leagues.slice(idx + 1), ...leagues.slice(0, idx + 1)];
      }

      const processLeague = async (league) => {
        const t0 = TEST_MODE ? Date.now() : 0;
        if (!TEST_MODE) await setCursorThrottled('l365_league_cursor', league.id);
        // Resolve country BEFORE the games fetch — otherwise a league with
        // zero current games (very normal, most leagues are between
        // matchdays most of the time) or a failed games fetch skipped
        // silently, leaving zero trace in the logs. This was invisible for
        // exactly the leagues people check most (Premier League, La Liga)
        // whenever the provider had nothing/failed for them at that moment.
        const countryId = league.country_id != null ? String(league.country_id) : null;
        const countryName = countryId ? countryMap.get(countryId) : null;
        if (countryId && !countryName) {
          console.warn('[london365] WARNING: unknown country_id=' + countryId + ' for league=' + league.name + ' (id=' + league.id + ')');
        }
        const isPriority = countryName && PRIORITY_COUNTRIES.has(countryName.toLowerCase());
        // Same single rule as the list-building filter above (guard: also
        // covers TEST_MODE, which re-selects leagues by name after it).
        if (leagueRejectionReason(league.name, countryName)) return;

        let games;
        try {
          games = await api('/ajax/gamesByLeague/' + league.id);
        } catch (err) {
          console.error('[london365] games for ' + league.name + ' (' + (countryName || '?') + ') failed:', err.message);
          return;
        }
        if (!Array.isArray(games) || games.length === 0) {
          // Only log the empty case for priority countries — for everyone
          // else this is routine (most leagues have nothing on a given day)
          // and would just flood the log.
          if (isPriority) console.log('[london365] ' + league.name + ' (' + countryName + '): provider returned 0 games right now');
          return;
        }
        if (matchCap) games = games.slice(0, matchCap);

        // Ground-truth cross-check: every game from /ajax/gamesByLeague
        // carries its own `country`/`country_id` fields directly, no join
        // needed — self-verified against the live provider. If the
        // countries-endpoint lookup above came up empty (unknown/missing
        // country_id, or the countries call itself failed for this sport),
        // this recovers the correct country from the games response itself
        // instead of falling all the way back to the name-guessing
        // heuristic. Doesn't override a countryName we already trust.
        const effectiveCountryName = countryName || (games[0] && games[0].country) || null;
        if (!countryName && effectiveCountryName) {
          console.log('[london365] recovered country="' + effectiveCountryName + '" for league=' + league.name + ' from game payload (countries lookup missed it)');
        }

        const leagueKeyResolved = leagueKeyFromCountry(effectiveCountryName, league.name);
        console.log(
          '[london365] league ' + league.id + ' -> ' + league.name + ' -> ' +
          (effectiveCountryName || '(fallback: ' + leagueCountryToken(league.name) + ')')
        );
        leagueById.set(String(league.id), {
          key: leagueKeyResolved,
          name: league.name,
          // Provider's own numeric league id, kept on the entry itself (not
          // just as the leagueById Map key) so resolveLeagueByName's
          // name-based fallback -- which returns this SAME object via
          // leagueNameIndex, not a leagueById lookup -- also carries it.
          id: String(league.id),
          countryId: countryId,
          countryName: effectiveCountryName || null,
        });
        registerLeagueName(leagueById.get(String(league.id)));
        const summaryKey = effectiveCountryName || '(fallback: ' + leagueCountryToken(league.name) + ')';
        const summaryEntry = { name: league.name, id: String(league.id), imported: 0, skipped: 0, providerGames: games.length };
        if (!leagueSummary.has(summaryKey)) leagueSummary.set(summaryKey, []);
        leagueSummary.get(summaryKey).push(summaryEntry);

        // Full per-game detail (every market) is the expensive part — one
        // extra HTTP request + a fixed delay per game. When priority
        // countries are configured, everyone else skips straight to the
        // list-level odds (still real matches, still 1X2 + main markets,
        // just not the full catalog) so the priority leagues can run with
        // no league/sport cap without exhausting memory or request budget.
        const fetchFullDetail = full && wantsFullDetailFor(countryName);

        // Bounded concurrency instead of one game at a time: this host gets
        // redeployed often enough (by design — frequent small fixes) that a
        // purely sequential detail-fetch loop rarely got a chance to finish
        // even the priority countries before being interrupted, restarting
        // the whole pass. Processing DETAIL_CONCURRENCY games at once cuts
        // wall-clock time roughly by that factor while each individual
        // request still gets its own DETAIL_DELAY_MS pacing — so per-request
        // load on the provider is unchanged, only the number of requests
        // in flight at once goes up a little.
        const concurrency = fetchFullDetail ? DETAIL_CONCURRENCY : games.length || 1;
        for (let i = 0; i < games.length; i += concurrency) {
          const batch = games.slice(i, i + concurrency);
          await Promise.all(batch.map(async (game) => {
            let rows = [];
            if (fetchFullDetail) {
              try {
                if (DETAIL_DELAY_MS) await sleep(DETAIL_DELAY_MS);
                rows = await fetchDetailRows(game.id);
                detailOkCount++;
              } catch (err) {
                detailFailCount++;
                console.error('[london365] detail ' + game.id + ' failed (falling back to sparse list odds):', err.message);
              }
            }
            if (!rows.length) rows = parseOddString(game.odd);
            rows = hydrateRowNames(rows.filter(function (r) { return r ? !Number.isNaN(r.coef) : false; }));
            if (!rows.length) {
              skippedNoOddsCount++;
              summaryEntry.skipped++;
              console.warn(
                '[london365] skipping game ' + game.id + ' (' + league.name + '): zero usable odds rows — ' +
                'fetchFullDetail=' + fetchFullDetail + ', raw odd field: ' + JSON.stringify(game.odd)
              );
              return;
            }

            const commenceTime = isoFromWholeDate(game.whole_date, game.game_date, game.game_time);
            if (!commenceTime) {
              skippedDateCount++;
              summaryEntry.skipped++;
              console.warn(
                '[london365] skipping game ' + game.id + ' (' + league.name + '): missing/unparseable kickoff date — raw fields: ' +
                'whole_date=' + JSON.stringify(game.whole_date) + ' game_date=' + JSON.stringify(game.game_date) + ' game_time=' + JSON.stringify(game.game_time)
              );
              return;
            }

            const ev = buildEvent(
              game.id,
              game.home_team,
              game.away_team,
              commenceTime,
              rows
            );
            await upsertMatch(ev, leagueKeyResolved, statusFromCommence(ev.commence_time), null, undefined, { id: String(league.id), countryId });
            matchCount++;
            summaryEntry.imported++;
            coefficientCount += rows.length;
            leaguesSeen.add(league.name);
          }));
        }
        if (TEST_MODE) console.log('[london365] TEST MODE: ' + league.name + ' done in ' + (Date.now() - t0) + 'ms');
      };

      if (TEST_MODE) {
        await runWithConcurrency(leagues, TEST_CONCURRENCY, processLeague);
      } else {
        for (const league of leagues) {
          await processLeague(league);
        }
      }
    }
    await setKV('l365_leagues', Array.from(leaguesSeen));
    // A full pass finished with nothing left to interrupt it — clear both
    // resume cursors so the next run starts from the top (International
    // first) again instead of resuming mid-list forever.
    await setKV('l365_league_cursor', null);
    await setKV('l365_country_cursor', null);
    await setKV('l365_market_names', Object.fromEntries(marketNameById));
    // Persist leagueById (id -> {key, name, countryId, countryName}) so a
    // fresh server boot doesn't start with it EMPTY. Without this, any live
    // socket event that arrives before the (slow) full-import loop has
    // re-reached that specific league falls back to name-only guessing —
    // wrong for a bare league name with no country word in it at all
    // ("Premier League", "Nations League"...), which is exactly how this
    // provider names most leagues.
    await setKV('l365_league_map', Object.fromEntries(leagueById));
    // Now that this run's leagueNameIndex is fully populated (every real
    // league name/alias we know about), sweep any already-existing rows
    // stuck under a redundant country-prefixed key ("England Premier
    // League") — they'd otherwise sit there forever as an empty duplicate
    // next to the correctly-updating real-named league.
    await purgeCountryPrefixedDuplicateLeagues();
    await purgeCountriesNotInOnlyList();
    // BUG FIX (memory leak / OOM root cause): the purge* functions above
    // delete matches_cache rows without regard to LIVE status and without
    // calling unsubscribeGameDetails/forgetLiveState — unlike the two
    // "match confirmed finished" call sites elsewhere in this file. If a
    // row that was LIVE gets purged here (redundant league key, excluded
    // country, etc.), its gamedetails-socket subscription is never
    // cancelled: the provider keeps pushing updates for that EID for as
    // long as it's live on THEIR side (up to hours), each one triggering a
    // DB round-trip that never finds a row, at the feed's full tick rate —
    // observed in production reaching a heap OOM crash within ~10 minutes.
    // Reconcile after every purge pass: drop any subscription whose match
    // id is no longer LIVE in matches_cache.
    await reconcileGameDetailsSubscriptions();
    await refreshLiveTracker().catch((err) => console.error('[london365] refreshLiveTracker failed:', err.message));
    await hydrateBetMatchIds().catch((err) => console.error('[london365] hydrateBetMatchIds failed:', err.message));
    await setLastImportAt(Date.now());
    console.log(
      '[london365] import done: ' + matchCount + ' matches, ' + coefficientCount + ' coefficients, ' +
      leaguesSeen.size + ' leagues (full-detail fetch: ' + detailOkCount + ' ok / ' + detailFailCount + ' failed' +
      (full && detailFailCount > detailOkCount ? ' — MOSTLY FAILING, matches are likely showing only sparse list-level odds, not the full market catalog' : '') +
      ', ' + skippedDateCount + ' games skipped for bad dates' +
      ', ' + skippedNoOddsCount + ' games skipped for zero usable odds' +
      ')'
    );
    // Per-country league breakdown: leagues the provider actually returned
    // for this run, and how many of each league's games made it in vs got
    // skipped — the direct answer to "why does England only show 3 leagues"
    // or "why does Premier League have 0 matches" without guessing.
    for (const [country, leaguesForCountry] of leagueSummary.entries()) {
      console.log(
        '[london365] ' + country + ': ' + leaguesForCountry.length + ' leagues — ' +
        leaguesForCountry.map((l) => l.name + ' (id=' + l.id + ', provider=' + l.providerGames + ', imported=' + l.imported + ', skipped=' + l.skipped + ')').join('; ')
      );
    }
    // Loud, unmissable final check: any priority country that got NOTHING
    // this run (no leagues with games right now, or every games-fetch for
    // it failed) — the single line worth searching the log for.
    if (PRIORITY_COUNTRIES.size) {
      const seenPriority = new Set(
        Array.from(leagueSummary.keys()).map((c) => c.toLowerCase())
      );
      const missing = Array.from(PRIORITY_COUNTRIES).filter((c) => !seenPriority.has(c));
      if (missing.length) {
        console.warn('[london365] PRIORITY COUNTRY WITH ZERO LEAGUES THIS RUN: ' + missing.join(', '));
      }
    }
    return { matches: matchCount, coefficients: coefficientCount, leagues: leaguesSeen.size, detailOkCount, detailFailCount, skippedDateCount, skippedNoOddsCount };
  } finally {
    importRunning = false;
  }
}
// Kick a throttled import in the background (never blocks an API request).
export function ensureLondon365Import() {
  if (!ENABLED) return;
  // Fast path: value already in memory and still inside the throttle window
  // => no DB round trip at all (this runs on every /api/matches request).
  if (lastImportMemo != null && Math.sign(IMPORT_THROTTLE_MS - (Date.now() - lastImportMemo)) === 1) {
    bump('import.throttle_memo_hit');
    return;
  }
  (async function () {
    const last = await getLastImportAt();
    const elapsed = Date.now() - last;
    if (Math.sign(IMPORT_THROTTLE_MS - elapsed) === 1) return;
    await setLastImportAt(Date.now());
    try {
      await importLondon365();
    } catch (err) {
      console.error('[london365] background import failed:', err.message);
    }
  })();
}
