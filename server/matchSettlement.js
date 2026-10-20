import pool from './db.js';
import { evaluateMarket } from './marketRules.js';

// Pure decision logic for a single bet leg given the final match result.
// Kept separate from settleMatch (which is DB-coupled) so it can be unit
// tested without a database. Returns:
//   'WON' | 'LOST'            decided
//   'VOID'                    push / refund (whole-number lines, draw-no-bet draws, ...)
//   'HALF_WON' | 'HALF_LOST'  Asian quarter lines (half the stake wins / loses)
//   null                      a needed fact is missing or the market is unknown:
//                             the leg stays PENDING for manual review
//
// The rules for every market live in marketRules.js (one rule per market family,
// checked against every market and option of a real live match in
// tests/marketRules.test.js).
export function determineLegOutcome(leg, facts) {
  const { winner, totalGoals, bothScored, homeScore, awayScore, htHome, htAway } = facts;
  const marketId = String(leg.market_id ?? '');

  // ---- canonical keys (selection ids are HOME/DRAW/AWAY, Over-2.5, Yes/No) ----
  if (marketId.endsWith('-h2h') && ['HOME', 'DRAW', 'AWAY'].includes(String(leg.selection_id))) {
    return leg.selection_id === winner ? 'WON' : 'LOST';
  }
  if (marketId.endsWith('-totals') && /^(Over|Under)-/.test(String(leg.selection_id))) {
    const idx = leg.selection_id.lastIndexOf('-');
    const side = leg.selection_id.slice(0, idx);
    const point = parseFloat(leg.selection_id.slice(idx + 1));
    if (Number.isNaN(point)) return null;
    if (point === totalGoals) return 'VOID';
    return side === 'Over' ? (totalGoals > point ? 'WON' : 'LOST') : (totalGoals < point ? 'WON' : 'LOST');
  }
  if (marketId.endsWith('-btts') && (leg.selection_id === 'Yes' || leg.selection_id === 'No')) {
    return (leg.selection_id === 'Yes') === !!bothScored ? 'WON' : 'LOST';
  }

  // ---- every other market: by market name + option text ----
  const home = Number.isFinite(homeScore) ? homeScore : null;
  const away = Number.isFinite(awayScore) ? awayScore : null;
  if (home === null || away === null) return null;
  return evaluateMarket(leg, {
    home, away, htHome, htAway,
    firstGoal: facts.firstGoal, lastGoal: facts.lastGoal,
    cornersTotal: facts.cornersTotal, cornersH1: facts.cornersH1,
  });
}

// Recompute a bet's overall status from its legs, and pay out balance
// exactly once, the moment it transitions into WON (or VOID = refund).
//
// VOID legs (pushes) are dropped from the ticket: the remaining legs decide
// it and the payout is recalculated without them (stake x odds of the
// non-void legs). A ticket whose legs are ALL void is refunded its stake.
//
// `FOR UPDATE` on the bet row is what makes this safe under concurrent
// calls (e.g. the admin manual-settle route and the automatic live
// poller both reacting to the same match around the same time): it
// forces a second concurrent call for the same betId to block until the
// first one commits, then re-read the ALREADY-UPDATED status — so its
// `nextStatus === bet.status` check below correctly short-circuits
// instead of paying out a second time.
export async function recomputeBetStatus(betId, client = pool) {
  const { rows: betRows } = await client.query('SELECT * FROM bets WHERE id = $1 FOR UPDATE', [betId]);
  const bet = betRows[0];
  if (!bet) return;
  const { rows: legs } = await client.query('SELECT * FROM bet_selections WHERE bet_id = $1', [betId]);
  if (legs.length === 0) return; // [].every(...) is true — never pay a bet that has no legs

  // Leg statuses: WON / LOST / VOID (refund) / HALF_WON / HALF_LOST (Asian quarter lines:
  // half the stake wins at full odds, or half the stake is lost and half returned) / PENDING.
  const active = legs.filter((l) => l.status !== 'VOID');
  const decidedWin = (l) => l.status === 'WON' || l.status === 'HALF_WON' || l.status === 'HALF_LOST';
  const hasHalf = legs.some((l) => l.status === 'HALF_WON' || l.status === 'HALF_LOST');
  let nextStatus;
  if (active.some((l) => l.status === 'LOST')) nextStatus = 'LOST';
  else if (active.length === 0) nextStatus = 'VOID';
  else if (active.every(decidedWin)) nextStatus = 'WON';
  else nextStatus = 'PENDING';

  if (nextStatus === 'WON' && (hasHalf || active.length < legs.length)) {
    // Refunded and/or half legs: pay stake x the product of what each remaining leg returns.
    const factor = (l) => (l.status === 'HALF_WON' ? (1 + Number(l.odds)) / 2 : l.status === 'HALF_LOST' ? 0.5 : Number(l.odds));
    const mult = active.reduce((acc, l) => acc * factor(l), 1);
    const payout = Number((Number(bet.stake) * mult).toFixed(2));
    // More than the stake back = WON; exactly the stake = refund; less (a half-lost
    // leg on its own) is stored as WON with the smaller payout, so every report that sums
    // (potential_return - stake) over WON tickets still shows the true, smaller loss.
    const final = payout === Number(bet.stake) ? 'VOID' : 'WON';
    if (final === bet.status) return;
    await client.query('UPDATE bets SET status = $1, total_odds = $2, potential_return = $3 WHERE id = $4', [final, mult, payout, betId]);
    await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [payout, bet.user_id]);
    return;
  }

  if (nextStatus === bet.status) return;

  await client.query('UPDATE bets SET status = $1 WHERE id = $2', [nextStatus, betId]);
  if (nextStatus === 'WON' && bet.status !== 'WON') {
    await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [bet.potential_return, bet.user_id]);
  }
  if (nextStatus === 'VOID' && bet.status !== 'VOID') {
    await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [bet.stake, bet.user_id]);
  }
}

// Legs the rules above cannot decide stay PENDING for manual settlement. The real
// market names come from the provider, so log each distinct one once per process:
// that tells which markets people actually bet on that still have no rule.
const loggedUnrecognized = new Set();
function noteUnrecognizedMarket(leg) {
  const key = String(leg.market_name || leg.market_id || '?');
  if (loggedUnrecognized.has(key) || loggedUnrecognized.size >= 300) return;
  loggedUnrecognized.add(key);
  console.log('[settle] no auto rule for market "' + key + '" (selection "' + (leg.selection_name || leg.selection_id) + '") -- left PENDING for manual settlement');
}

// Facts the final score alone cannot give: which team scored first / last, and the
// corner counts. They come from the match_events log and the live statistics row.
// Anything incomplete stays undefined so the legs that need it wait for the admin
// instead of being decided on a guess. Always called OUTSIDE a transaction: a failed
// query inside one would abort it.
export async function loadMatchFacts(client, matchId, homeTeam, awayTeam, homeScore, awayScore) {
  const facts = {};
  try {
    const nh = String(homeTeam ?? '').trim().toLowerCase();
    const na = String(awayTeam ?? '').trim().toLowerCase();
    const { rows: ev } = await client.query(
      `SELECT type, team, minute FROM match_events WHERE match_id = $1 AND type IN ('GOAL','CORNER') ORDER BY created_at, id`,
      [matchId]
    );
    const sideOf = (t) => {
      const n = String(t ?? '').trim().toLowerCase();
      return n && n === nh ? 'HOME' : n && n === na ? 'AWAY' : null;
    };
    const goals = (ev || []).filter((e) => e.type === 'GOAL').map((e) => sideOf(e.team));
    const total = homeScore + awayScore;
    if (total > 0) {
      if (awayScore === 0) { facts.firstGoal = 'HOME'; facts.lastGoal = 'HOME'; }
      else if (homeScore === 0) { facts.firstGoal = 'AWAY'; facts.lastGoal = 'AWAY'; }
      else if (goals.length === total && goals.every(Boolean)) { facts.firstGoal = goals[0]; facts.lastGoal = goals[goals.length - 1]; }
    }
    const corners = (ev || []).filter((e) => e.type === 'CORNER');
    const { rows: st } = await client.query('SELECT corners_home, corners_away FROM live_statistics WHERE match_id = $1', [matchId]);
    if (st && st[0] && st[0].corners_home != null && st[0].corners_away != null) {
      const totalCorners = Number(st[0].corners_home) + Number(st[0].corners_away);
      facts.cornersTotal = totalCorners;
      // first-half corners: only when the event log holds every corner and each has a minute
      if (corners.length === totalCorners && corners.every((c) => c.minute != null)) {
        facts.cornersH1 = corners.filter((c) => Number(c.minute) <= 45).length;
      }
    }
  } catch (err) {
    // No events / stats available: the dependent markets simply stay pending.
  }
  return facts;
}

// Given a final score, automatically settles every market whose winner is
// unambiguous from the final score alone (see determineLegOutcome): 1X2,
// double chance, draw-no-bet, over/under (match and team), BTTS, odd/even,
// correct score and whole/half-line handicaps. Anything else (half-time
// markets, combos, quarter handicaps) is left PENDING for manual review.
// Returns null if the match doesn't exist or is already settled (so callers
// — both the admin route and the automatic poller — never double-pay a bet);
// settleStuckBets() below is the safety net that re-checks leftovers.
export async function settleMatch(matchId, homeScore, awayScore, { force = false } = {}) {
  const client = await pool.connect();
  try {
    const { rows: matchRows } = await client.query('SELECT * FROM matches_cache WHERE id = $1', [matchId]);
    const match = matchRows[0];
    if (!match) return null;
    if (!force && match.status === 'FINISHED' && match.settled_at) return null; // already settled, don't redo

    const totalGoals = homeScore + awayScore;
    const bothScored = homeScore > 0 && awayScore > 0;
    const winner = homeScore > awayScore ? 'HOME' : awayScore > homeScore ? 'AWAY' : 'DRAW';

    const { rows: legs } = await client.query(
      `SELECT * FROM bet_selections WHERE match_id = $1 AND status = 'PENDING'`,
      [matchId]
    );

    const affectedBetIds = new Set();
    let autoSettledCount = 0;
    let leftPendingCount = 0;
    const facts = legs.length ? await loadMatchFacts(client, matchId, match.home_team, match.away_team, homeScore, awayScore) : {};

    await client.query('BEGIN');
    try {
      for (const leg of legs) {
        affectedBetIds.add(leg.bet_id);
        const outcome = determineLegOutcome(leg, {
          winner, totalGoals, bothScored, homeScore, awayScore,
          htHome: match.ht_home == null ? undefined : Number(match.ht_home),
          htAway: match.ht_away == null ? undefined : Number(match.ht_away),
          ...facts,
        });

        if (outcome) {
          await client.query('UPDATE bet_selections SET status = $1 WHERE id = $2', [outcome, leg.id]);
          autoSettledCount++;
        } else {
          leftPendingCount++;
          noteUnrecognizedMarket(leg);
        }
      }

      await client.query(
        `UPDATE matches_cache SET status = 'FINISHED', result_home = $1, result_away = $2, settled_at = $3 WHERE id = $4`,
        [homeScore, awayScore, Date.now(), matchId]
      );

      for (const betId of affectedBetIds) await recomputeBetStatus(betId, client);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    return { autoSettledLegs: autoSettledCount, leftPendingForManualReview: leftPendingCount, affectedBets: affectedBetIds.size };
  } finally {
    client.release();
  }
}

// Safety net / verification pass. Walks every PENDING leg whose match is
// already FINISHED with a stored score and settles it from that score, then
// recomputes the affected tickets (and any ticket whose legs are all decided
// but whose own status is still PENDING). This is what closes tickets that
// were left "HAPUR" because settleMatch() had already run (and then refuses
// to run again) before the market type was understood, or a leg was missed.
// Idempotent: recomputeBetStatus locks the bet row and only pays on the
// transition into WON, so running it repeatedly never double-pays.
export async function settleStuckBets() {
  // Step 0: matches that were closed (FINISHED) WITHOUT being settled, so they have
  // no stored final score. Their last live score + clock is the best final score we
  // have; settleMatch() stores it and decides every leg. Only matches that really
  // had a score AND a running clock qualify (same guard as hasRealLiveResult in
  // london365.js) -- a match that never had live data is never settled on an
  // invented 0-0 and stays for the admin.
  let closedUnsettled = 0;
  try {
    const { rows: unsettled } = await pool.query(
      `SELECT DISTINCT m.id, m.live_home_score, m.live_away_score
         FROM matches_cache m
         JOIN bet_selections bs ON bs.match_id = m.id AND bs.status = 'PENDING'
        WHERE m.status = 'FINISHED'
          AND (m.result_home IS NULL OR m.result_away IS NULL)
          AND m.live_home_score IS NOT NULL AND m.live_away_score IS NOT NULL
          AND m.live_minute IS NOT NULL AND TRIM(m.live_minute::text) <> ''`
    );
    for (const m of unsettled) {
      try {
        const r = await settleMatch(m.id, Number(m.live_home_score), Number(m.live_away_score));
        if (r) closedUnsettled++;
      } catch (err) {
        console.error('[settle] could not settle closed match ' + m.id + ':', err.message);
      }
    }
  } catch (err) {
    console.error('[settle] closed-unsettled pass failed:', err.message);
  }

  const client = await pool.connect();
  try {
    const { rows: legs } = await client.query(
      `SELECT bs.*, m.result_home, m.result_away, m.ht_home, m.ht_away, m.home_team AS m_home_team, m.away_team AS m_away_team
         FROM bet_selections bs
         JOIN matches_cache m ON m.id = bs.match_id
        WHERE bs.status = 'PENDING'
          AND m.status = 'FINISHED'
          AND m.result_home IS NOT NULL AND m.result_away IS NOT NULL`
    );
    const { rows: undecided } = await client.query(
      `SELECT b.id FROM bets b
        WHERE b.status = 'PENDING'
          AND EXISTS (SELECT 1 FROM bet_selections x WHERE x.bet_id = b.id)
          AND NOT EXISTS (SELECT 1 FROM bet_selections x WHERE x.bet_id = b.id AND x.status = 'PENDING')`
    );

    const affectedBetIds = new Set(undecided.map((r) => r.id));
    let settledLegs = 0;
    const factsByMatch = new Map();
    for (const leg of legs) {
      if (factsByMatch.has(leg.match_id)) continue;
      factsByMatch.set(leg.match_id, await loadMatchFacts(
        client, leg.match_id, leg.m_home_team, leg.m_away_team, Number(leg.result_home), Number(leg.result_away)));
    }

    await client.query('BEGIN');
    try {
      for (const leg of legs) {
        const home = Number(leg.result_home);
        const away = Number(leg.result_away);
        const outcome = determineLegOutcome(leg, {
          winner: home > away ? 'HOME' : away > home ? 'AWAY' : 'DRAW',
          totalGoals: home + away,
          bothScored: home > 0 && away > 0,
          homeScore: home,
          awayScore: away,
          htHome: leg.ht_home == null ? undefined : Number(leg.ht_home),
          htAway: leg.ht_away == null ? undefined : Number(leg.ht_away),
          ...(factsByMatch.get(leg.match_id) || {}),
        });
        if (!outcome) { noteUnrecognizedMarket(leg); continue; }
        await client.query('UPDATE bet_selections SET status = $1 WHERE id = $2', [outcome, leg.id]);
        affectedBetIds.add(leg.bet_id);
        settledLegs++;
      }
      for (const betId of affectedBetIds) await recomputeBetStatus(betId, client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    return { settledLegs, recomputedBets: affectedBetIds.size, closedUnsettled };
  } finally {
    client.release();
  }
}

// ---- closure guarantee ------------------------------------------------------
// A ticket is either still open because its match has not finished yet, or it is
// closed. It must never sit "HAPUR" for good. Two kinds of leg can still get stuck
// after everything above: a market no rule can decide (the provider's own naming,
// manual settlement never done) and a match that never produces a result
// (postponed, abandoned, dropped by the feed). Once the match is more than
// UNSETTLED_BET_VOID_AFTER_HOURS (default 24h) past kickoff, such a leg is VOIDed:
// it drops out of the ticket (a single bet is refunded, an accumulator is paid on
// its remaining legs) -- the same treatment a bookmaker gives a postponed match.
// 0 disables it. Admins can still settle any of these by hand before the deadline.
const UNSETTLED_VOID_AFTER_MS = Math.max(0, Number(process.env.UNSETTLED_BET_VOID_AFTER_HOURS ?? 24)) * 3600 * 1000;

export function isLegOverdue({ matchStart, betCreatedAt }, now, olderThanMs) {
  if (!(olderThanMs > 0)) return false;
  const start = Date.parse(matchStart);
  // No match row any more (cleaned up): fall back to when the ticket was placed.
  const ref = Number.isFinite(start) ? start : Number(betCreatedAt);
  return Number.isFinite(ref) && now - ref > olderThanMs;
}

export async function voidOverdueLegs({ olderThanMs = UNSETTLED_VOID_AFTER_MS, now = Date.now() } = {}) {
  if (!(olderThanMs > 0)) return { voidedLegs: 0, recomputedBets: 0, disabled: true };
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT bs.id, bs.bet_id, bs.match_id, bs.market_name, bs.selection_name,
              m.start_time AS match_start, b.created_at AS bet_created_at
         FROM bet_selections bs
         JOIN bets b ON b.id = bs.bet_id AND b.status = 'PENDING'
         LEFT JOIN matches_cache m ON m.id = bs.match_id
        WHERE bs.status = 'PENDING'`
    );
    const overdue = rows.filter((r) => isLegOverdue({ matchStart: r.match_start, betCreatedAt: r.bet_created_at }, now, olderThanMs));
    if (overdue.length === 0) return { voidedLegs: 0, recomputedBets: 0 };

    const betIds = new Set();
    await client.query('BEGIN');
    try {
      for (const leg of overdue) {
        await client.query(`UPDATE bet_selections SET status = 'VOID' WHERE id = $1 AND status = 'PENDING'`, [leg.id]);
        betIds.add(leg.bet_id);
      }
      for (const betId of betIds) await recomputeBetStatus(betId, client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    for (const leg of overdue) {
      console.log('[settle] voided overdue leg (no result/rule ' + Math.round(olderThanMs / 3600000) + 'h after kickoff): match ' + leg.match_id + ' / "' + (leg.market_name || '?') + '" / "' + (leg.selection_name || '?') + '"');
    }
    return { voidedLegs: overdue.length, recomputedBets: betIds.size };
  } finally {
    client.release();
  }
}
