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
export function validateStakeAmount(stake, { min, max }) {
  if (typeof stake !== 'number' || !Number.isFinite(stake) || stake <= 0) {
    return 'Stake must be a positive number';
  }
  if (stake < min) return `Minimum stake is ${min}`;
  if (stake > max) return `Maximum stake is ${max}`;
  return null;
}
