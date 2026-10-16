// Applying provider socket messages (odds, game state, match end) to the match cache.
import { bump } from '../feedStats.js';
import { isTrackedGame, noteMatchStatus, forgetLiveRow } from '../liveTracker.js';
import pool from '../db.js';
import { shouldRecordOddsHistory } from '../oddsHistoryPolicy.js';
import { pushOddsChanged, pushMatchEnded } from '../ws.js';
import { forgetLiveState } from '../london365GameDetails.js';
import { unsubscribeGameDetails } from '../london365Socket.js';
import { clearGoalAnnounced } from '../goalAnnouncer.js';
import { canSettleFromLiveScore, settleMatch } from '../matchSettlement.js';
import { withDbLock, statusSampler, upsertMatch, recordGoalIfChanged } from './persist.js';
import { leagueById, resolveLeagueByName } from './leagueRegistry.js';
import { isAllowedByCountryFilter } from './leagueRules.js';
import { ensureMarketNamesLoaded, hydrateRowNames, parseOddString, buildEvent } from './markets.js';
import { isoFromWholeDate, parseScore, statusFromCommence } from './clock.js';
import { leagueKeyFromCountry } from './leagueKeys.js';

// --- Socket.IO feed handlers (called by london365Socket.js) ----------------
// The provider pushes real-time deltas over Socket.IO in addition to the REST
// snapshot the polling loop reads. These handlers patch the cached canonical
// event in place so odds move sub-second without a full re-fetch.

export async function applySocketCoefs(gameId, coefs) {
  const id = 'l365-' + gameId;
  bump('coefs.received');
  // GLOBAL provider feed: most games are outside the allowed countries and
  // were never imported. Answer "no such row" from memory instead of paying a
  // Postgres round trip (which used to SELECT the whole raw_json blob) per
  // message. Fail-open until the tracker has been loaded (see liveTracker.js).
  if (!isTrackedGame(id)) { bump('coefs.dropped_untracked'); return 0; }
  return withDbLock(id, async () => {
    const { rows } = await pool.query('SELECT raw_json FROM matches_cache WHERE id = $1', [id]);
    if (!rows.length || !rows[0].raw_json) return 0;
    let ev;
    try { ev = JSON.parse(rows[0].raw_json); } catch (err) { return 0; }
    const byCoefId = new Map();
    for (const bm of ev.bookmakers || []) {
      for (const mk of bm.markets || []) {
        for (const o of mk.outcomes || []) byCoefId.set(String(o.id), { o: o, market: mk.key });
      }
    }
    const changes = [];
    for (const c of coefs || []) {
      const coefId = String(c.coef_id != null ? c.coef_id : (c.id != null ? c.id : ''));
      const price = parseFloat(c.coef != null ? c.coef : (c.odd != null ? c.odd : c.value));
      if (!coefId || Number.isNaN(price)) continue;
      const entry = byCoefId.get(coefId);
      if (!entry || entry.o.price === price) continue;
      changes.push({ matchId: id, marketId: entry.market, selectionId: coefId, oldOdds: entry.o.price, newOdds: price });
      entry.o.price = price;
    }
    if (!changes.length) return 0;
    bump('coefs.changed');
    const now = Date.now();
    if (shouldRecordOddsHistory(id)) {
      for (const c of changes) {
        await pool.query(
          `INSERT INTO odds_history (match_id, market_id, selection_id, old_odds, new_odds, changed_by, reason, created_at)
           VALUES ($1,$2,$3,$4,$5,'SYSTEM','london365_socket',$6)`,
          [c.matchId, c.marketId, c.selectionId, c.oldOdds, c.newOdds, now]
        );
      }
      bump('oddsHistory.rows_written', changes.length);
    } else {
      bump('oddsHistory.rows_skipped', changes.length);
    }
    await pool.query('UPDATE matches_cache SET raw_json = $2, fetched_at = $3 WHERE id = $1', [id, JSON.stringify(ev), now]);
    pushOddsChanged(id, { changes: changes });
    return changes.length;
  });
}
export async function applySocketGame(g, status) {
  if (!g || !g.id) return false;
  // Filter FIRST (pure in-memory check on the payload) so a game outside the
  // allowed countries/competitions costs no parsing, no event building and
  // no DB work. The same gate used to run only after buildEvent().
  const resolvedLeague = (g.league_id != null && leagueById.get(String(g.league_id))) || resolveLeagueByName(g.league);
  if (!isAllowedByCountryFilter(g, resolvedLeague)) { bump('socketGame.dropped_filtered'); return false; }
  await ensureMarketNamesLoaded();
  const odds = hydrateRowNames(parseOddString(g.odd).filter(function (o) { return o ? !Number.isNaN(o.coef) : false; }));
  if (!odds.length) return false;
  const commence = isoFromWholeDate(g.whole_date, g.game_date, g.game_time) || new Date().toISOString();
  const ev = buildEvent(g.id, g.home_team, g.away_team, commence, odds);
  const score = parseScore(g.result);
  const minute = g.current_minute || null;
  const resolved = status || (minute ? 'LIVE' : statusFromCommence(commence));
  const statusLine = statusSampler.note(g.api_status, minute, ev.id);
  if (statusLine) console.log(statusLine);
  const prev = await upsertMatch(ev, resolvedLeague ? resolvedLeague.key : leagueKeyFromCountry(null, g.league || ''), resolved, score, { minute: minute, apiStatus: g.api_status }, resolvedLeague ? { id: resolvedLeague.id, countryId: resolvedLeague.countryId } : undefined);
  await recordGoalIfChanged(ev, score, minute, prev);
  return true;
}
export async function markLondon365GameEnded(gameId) {
  const id = 'l365-' + gameId;
  if (!isTrackedGame(id)) return 0; // never imported: nothing to end (was a SELECT + UPDATE per message)
  return withDbLock(id, async () => {
    const { rows } = await pool.query(
      'SELECT live_home_score, live_away_score, live_minute, start_time FROM matches_cache WHERE id = $1', [id]
    );
    const res = await pool.query(
      `UPDATE matches_cache SET status = 'FINISHED', live_status = 'ended' WHERE id = $1 AND status = 'LIVE'`,
      [id]
    );
    if (res && res.rowCount) {
      const row = rows[0] || {};
      pushMatchEnded(id, { homeScore: row.live_home_score ?? 0, awayScore: row.live_away_score ?? 0 });
      forgetLiveState(id);
      unsubscribeGameDetails(id);
      noteMatchStatus(id, 'FINISHED');
      forgetLiveRow(id);
      clearGoalAnnounced(id);
      // Betting is closed (FINISHED) the moment the feed drops the game. The
      // result and the settlement used to be skipped here, which left every
      // ticket open until the overdue sweep refunded it. Settle now when the
      // provider's own score + clock say the match is over; otherwise leave the
      // tickets PENDING -- recoverFinishedWithoutResult() retries on every sweep.
      if (canSettleFromLiveScore(row)) {
        try {
          await settleMatch(id, Number(row.live_home_score), Number(row.live_away_score));
          console.log('[london365] socket end: settled ' + id + ' ' + row.live_home_score + '-' + row.live_away_score);
        } catch (err) {
          console.error('[london365] socket end: settle ' + id + ' failed (the sweep will retry):', err.message);
        }
      } else {
        console.warn('[london365] socket end: ' + id + ' closed but its result is not reliable yet (score/clock missing or match not over) -- bets stay PENDING for the recovery sweep');
      }
    }
    return res ? res.rowCount : 0;
  });
}
export async function removeSocketCoef(gameId, coefId) {
  const id = 'l365-' + gameId;
  if (!coefId) return 0;
  if (!isTrackedGame(id)) return 0; // same early drop as applySocketCoefs
  return withDbLock(id, async () => {
    const { rows } = await pool.query('SELECT raw_json FROM matches_cache WHERE id = $1', [id]);
    if (!rows.length || !rows[0].raw_json) return 0;
    let ev;
    try { ev = JSON.parse(rows[0].raw_json); } catch (err) { return 0; }
    let removed = 0;
    for (const bm of ev.bookmakers || []) {
      for (const mk of bm.markets || []) {
        const before = (mk.outcomes || []).length;
        mk.outcomes = (mk.outcomes || []).filter(function (o) { return String(o.id) !== String(coefId); });
        removed += before - mk.outcomes.length;
      }
    }
    if (removed) await pool.query('UPDATE matches_cache SET raw_json = $2, fetched_at = $3 WHERE id = $1', [id, JSON.stringify(ev), Date.now()]);
    return removed;
  });
}
