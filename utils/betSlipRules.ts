import type { BetSelectionItem } from '../types';
// The SAME rule the server applies when a ticket is placed (server/routes/bets.js).
import { findCorrelatedSelections } from '../server/ticketCorrelation.js';

export const legKey = (s: Pick<BetSelectionItem, 'matchId' | 'marketId' | 'selectionId'>) =>
  `${s.matchId}-${s.marketId}-${s.selectionId}`;

const toCorrelationInput = (s: BetSelectionItem) => ({
  matchId: s.matchId,
  marketId: s.marketId,
  marketName: s.marketName,
  optionName: s.selectionName,
  home: s.matchHome,
  away: s.matchAway,
});

/** Two legs of one ticket that follow the same logic (one decides, overlaps or rules out the other). */
export const areCorrelated = (a: BetSelectionItem, b: BetSelectionItem) =>
  Boolean(findCorrelatedSelections([toCorrelationInput(a), toCorrelationInput(b)]));

/**
 * Legs of the slip that cannot be combined, as in the big bookmakers: nothing is removed behind
 * the person's back, the tied legs are flagged and the ticket cannot be placed until one of them
 * is removed. Returns legKey -> the legs it is tied to (legs without a conflict are absent).
 */
export function findSlipConflicts(selections: BetSelectionItem[]): Map<string, BetSelectionItem[]> {
  const conflicts = new Map<string, BetSelectionItem[]>();
  const add = (from: BetSelectionItem, to: BetSelectionItem) => {
    const key = legKey(from);
    conflicts.set(key, [...(conflicts.get(key) || []), to]);
  };
  for (let i = 0; i < selections.length; i++) {
    for (let j = i + 1; j < selections.length; j++) {
      if (areCorrelated(selections[i], selections[j])) {
        add(selections[i], selections[j]);
        add(selections[j], selections[i]);
      }
    }
  }
  return conflicts;
}
