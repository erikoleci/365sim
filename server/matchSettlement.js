import db from './db.js';

// Recompute a bet's overall status from its legs, and pay out balance
// exactly once, the moment it transitions into WON.
export function recomputeBetStatus(betId) {
  const bet = db.prepare('SELECT * FROM bets WHERE id = ?').get(betId);
  if (!bet) return;
  const legs = db.prepare('SELECT * FROM bet_selections WHERE bet_id = ?').all(betId);

  let nextStatus = bet.status;
  if (legs.some((l) => l.status === 'LOST')) {
    nextStatus = 'LOST';
  } else if (legs.every((l) => l.status === 'WON')) {
    nextStatus = 'WON';
  } else {
    nextStatus = 'PENDING';
  }

  if (nextStatus === bet.status) return;

  const tx = db.transaction(() => {
    db.prepare('UPDATE bets SET status = ? WHERE id = ?').run(nextStatus, betId);
    if (nextStatus === 'WON' && bet.status !== 'WON') {
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(bet.potential_return, bet.user_id);
    }
  });
  tx();
}

// Given a final score, automatically settles the markets where the winner
// is unambiguous from the score alone: 1X2 (h2h), Over/Under (totals),
// and Both Teams To Score (btts). Handicap (spreads) legs are intentionally
// left PENDING because settling them correctly needs the exact handicap
// line paired with the leg, which is safer to confirm via manual review.
// Returns null if the match doesn't exist or is already settled (so callers
// — both the admin route and the automatic poller — never double-pay a bet).
export function settleMatch(matchId, homeScore, awayScore, { force = false } = {}) {
  const match = db.prepare('SELECT * FROM matches_cache WHERE id = ?').get(matchId);
  if (!match) return null;
  if (!force && match.status === 'FINISHED' && match.settled_at) return null; // already settled, don't redo

  const totalGoals = homeScore + awayScore;
  const bothScored = homeScore > 0 && awayScore > 0;
  const winner = homeScore > awayScore ? 'HOME' : awayScore > homeScore ? 'AWAY' : 'DRAW';

  const legs = db.prepare(`SELECT * FROM bet_selections WHERE match_id = ? AND status = 'PENDING'`).all(matchId);

  const affectedBetIds = new Set();
  const updateLeg = db.prepare('UPDATE bet_selections SET status = ? WHERE id = ?');
  let autoSettledCount = 0;
  let leftPendingCount = 0;

  const tx = db.transaction(() => {
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
        updateLeg.run(outcome, leg.id);
        autoSettledCount++;
      } else {
        leftPendingCount++;
      }
    }

    db.prepare(`
      UPDATE matches_cache SET status = 'FINISHED', result_home = ?, result_away = ?, settled_at = ?
      WHERE id = ?
    `).run(homeScore, awayScore, Date.now(), matchId);
  });
  tx();

  for (const betId of affectedBetIds) recomputeBetStatus(betId);

  return { autoSettledLegs: autoSettledCount, leftPendingForManualReview: leftPendingCount, affectedBets: affectedBetIds.size };
}
