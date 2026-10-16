// Repair and clean-up jobs: sparse events, stale/misclassified/duplicate leagues, full wipe.
import { setRepairNeeded, repairNeeded, upsertMatch } from './persist.js';
import { bump } from '../feedStats.js';
import pool, { setKV } from '../db.js';
import { getSubscribedGameDetailsIds, unsubscribeGameDetails } from '../london365Socket.js';
import { forgetLiveState } from '../london365GameDetails.js';
import { resetLiveTracker } from '../liveTracker.js';
import { ENABLED, DETAIL_DELAY_MS, sleep, EXCLUDED_COUNTRIES, ONLY_COUNTRIES } from './config.js';
import { ensureMarketNamesLoaded, isSparseEvent, fetchLiveRows, fetchDetailRows, hydrateRowNames, countOutcomes, buildEvent, marketNameById } from './markets.js';
import { COUNTRY_NAMES_BY_LENGTH_DESC, COUNTRY_NAME_TO_TOKEN, slugDash, leagueCountryToken } from './leagueKeys.js';
import { isAllowedInternationalCompetition, isMinorLeague, isSecondTierDomesticLeague } from './leagueRules.js';
import { setLastImportAt } from './importState.js';
import { leagueById, leagueNameIndex, countryMapCache } from './leagueRegistry.js';

// Repair pass: the provider's detail endpoint intermittently fails on
// hosting (rate limits / transient "Something went wrong"), leaving cached
// l365 events with only the sparse list-level odds — 1-4 markets, names
// like "Market 6575". This re-fetches full detail for the OLDEST sparse
// events in bounded batches and replaces them, so the frontend eventually
// shows every LondonPro365 market and coefficient. Rotation via fetched_at
// guarantees one permanently-broken game can't block the queue.
export let repairRunning = false;
export async function repairSparseEvents(opts) {
  opts = opts || {};
  if (!ENABLED || repairRunning) return { attempted: 0, repaired: 0 };
  // Nothing sparse seen since the last full look => skip the query (it reads up
  // to 120 raw_json blobs and would otherwise wake the DB every 3 minutes).
  if (!opts.force && !repairNeeded) { bump('repair.skipped_idle'); return { attempted: 0, repaired: 0, skipped: true }; }
  bump('repair.ran');
  repairRunning = true;
  const limit = Number(opts.limit) || 25;
  try {
    await ensureMarketNamesLoaded();
    const { rows } = await pool.query(
      "SELECT id, league, status, raw_json FROM matches_cache WHERE id LIKE 'l365-%' AND status != 'FINISHED' ORDER BY fetched_at ASC LIMIT $1",
      [limit * 3]
    );
    let attempted = 0;
    let repaired = 0;
    for (const row of rows) {
      if (repaired >= limit) break;
      let ev;
      try { ev = JSON.parse(row.raw_json); } catch (err) { continue; }
      if (!isSparseEvent(ev)) continue;
      const gameId = String(row.id).replace('l365-', '');
      attempted++;
      await pool.query('UPDATE matches_cache SET fetched_at = $2 WHERE id = $1', [row.id, Date.now()]);
      try {
        if (DETAIL_DELAY_MS) await sleep(DETAIL_DELAY_MS);
        // LIVE events must be repaired through the live endpoint — the
        // prematch detail returns zero rows once a game kicks off.
        const rawRows = row.status === 'LIVE' ? await fetchLiveRows(gameId) : await fetchDetailRows(gameId);
        const fresh = hydrateRowNames(rawRows.filter(function (r) { return r && !Number.isNaN(r.coef); }));
        if (fresh.length <= countOutcomes(ev)) continue;
        const newEv = buildEvent(gameId, ev.home_team, ev.away_team, ev.commence_time, fresh);
        await upsertMatch(newEv, row.league, row.status, null);
        repaired++;
      } catch (err) {
        console.error('[london365] repair ' + row.id + ' failed:', err.message);
      }
    }
    // Only conclude "nothing to repair" if we actually examined every
    // non-finished row (the query is capped at limit*3).
    if (attempted === 0 && rows.length < limit * 3) setRepairNeeded(false);
    if (attempted) await setKV('l365_market_names', Object.fromEntries(marketNameById));
    if (repaired) console.log('[london365] repair pass: ' + repaired + '/' + attempted + ' sparse events restored to full detail');
    return { attempted: attempted, repaired: repaired };
  } finally {
    repairRunning = false;
  }
}
// One-time cleanup so leagues that shouldn't exist under the CURRENT rules
// (excluded countries, or minor/youth/regional leagues per
// LONDON365_MAJOR_ONLY) disappear immediately instead of lingering forever
// as stale rows imported under an OLDER, buggier country-detection pass —
// which is exactly how e.g. "Italy Brasileiro Serie A" ended up sitting
// under Italy: it was imported back when country detection guessed from
// the league NAME (a "serie a"/"serie b" substring match), well before the
// country_id-based fix. That stale row's league key already says
// "l365_italy__...", so purgeExcludedCountries() (which matches on the
// CURRENT country prefix) never touches it. This sweeps by keyword
// instead, regardless of whatever country prefix a stale row currently has.
// Every purge*() below deletes matches_cache rows by league. None of them used
// to check whether anybody had a bet on the row: deleting a match that has a
// PENDING selection makes settleMatch() return null forever (match not found)
// and strands the bet. Appended to each purge DELETE so rows with open bets
// are always left alone (they are cleaned by normal settlement/retention).
export const NO_PENDING_BETS = `AND NOT EXISTS (SELECT 1 FROM bet_selections bs WHERE bs.match_id = matches_cache.id AND bs.status = 'PENDING')`;
export const STALE_LEAGUE_KEYWORDS = [
  'brasileiro', 'brasileirao', 'amazonense', 'gaucho', 'carioca', 'paulista',
  'catarinense', 'mineiro', 'baiano', 'cearense', 'potiguar', 'goiano',
  'alagoano', 'capixaba', 'sergipano', 'paraense', 'matogrossense',
  'pernambucano', 'copa_do_brasil',
  'u19', 'u20', 'u21', 'u23', 'women', 'youth', 'junior', 'reserve',
  'amateur', 'academy', 'friendly', 'esoccer', 'virtual', 'simulated',
];
export async function purgeStaleLeagues() {
  // ONE statement (a single scan) instead of one ILIKE '%kw%' DELETE per
  // keyword (~40 sequential full scans on every boot -- and this deploy
  // restarts often). Keywords contain only [a-z0-9_], so the alternation is
  // safe to build without escaping.
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM matches_cache WHERE id LIKE 'l365-%' AND league ~* $1 ${NO_PENDING_BETS}`,
      [STALE_LEAGUE_KEYWORDS.join('|')]
    );
    if (rowCount) console.log(`[london365] purged ${rowCount} stale rows (excluded/minor league keywords, imported under an older classification)`);
  } catch (err) {
    console.error('[london365] failed purging stale league keywords:', err.message);
  }
}
// Purges rows bucketed under one country whose league-name slug contains
// another country's name — e.g. "l365_england__dominica_premier_league" or
// "...__singapore_premier_league_2". These came from the now-removed
// generic "premier league"/"championship" -> england keyword hint (see
// LEAGUE_COUNTRY_HINTS above) confidently mis-bucketing foreign leagues
// that happen to share a common competition-name word. A real competition
// never has a DIFFERENT country's name baked into it, so this is a safe,
// general check — not specific to England or to Dominica/Singapore.
export async function purgeCrossCountryMisclassifiedLeagues() {
  try {
    const { rows } = await pool.query(
      "SELECT DISTINCT league FROM matches_cache WHERE id LIKE 'l365-%' AND league LIKE 'l365\\_%\\_\\_%'"
    );
    let purged = 0;
    for (const { league: key } of rows) {
      const m = /^l365_([a-z0-9-]+)__(.+)$/.exec(key);
      if (!m) continue;
      const [, countryToken, leagueSlug] = m;
      const slugText = leagueSlug.replace(/_/g, ' ');
      for (const countryName of COUNTRY_NAMES_BY_LENGTH_DESC) {
        const otherToken = COUNTRY_NAME_TO_TOKEN[countryName] || slugDash(countryName);
        if (!otherToken || otherToken === countryToken) continue;
        if (!slugText.includes(countryName)) continue;
        const { rowCount } = await pool.query(
          `DELETE FROM matches_cache WHERE id LIKE 'l365-%' AND league = $1 ${NO_PENDING_BETS}`,
          [key]
        );
        purged += rowCount;
        if (rowCount) {
          console.log(`[london365] purged ${rowCount} rows under "${key}" — bucketed as "${countryToken}" but name contains "${countryName}"`);
        }
        break;
      }
    }
    return purged;
  } catch (err) {
    console.error('[london365] failed purging cross-country misclassified leagues:', err.message);
    return 0;
  }
}
// Purges rows whose league key redundantly repeats the country in the
// league-name portion itself — e.g. "l365_england__england_premier_league"
// sitting next to the correctly-named "l365_england__premier_league" for
// the exact same competition. This happens when a live/socket payload's
// own g.league text came through as "England Premier League" (some
// providers name it that way on the live feed even though the prematch
// list endpoint calls the same league plain "Premier League") and no
// league_id was available to resolve it properly at write time. The
// in-memory alias index (resolveLeagueByName) stops this going forward;
// this cleans up whatever already landed in the DB before that existed.
// Runs after every completed import, using that run's own countryMap so
// "does the league-name half start with the country name" is checked
// against real country names, not a guess.
// Drops any gamedetails-socket subscription whose match is no longer LIVE
// in matches_cache — this is the fix for the OOM root cause described at
// the purgeCountryPrefixedDuplicateLeagues()/purgeCountriesNotInOnlyList()
// call site above. Cheap and safe to call often: subscribedGameIds is
// normally small (only currently-live matches), and unsubscribeGameDetails
// is a no-op Set.delete for ids that were never subscribed.
export async function reconcileGameDetailsSubscriptions() {
  const subscribed = getSubscribedGameDetailsIds();
  if (!subscribed.size) return 0;
  const { rows } = await pool.query(
    "SELECT id FROM matches_cache WHERE id LIKE 'l365-%' AND status = 'LIVE'"
  );
  const stillLive = new Set(rows.map((r) => r.id.replace(/^l365-/, '')));
  let dropped = 0;
  for (const eid of subscribed) {
    if (!stillLive.has(eid)) {
      unsubscribeGameDetails(eid);
      forgetLiveState(eid);
      dropped++;
    }
  }
  if (dropped) console.log(`[london365] reconciled gamedetails subscriptions: dropped ${dropped} orphaned id(s)`);
  return dropped;
}
// Independent safety net: several purge*() functions run standalone at
// boot (see server.js) and are NOT followed by a reconcile call, so
// patching only the one import-cycle call site above isn't enough — any of
// those can orphan a LIVE subscription just as easily. Rather than track
// down and patch every purge call site (fragile against a future one being
// added without the same care), run reconciliation on its own short timer,
// independent of imports/purges entirely. 2 minutes is deliberately much
// shorter than the 30-minute pruneStaleLiveState sweep in
// london365GameDetails.js: that one bounds long-term memory for EIDs that
// never matched anything at all, this one specifically targets the fast
// runaway case (a real, fast-ticking live subscription with nowhere to
// land) that was observed reaching heap OOM in under 10 minutes.
export const RECONCILE_INTERVAL_MS = Math.max(30000, Number(process.env.LONDON365_RECONCILE_INTERVAL_MS || 120000));
export let reconcileTimer = null;
export function startGameDetailsSubscriptionReconcileLoop() {
  if (reconcileTimer) return reconcileTimer;
  reconcileTimer = setInterval(() => {
    reconcileGameDetailsSubscriptions().catch((err) =>
      console.error('[london365] reconcileGameDetailsSubscriptions failed:', err.message)
    );
  }, RECONCILE_INTERVAL_MS);
  if (reconcileTimer.unref) reconcileTimer.unref();
  return reconcileTimer;
}
export async function purgeCountryPrefixedDuplicateLeagues() {
  try {
    const { rows } = await pool.query(
      "SELECT DISTINCT league FROM matches_cache WHERE id LIKE 'l365-%' AND league LIKE '%\\_\\_%'"
    );
    let purged = 0;
    for (const { league: key } of rows) {
      const m = /^l365_([a-z0-9-]+)__(.+)$/.exec(key);
      if (!m) continue;
      const [, countryToken, leagueSlug] = m;
      // Bad pattern: league-name slug literally starts with the country
      // token again ("england" + "_premier_league" -> "england_premier_league").
      if (!leagueSlug.startsWith(countryToken + '_')) continue;
      const strippedSlug = leagueSlug.slice(countryToken.length + 1);
      const cleanKey = 'l365_' + countryToken + '__' + strippedSlug;
      if (cleanKey === key) continue; // nothing left after stripping — not actually a duplicate
      const { rowCount } = await pool.query(
        `DELETE FROM matches_cache WHERE id LIKE 'l365-%' AND league = $1 ${NO_PENDING_BETS}`,
        [key]
      );
      purged += rowCount;
      if (rowCount) console.log(`[london365] purged ${rowCount} rows under redundant "${key}" (real name is "${cleanKey}")`);
    }
    return purged;
  } catch (err) {
    console.error('[london365] failed purging country-prefixed duplicate leagues:', err.message);
    return 0;
  }
}
// One-time cleanup so an excluded country's matches disappear immediately
// on deploy instead of only stopping new ones from being added (existing
// rows would otherwise sit in matches_cache until they naturally age out).
// Safe to call on every boot — it's a no-op once already cleaned up.
export async function purgeExcludedCountries() {
  if (!EXCLUDED_COUNTRIES.size) return;
  for (const country of EXCLUDED_COUNTRIES) {
    const token = leagueCountryToken(country) === 'other' ? slugDash(country) : leagueCountryToken(country);
    try {
      const { rowCount } = await pool.query(
        `DELETE FROM matches_cache WHERE id LIKE 'l365-%' AND league LIKE $1 ${NO_PENDING_BETS}`,
        [`l365_${token}__%`]
      );
      if (rowCount) console.log(`[london365] purged ${rowCount} existing ${country} matches (excluded country)`);
    } catch (err) {
      console.error(`[london365] failed purging excluded country ${country}:`, err.message);
    }
  }
}
// Same idea as purgeExcludedCountries, but for LONDON365_ONLY_COUNTRIES
// (an allow-list instead of a deny-list): rows already sitting in
// matches_cache from BEFORE this env var was set (or from before it was set
// to this exact value) belong to countries no longer in scope, and would
// otherwise linger in the sidebar — with stale, never-updating data — until
// they naturally age out. This deletes them outright the moment the allow-
// list changes, so switching to a tighter scope takes effect immediately
// instead of "the new setting only affects what gets ADDED from now on".
// Safe / cheap to call every boot and after every import: no-op once
// everything already matches the current allow-list.
export async function purgeCountriesNotInOnlyList() {
  if (!ONLY_COUNTRIES.size) return 0;
  const allowedTokens = new Set(
    Array.from(ONLY_COUNTRIES).map((name) => (leagueCountryToken(name) === 'other' ? slugDash(name) : leagueCountryToken(name)))
  );
  try {
    const { rows } = await pool.query("SELECT DISTINCT league FROM matches_cache WHERE id LIKE 'l365-%'");
    let purged = 0;
    for (const { league: key } of rows) {
      const m = /^l365_([a-z0-9-]+)__(.*)$/.exec(key);
      if (!m) continue; // pre-migration format, handled by purgeLegacyLeagueKeyFormat instead
      const [, token, competitionSlug] = m;
      if (allowedTokens.has(token)) {
        // Still inside the allowed country set overall, but the
        // "international" bucket needs the extra European-competition-name
        // narrowing applied at import time (see isEuropeanInternationalCompetition)
        // — this is what actually purges a Copa Libertadores row that was
        // already sitting in matches_cache from before that narrowing
        // existed, or from before ONLY_COUNTRIES was configured at all.
        // BUG FIX: the key's competition part is slug()ed with UNDERSCORES
        // ("champions_league") but the regexes need spaces; only dashes were
        // converted, so a bare-named "Champions League" / "Europa League" /
        // "Nations League" failed the check and was DELETED after every import
        // and at every boot -- the very competitions this allowlist exists to
        // keep -- and then re-inserted by the next import (pure DB churn).
        // Legacy rows of an allowed country that the current rules would now
        // reject (youth / reserve / regional lower tier) go too.
        const competitionName = competitionSlug.replace(/[-_]+/g, ' ');
        const keep = token === 'international'
          ? isAllowedInternationalCompetition(competitionName)
          : !isMinorLeague(competitionName, token) && !isSecondTierDomesticLeague(competitionName, token);
        if (keep) continue;
      }
      const { rowCount } = await pool.query(
        `DELETE FROM matches_cache WHERE id LIKE 'l365-%' AND league = $1 ${NO_PENDING_BETS}`,
        [key]
      );
      purged += rowCount;
      if (rowCount) console.log(`[london365] purged ${rowCount} rows under "${key}" (country "${m[1]}" not in LONDON365_ONLY_COUNTRIES)`);
    }
    return purged;
  } catch (err) {
    console.error('[london365] failed purging countries outside ONLY_COUNTRIES:', err.message);
    return 0;
  }
}
// Hard reset: wipes EVERY l365-* row and every piece of in-memory/persisted
// state (resume cursors, leagueById, the name-alias index, the accumulated
// leagueNames list) so the next import genuinely starts from zero with
// current code — instead of layering another purge pass on top of however
// many months-old rows/aliases/cursors have accumulated across every past
// bug fix. Guarded behind LONDON365_FORCE_RESET=1 specifically so this only
// ever runs when explicitly asked for (env var on Render, one redeploy),
// never automatically.
export async function wipeLondon365Data() {
  const { rowCount } = await pool.query(`DELETE FROM matches_cache WHERE id LIKE 'l365-%'`);
  await setKV('l365_leagues', []);
  await setKV('l365_league_map', {});
  await setLastImportAt(0);
  await setKV('l365_country_cursor', null);
  await setKV('l365_league_cursor', null);
  resetLiveTracker();
  setRepairNeeded(true);
  leagueById.clear();
  leagueNameIndex.clear();
  countryMapCache.clear();
  console.log(`[london365] HARD RESET: wiped ${rowCount} rows + all cursors/caches (LONDON365_FORCE_RESET=1) — next import starts completely from zero`);
  return rowCount;
}
// One-time cleanup of the OLD league-key format (single underscore, e.g.
// "l365_england_premier_league") from before the country segment was
// switched to a "__"-delimited prefix (leagueKeyFromCountry above). Rows
// under the old key stopped being refreshed the moment the code migrated,
// so they sit there as dead duplicates of the correctly-updating new-format
// row for the same real competition — e.g. "England Premier League" (old,
// stale, no matches) next to "Premier League" (new, live-updated) in the
// sidebar. Every current l365 key contains "__"; anything under an l365-%
// id without it is unambiguously pre-migration and safe to drop.
export async function purgeLegacyLeagueKeyFormat() {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM matches_cache WHERE id LIKE 'l365-%' AND league LIKE 'l365\\_%' ESCAPE '\\' AND strpos(league, '__') = 0 ${NO_PENDING_BETS}`
    );
    if (rowCount) console.log(`[london365] purged ${rowCount} rows under the old pre-migration league-key format (dead duplicate leagues)`);
  } catch (err) {
    console.error('[london365] failed purging legacy league-key format:', err.message);
  }
}
