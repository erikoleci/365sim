import type { BetSelectionItem } from '../types';
// The SAME rule the server applies when a ticket is placed (server/routes/bets.js).
import { findCorrelatedSelections } from '../server/ticketCorrelation.js';

const toCorrelationInput = (s: BetSelectionItem) => ({
  matchId: s.matchId,
  marketId: s.marketId,
  marketName: s.marketName,
  optionName: s.selectionName,
  home: s.matchHome,
  away: s.matchAway,
});

export const legLabel = (s: BetSelectionItem) => `${s.marketName} - ${s.selectionName}`;

/** Two legs of one ticket that follow the same logic (one decides, overlaps or rules out the other). */
export const areCorrelated = (a: BetSelectionItem, b: BetSelectionItem) =>
  Boolean(findCorrelatedSelections([toCorrelationInput(a), toCorrelationInput(b)]));

/**
 * Adds `added` to the slip the way the big bookmakers do: the new pick wins and everything it is
 * tied to is dropped.
 *   - another outcome of the SAME market of the same match ("2" after "1"): replaced silently;
 *   - any other leg of the same match that follows the same logic (4+ with 1+/2+/3+, "1-3 goals"
 *     with "2+", "1" with "1X", BTTS with Over 1.5, two corner lines ...): replaced, and reported
 *     in `droppedTied` so the slip can tell the person why it disappeared.
 */
export function addToSlip(prev: BetSelectionItem[], added: BetSelectionItem): {
  next: BetSelectionItem[];
  droppedTied: BetSelectionItem[];
} {
  const sameMarket = (s: BetSelectionItem) => s.matchId === added.matchId && s.marketId === added.marketId;
  const droppedTied = prev.filter((s) => !sameMarket(s) && areCorrelated(s, added));
  const next = prev.filter((s) => !sameMarket(s) && !droppedTied.includes(s));
  return { next: [...next, added], droppedTied };
}
