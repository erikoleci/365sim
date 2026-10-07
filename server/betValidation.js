// Pure validation helpers for bet placement — kept separate from
// routes/bets.js (which is DB-coupled) so they can be unit tested directly.

// Rejects a ticket that backs two outcomes of the same market on the same
// match (e.g. Home + Draw from the same 1X2 market, or Over 2.5 + Under 2.5
// from the same totals market). Returns the conflicting pair, or null if
// the selections are all from distinct (matchId, marketId) pairs.
export function findConflictingSelection(selections) {
  const seenMarkets = new Map(); // `${matchId}::${marketId}` -> selectionId already used
  for (const sel of selections) {
    const key = `${sel.matchId}::${sel.marketId}`;
    if (seenMarkets.has(key)) {
      return { existingSelectionId: seenMarkets.get(key), newSelectionId: sel.selectionId };
    }
    seenMarkets.set(key, sel.selectionId);
  }
  return null;
}

// Validates a stake against ticket rules. Returns an error message string,
// or null if the stake is valid.
export function validateStakeAmount(stake, { min, max } = {}) {
  if (typeof stake !== 'number' || !Number.isFinite(stake) || stake <= 0) {
    return 'Stake must be a positive number';
  }
  if (min != null && stake < min) return `Minimum stake is ${min}`;
  // `max` is optional: no upper stake limit is enforced unless one is passed.
  if (max != null && stake > max) return `Maximum stake is ${max}`;
  return null;
}

// A ticket may only be cancelled while it is PENDING, inside the cancel
// window, AND every match on it is still not started. Anything placed on a
// live match (kickoff already passed when the bet was created) can never be
// cancelled, and a pre-match ticket stops being cancellable the moment its
// match kicks off -- otherwise a user could cancel after seeing a goal.
// `matchRows` are the matches_cache rows of the ticket's selections.
export function getCancelBlockReason(bet, matchRows, { now = Date.now(), windowMs } = {}) {
  if (bet.status !== 'PENDING') return 'Only pending bets can be cancelled';
  if (windowMs != null && now - Number(bet.created_at) > windowMs) return 'Cancellation window has expired';
  if (!matchRows || matchRows.length === 0) return 'Bet cannot be cancelled';
  for (const m of matchRows) {
    const kickoff = Date.parse(m.start_time);
    const started = m.status === 'LIVE' || m.status === 'FINISHED' || m.live_status != null
      || (Number.isFinite(kickoff) && kickoff <= now);
    const placedLive = Number.isFinite(kickoff) && kickoff <= Number(bet.created_at);
    if (started || placedLive) return 'Live bets cannot be cancelled';
  }
  return null;
}
