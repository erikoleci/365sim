import pool from './db.js';

// Recompute a bet's overall status from its legs, and pay out balance
// exactly once, the moment it transitions into WON.
export async function recomputeBetStatus(betId, client = pool) {
  const { rows: betRows } = await client.query('SELECT * FROM bets WHERE id = $1', [betId]);
  const bet = betRows[0];
  if (!bet) return;
  const { rows: legs } = await client.query('SELECT * FROM bet_selections WHERE bet_id = $1', [betId]);

  let nextStatus = bet.status;
  if (legs.some((l) => l.status === 'LOST')) {
    nextStatus = 'LOST';
  } else if (legs.every((l) => l.status === 'WON')) {
    nextStatus = 'WON';
  } else {
    nextStatus = 'PENDING';
  }

  if (nextStatus === bet.status) return;

  await client.query('UPDATE bets SET status = $1 WHERE id = $2', [nextStatus, betId]);
  if (nextStatus === 'WON' && bet.status !== 'WON') {
    await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [bet.potential_return, bet.user_id]);
  }
}

// Given a final score, automatically settles the markets where the winner
// is unambiguous from the score alone: 1X2 (h2h), Over/Under (totals),
// and Both Teams To Score (btts). Handicap (spreads) legs are intentionally
// left PENDING because settling them correctly needs the exact handicap
// line paired with the leg, which is safer to confirm via manual review.
// Returns null if the match doesn't exist or is already settled (so callers
// — both the admin route and the automatic poller — never double-pay a bet).
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

    await client.query('BEGIN');
    try {
      for (const leg of legs) {
        affectedBetIds.add(leg.bet_id);
        let outcome = null; // null = leave pending, needs manual review

        if (leg.market_id.endsWith('-h2h')) {
          outcome = leg.selection_id === winner ? 'WON' : 'LOST';
        } else if (leg.market_id.endsWith('-totals')) {
          const idx = leg.selection_id.lastIndexOf('-');
          const side = leg.selection_id.slice(0, idx);       // "Over" | "Under"
          const point = parseFloat(leg.selection_id.slice(idx + 1));
          if (!Number.isNaN(point) && point !== totalGoals) { // skip exact-push lines, review manually
            if (side === 'Over') outcome = totalGoals > point ? 'WON' : 'LOST';
            if (side === 'Under') outcome = totalGoals < point ? 'WON' : 'LOST';
          }
        } else if (leg.market_id.endsWith('-btts')) {
          if (leg.selection_id === 'Yes') outcome = bothScored ? 'WON' : 'LOST';
          if (leg.selection_id === 'No') outcome = !bothScored ? 'WON' : 'LOST';
        }
        // double_chance / draw_no_bet / spreads -> left PENDING on purpose

        if (outcome) {
          await client.query('UPDATE bet_selections SET status = $1 WHERE id = $2', [outcome, leg.id]);
          autoSettledCount++;
        } else {
          leftPendingCount++;
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
