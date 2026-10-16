import { Match } from '../types';

export interface OddsChange {
  marketId: string;
  selectionId: string;
  newOdds?: number;
}

/**
 * Applies an ODDS_CHANGED payload's per-selection prices to one match's markets. Returns the SAME
 * array when nothing in it was touched, so callers can skip re-rendering that match.
 */
export function patchMarketsOdds(markets: Match['markets'], changes: OddsChange[]): Match['markets'] {
  let touched = false;
  const next = markets.map((market) => {
    const relevant = changes.filter((c) => c.marketId === market.id);
    if (!relevant.length) return market;
    let marketTouched = false;
    const options = market.options.map((option) => {
      const change = relevant.find((c) => c.selectionId === option.id);
      if (!change || typeof change.newOdds !== 'number') return option;
      marketTouched = true;
      return { ...option, odds: change.newOdds };
    });
    if (marketTouched) touched = true;
    return marketTouched ? { ...market, options } : market;
  });
  return touched ? next : markets;
}
