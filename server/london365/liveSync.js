// The in-play loop: scores, clock and odds from the live endpoint, end-of-match detection, settlement.
import { noteLiveSyncCompleted, missedLiveCycles } from './liveState.js';
import { getWatchedMatchIds, pushMatchEnded } from '../ws.js';
import pool from '../db.js';
import { sampleFeedKeys } from '../feedKeySampler.js';
import { bump } from '../feedStats.js';
import { selectDetailTargets, markDetailFetched, pruneDetailAt } from '../liveDetailPlan.js';
import { isTrackedGame, hasKnownLiveMatches, retainLiveKnown, noteMatchStatus, forgetLiveRow } from '../liveTracker.js';
import { forgetLiveState } from '../london365GameDetails.js';
import { unsubscribeGameDetails } from '../london365Socket.js';
import { canSettleFromLiveScore, settleMatch, explainSettleBlock } from '../matchSettlement.js';
import { LIVE_INTERVAL_MS, ENABLED, DETAIL_DELAY_MS, sleep, SPORTS_RAW } from './config.js';
import { ensureMarketNamesLoaded, fetchLiveRows, parseOddString, hydrateRowNames, buildEvent } from './markets.js';
import { resolveSports, api } from './api.js';
import { leagueById, resolveLeagueByName } from './leagueRegistry.js';
import { isAllowedByCountryFilter } from './leagueRules.js';
import { isoFromWholeDate, parseScore, normalizeLiveMinute } from './clock.js';
import { upsertMatch, recordGoalIfChanged } from './persist.js';
import { leagueKeyFromCountry } from './leagueKeys.js';

export const SKIP_END_DETECTION = Symbol('skip-end-detection');
// Pure decision logic, exported for direct testing: should a match that's
// marked LIVE in the DB but missing from the provider's current live list
// be settled as finished right now?
export function shouldSettleMissingLiveMatch({ consecutiveMisses, fetchedAt, startTime, now = Date.now() }) {
  const confirmedMissing = consecutiveMisses >= 2;
  const stale = Number(fetchedAt) < now - 8 * 60 * 1000;
  const oldKickoff = Date.parse(startTime) < now - 2.5 * 60 * 60 * 1000;
  return confirmedMissing || stale || oldKickoff;
}
// Auto-settling pays/loses real bets, so it may only use a score the provider
// actually reported. A row that never had a live clock or a stored score (it was
// listed but never went live in our feed) has no result: settling it as 0-0 would
// decide every pending bet on an invented score. Such rows are closed without
// settlement and their bets stay PENDING for manual settlement.
export function hasRealLiveResult(row) {
  if (!row) return false;
  const hasScore = row.live_home_score != null && row.live_away_score != null;
  const hasClock = row.live_minute != null && String(row.live_minute).trim() !== '';
  return hasScore && hasClock;
}
// "missing live data" is logged per game; with ~100 live games and a cycle every
// 30s that is hundreds of lines a minute and buries everything else. Once per game
// per 10 minutes is enough to see which games are affected.
export const missingLiveLoggedAt = new Map();
export const MISSING_LIVE_LOG_EVERY_MS = 10 * 60 * 1000;
export function shouldLogMissingLive(gameId, now = Date.now()) {
  const last = missingLiveLoggedAt.get(gameId);
  if (last != null && now - last < MISSING_LIVE_LOG_EVERY_MS) return false;
  if (missingLiveLoggedAt.size > 2000) missingLiveLoggedAt.clear();
  missingLiveLoggedAt.set(gameId, now);
  return true;
}
// Per cycle, at most this many live games get the full-market refresh (see
// liveDetailPlan.js). The cheap list data covers all the others. 0 = no limit.
export const LIVE_DETAIL_BUDGET = Math.max(0, Number(process.env.LONDON365_LIVE_DETAIL_BUDGET ?? 120));
// Games that must be refreshed first: ones with an open bet, and ones a client is
// looking at right now. Bare provider ids (no "l365-" prefix).
export let priorityLookupWarned = false;
export async function collectPriorityGameIds() {
  const ids = new Set();
  try {
    for (const id of getWatchedMatchIds()) ids.add(String(id));
    const { rows } = await pool.query("SELECT DISTINCT match_id FROM bet_selections WHERE status = 'PENDING'");
    for (const r of rows) ids.add(String(r.match_id).replace(/^l365-/, ''));
  } catch (err) {
    // Priority is an optimisation; never let it stop a cycle. Logged once.
    if (!priorityLookupWarned) {
      priorityLookupWarned = true;
      console.error('[london365] could not load bet/viewer priority for the detail refresh:', err.message);
    }
  }
  return ids;
}
export const LIVE_CONCURRENCY = Math.max(1, Number(process.env.LONDON365_LIVE_CONCURRENCY || 6));
// Upper bound for the adaptive value below; kept at the DB pool size (8) because
// every in-flight game ends in a database write.
export const LIVE_CONCURRENCY_MAX = Math.max(LIVE_CONCURRENCY, Number(process.env.LONDON365_LIVE_CONCURRENCY_MAX || 8));
// The number of live matches changes from day to day (a handful midweek, well over
// a hundred on a big Saturday). A fixed parallelism makes the cycle time grow
// linearly with that number until it no longer fits in the 30s interval, so the
// parallelism grows with the load instead: ~1 extra lane per 12 games above the
// base, capped at LIVE_CONCURRENCY_MAX.
export function liveConcurrencyFor(gameCount) {
  return Math.min(LIVE_CONCURRENCY_MAX, Math.max(LIVE_CONCURRENCY, Math.ceil((gameCount || 0) / 12)));
}
// Runs `worker` over `items` with at most `limit` in flight. Workers must
// handle their own errors (a rejection would abort the pool).
export async function runPool(items, limit, worker) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}
// A cycle that is still running when the next tick fires is skipped, not
// stacked: overlapping cycles multiply the request rate against a provider
// that already answers "Something went wrong" under load, which is exactly
// what left half the live matches without minute/odds.
export let liveSyncRunning = false;
export let liveSyncStartedAt = 0;
export let liveSyncToken = 0;
// A cycle older than this is considered stuck (a hung request or lock) and is
// abandoned: the guard is released and a fresh cycle starts. Without it one stuck
// cycle would make every later cycle skip, freezing all live data until a restart.
export const LIVE_CYCLE_MAX_MS = Math.max(LIVE_INTERVAL_MS * 3, 90000);
// 'start' a new cycle, 'skip' this tick (previous cycle still healthy), or
// 'reset' (previous cycle is stuck: release the guard and start anyway).
export function liveCycleDecision(running, startedAt, now, maxMs) {
  if (!running) return 'start';
  return now - startedAt < maxMs ? 'skip' : 'reset';
}
export function syncLondon365Live() {
  const decision = liveCycleDecision(liveSyncRunning, liveSyncStartedAt, Date.now(), LIVE_CYCLE_MAX_MS);
  if (decision === 'skip') {
    bump('live.cycle_skipped_overlap');
    return Promise.resolve({ games: 0, skipped: true });
  }
  if (decision === 'reset') {
    console.error('[london365] live cycle stuck for ' + (Date.now() - liveSyncStartedAt) + 'ms — releasing the guard and starting a fresh cycle');
    bump('live.cycle_watchdog_reset');
  }
  const token = ++liveSyncToken;
  liveSyncRunning = true;
  liveSyncStartedAt = Date.now();
  const startedAt = liveSyncStartedAt;
  return syncLondon365LiveOnce().finally(() => {
    // Only the newest cycle may release the guard (an abandoned one finishing late must not).
    if (token === liveSyncToken) liveSyncRunning = false;
    const took = Date.now() - startedAt;
    if (took > LIVE_INTERVAL_MS) {
      console.warn('[london365] live cycle took ' + took + 'ms (> ' + LIVE_INTERVAL_MS + 'ms interval) — consider raising LONDON365_LIVE_CONCURRENCY');
    }
  });
}
// live game exposes its complete market set on /ajax/livegame/{id} — same
// row shape as the prematch detail endpoint — so we fetch it per game and
// merge it into the cached event. Games that leave the live feed are
// auto-settled with their last known score so final results appear.
export async function syncLondon365LiveOnce() {
  if (!ENABLED) return { games: 0 };
  await ensureMarketNamesLoaded();
  let gamesSynced = 0;
  let detailFailures = 0;
  let detailFetched = 0;
  let liveSeen = 0;
  let noMinute = 0;
  let noScore = 0;
  const liveIds = new Set();

  for (const sid of await resolveSports()) {
    let games;
    try {
      games = await api('/ajax/livegames', { method: 'POST', body: { sport: sid, market_type: 1 } });
    } catch (err) {
      console.error('[london365] livegames sport ' + sid + ' failed:', err.message);
      continue;
    }
    if (!Array.isArray(games)) continue;

    const detailTargets = selectDetailTargets(games, { budget: LIVE_DETAIL_BUDGET, priorityIds: await collectPriorityGameIds() });
    const processGame = async (g) => {
      if (!g || !g.id) return;
      sampleFeedKeys('rest.livegames.game', g);
      const resolvedLeagueEarly = (g.league_id != null && leagueById.get(String(g.league_id))) || resolveLeagueByName(g.league);
      // Same country allowlist as the prematch import — a live match from a
      // country outside LONDON365_ONLY_COUNTRIES shouldn't sneak into the
      // feed just because it's currently in-play. Previously, an
      // unresolvable league (leagueById miss — e.g. right after a
      // FORCE_RESET/restart, before the main import loop has repopulated
      // leagueById) was let through unconditionally, since we "couldn't yet
      // know their country". In practice this was a real hole: for the
      // whole window before leagueById catches up, EVERY country's live
      // games passed straight through this filter and got cached — which is
      // exactly how India/Malaysia matches kept reappearing after a reset
      // even with ONLY_COUNTRIES set. Now falls back to the same
      // name-based guess (leagueCountryToken) applySocketGame uses, so an
      // unresolved league is judged by its own name instead of let through.
      //
      // BUT: if we already hold this match (it passed this exact filter at
      // import time, using the catalog's own league text), skip re-judging
      // it here from the LIVE payload's text. The live feed's `g.league`
      // string isn't guaranteed to be phrased identically to the prematch
      // catalog's (observed concretely: UEFA Nations League fixtures sitting
      // frozen at 0-0/LIVE for hours — the live payload's league text failed
      // the name-pattern match that the import-time text had passed,
      // silently dropping them from every refresh forever after). Trusting
      // our own already-accepted classification is strictly safer than
      // re-deriving it from a second, differently-shaped copy of the same
      // information — a match can only reach isTrackedGame() by having
      // already cleared this same filter once.
      if (!isTrackedGame('l365-' + g.id) && !isAllowedByCountryFilter(g, resolvedLeagueEarly)) return;
      liveIds.add('l365-' + g.id);
      liveSeen++;
      // Each game processed independently: one malformed/failing game must
      // never abort the whole sync cycle. Before this, an uncaught error
      // here (e.g. a bad upsert) threw past this loop entirely, skipping
      // every remaining live game AND the end-detection sweep below for
      // that whole cycle — repeated every ~30s, a stuck live match could
      // sit frozen for hours since the cleanup that would have settled it
      // never got a chance to run.
      try {
        let rows = [];
        let liveMeta = null;
        if (detailTargets.has(String(g.id))) {
          try {
            if (DETAIL_DELAY_MS) await sleep(DETAIL_DELAY_MS);
            rows = await fetchLiveRows(g.id);
            liveMeta = rows.meta || null;
            markDetailFetched(g.id);
            detailFetched++;
          } catch (err) {
            detailFailures++;
            console.error('[london365] livegame detail ' + g.id + ' failed (falling back to packed list odds):', err.message);
          }
        }
        if (!rows.length) rows = parseOddString(g.odd);
        const odds = hydrateRowNames(rows.filter(function (o) { return o ? !Number.isNaN(o.coef) : false; }));
        // A live match whose markets are all locked/suspended has NO odds rows
        // (the site shows padlocks). It used to be skipped here, so its score,
        // clock and status froze at the first value. Only skip when there is
        // nothing live to record either; empty markets merge into the cached
        // event (mergeEvents), so the known odds are kept.
        if (!odds.length && !((liveMeta && (liveMeta.result || liveMeta.minute)) || g.result || g.current_minute)) return;
        const ev = buildEvent(g.id, g.home_team, g.away_team, isoFromWholeDate(g.whole_date, g.game_date, g.game_time) || new Date().toISOString(), odds);
        // liveMeta comes from /ajax/livegame/{id} (per-game detail, confirmed
        // against the live provider) and is far more reliable than g.result/
        // g.current_minute from the /ajax/livegames LIST response, which was
        // leaving score/minute empty for most matches — see fetchLiveRows.
        const score = parseScore((liveMeta && liveMeta.result) || g.result);
        const minute = normalizeLiveMinute((liveMeta && liveMeta.minute) || g.current_minute || null);
        // Diagnostic only (no behavior change) -- helps confirm/deny the
        // separate claim that field T can substitute as a minute source
        // when this path is empty, without trusting that claim yet.
        if (!minute) noMinute++;
        if (!score) noScore++;
        if ((!minute || !score) && shouldLogMissingLive(g.id)) {
          console.warn(
            '[london365] game ' + g.id + ' missing live data — ' +
            'detailFetched=' + Boolean(liveMeta) +
            ' liveMeta.minute=' + JSON.stringify(liveMeta && liveMeta.minute) +
            ' liveMeta.result=' + JSON.stringify(liveMeta && liveMeta.result) +
            ' list.current_minute=' + JSON.stringify(g.current_minute) +
            ' list.result=' + JSON.stringify(g.result)
          );
        }
        const apiStatus = (liveMeta && liveMeta.apiStatus) != null ? liveMeta.apiStatus : g.api_status;
        // Prefer the country-accurate key resolved from the real league_id
        // (set during the last full import); if that's missing, try matching
        // the live feed's own league text against every real league name/alias
        // seen during the last import (resolveLeagueByName) BEFORE falling
        // back to pure guessing — the live feed and prematch endpoint don't
        // always agree on naming for the same league (e.g. "England Premier
        // League" vs "Premier League"), and guessing from the raw text alone
        // used to create a second, wrongly-named duplicate of an already-known
        // league instead of landing on its real name.
        const resolvedLeague = (g.league_id != null && leagueById.get(String(g.league_id))) || resolveLeagueByName(g.league);
        const prev = await upsertMatch(ev, resolvedLeague ? resolvedLeague.key : leagueKeyFromCountry(null, g.league || ''), 'LIVE', score, { minute: minute, apiStatus: apiStatus }, resolvedLeague ? { id: resolvedLeague.id, countryId: resolvedLeague.countryId } : undefined);
        await recordGoalIfChanged(ev, score, minute, prev);
        gamesSynced++;
      } catch (err) {
        console.error('[london365] live game ' + g.id + ' failed to process (skipping, sync continues):', err.message);
      }
    };
    // Bounded parallelism instead of one-by-one: with dozens of live games a
    // strictly sequential pass (a detail request + DB write each, retries with
    // backoff on provider hiccups) outlasts the 30s interval, so games late in
    // the list were refreshed rarely -> no minute / stale locked odds.
    await runPool(games, liveConcurrencyFor(games.length), processGame);
  }

  // End detection: a cached LIVE l365 match no longer in the live feed has
  // finished — settle it with the last known score so the final result
  // shows on the right of the card. Three independent triggers (any one
  // is enough):
  //  1. Missing from the live feed for 2 consecutive sync cycles
  //     (~30-60s, including the very first cycle right after boot/restart)
  //     — this is what makes a server restart converge fast: fetched_at
  //     alone can still look "recent" right after boot even if the match
  //     actually finished while the process was down.
  //  2. It hasn't been updated (fetched_at) in 8+ minutes — catches a
  //     match that vanished from the feed at ANY real-game-time (45+2',
  //     90+5', extra time...) even during steady-state operation, in case
  //     the 2-cycle check above ever misses (e.g. a live-loop error skips
  //     a cycle for this game specifically).
  //  3. Kickoff was >2.5h ago — pure safety net for the rare case a match
  //     was somehow never freshly fetched at all (fetched_at stuck at
  //     import time), so it doesn't wait on triggers 1/2 forever.
  try {
    // Nothing is (or could be) LIVE => nothing to end. Skipping the SELECT is
    // what lets the database stay idle overnight / between matchdays so Neon
    // can auto-suspend compute. hasKnownLiveMatches() is fail-open (true)
    // until the tracker has been loaded from the DB once.
    if (!hasKnownLiveMatches()) {
      bump('endDetection.skipped_idle');
      throw SKIP_END_DETECTION;
    }
    bump('endDetection.ran');
    const endQueryStartedAt = Date.now();
    const { rows } = await pool.query(
      "SELECT id, live_home_score, live_away_score, live_minute, start_time, fetched_at FROM matches_cache WHERE id LIKE 'l365-%' AND status = 'LIVE'"
    );
    retainLiveKnown(rows.map((r) => r.id), endQueryStartedAt);
    for (const row of rows) {
      if (liveIds.has(row.id)) {
        missedLiveCycles.delete(row.id);
        continue;
      }
      const misses = (missedLiveCycles.get(row.id) || 0) + 1;
      missedLiveCycles.set(row.id, misses);
      const shouldSettle = shouldSettleMissingLiveMatch({
        consecutiveMisses: misses, fetchedAt: row.fetched_at, startTime: row.start_time,
      });
      if (!shouldSettle) continue;
      missedLiveCycles.delete(row.id);
      if (!hasRealLiveResult(row)) {
        // Never had a real score/clock: close it (it leaves every LIVE list) but do
        // NOT settle bets with an invented 0-0 -- they stay PENDING for the admin.
        await pool.query("UPDATE matches_cache SET status = 'FINISHED', live_status = 'ended' WHERE id = $1 AND status = 'LIVE'", [row.id]);
        pushMatchEnded(row.id, {});
        forgetLiveState(row.id);
        unsubscribeGameDetails(row.id);
        noteMatchStatus(row.id, 'FINISHED');
        forgetLiveRow(row.id);
        console.warn('[london365] ' + row.id + ' left the live feed without ever having a score/clock -- closed WITHOUT settling bets (settle manually if any are pending)');
        continue;
      }
      // Missing from the live list is not proof that it is over (a provider hiccup
      // drops games for a cycle or two): never settle on the score of a match whose
      // clock has not reached the end. It stays LIVE and is looked at again next cycle.
      if (!canSettleFromLiveScore(row)) {
        bump('endDetection.deferred_not_over');
        if (shouldLogMissingLive('end:' + row.id)) console.warn('[london365] ' + row.id + ' left the live feed but is NOT settled yet: ' + explainSettleBlock(row));
        continue;
      }
      const home = row.live_home_score ?? 0;
      const away = row.live_away_score ?? 0;
      await pool.query("UPDATE matches_cache SET live_status = 'ended' WHERE id = $1", [row.id]);
      pushMatchEnded(row.id, { homeScore: home, awayScore: away });
      forgetLiveState(row.id);
      unsubscribeGameDetails(row.id);
      try {
        await settleMatch(row.id, home, away);
        noteMatchStatus(row.id, 'FINISHED');
        forgetLiveRow(row.id);
        console.log('[london365] auto-settled ' + row.id + ' ' + home + '-' + away);
      } catch (err) {
        console.error('[london365] auto-settle ' + row.id + ' failed:', err.message);
      }
    }
  } catch (err) {
    if (err !== SKIP_END_DETECTION) console.error('[london365] end detection failed:', err.message);
  }

  // Kept in memory (was a kv_store write every 30s, 24/7, purely for the
  // admin status page). getLondon365Status() reads this first.
  pruneDetailAt(new Set(Array.from(liveIds, (id) => String(id).replace(/^l365-/, ''))));
  noteLiveSyncCompleted();
  if (liveSeen) console.log('[london365] live cycle: ' + gamesSynced + '/' + liveSeen + ' games synced, ' + detailFailures + ' detail fetch failures, ' + detailFetched + ' full refreshes, ' + noMinute + ' without minute, ' + noScore + ' without score');
  return { games: gamesSynced };
}
export let liveTimer = null;
export function startLondon365LiveLoop() {
  if (!ENABLED || liveTimer) return;
  liveTimer = setInterval(function () {
    syncLondon365Live().catch(function (err) {
      console.error('[london365] live sync failed:', err.message);
    });
  }, LIVE_INTERVAL_MS);
  if (liveTimer.unref) liveTimer.unref();
  setTimeout(function () {
    syncLondon365Live().catch(function (err) {
      console.error('[london365] initial live sync failed:', err.message);
    });
  }, 5000);
  console.log('[london365] live loop started, every ' + LIVE_INTERVAL_MS + 'ms (sports: ' + (SPORTS_RAW === 'all' ? 'all discovered' : SPORTS_RAW) + ')');
}
