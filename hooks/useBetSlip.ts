import { useCallback, useMemo, useState } from 'react';
import { BetSelectionItem, Match, User } from '../types';
import * as api from '../services/api';

const BOOST_MULTIPLIER = 1.12;
const selectionKey = (matchId: string, marketId: string, selectionId: string) => `${matchId}-${marketId}-${selectionId}`;

interface Closed { matchId: string; marketId: string; selectionId: string }
interface OddsChange extends Closed { newOdds: number }
const sameLeg = (a: Closed, b: Closed) => a.matchId === b.matchId && a.marketId === b.marketId && a.selectionId === b.selectionId;

interface Options {
  currentUser: User | null;
  setCurrentUser: (update: (prev: User | null) => User | null) => void;
  /** Called after a ticket was placed (refresh "my bets", close the slip). */
  onPlaced: () => void | Promise<void>;
}

/** The bet slip: picking selections, and placing the ticket with the server's price/market checks. */
export function useBetSlip({ currentUser, setCurrentUser, onPlaced }: Options) {
  const [selections, setSelections] = useState<BetSelectionItem[]>([]);
  const [betError, setBetError] = useState<string | null>(null);

  const selectedIds = useMemo(() => selections.map((s) => selectionKey(s.matchId, s.marketId, s.selectionId)), [selections]);

  const toggleSelection = useCallback((match: Match, marketId: string, selectionId: string, boosted?: boolean) => {
    if (!currentUser) return;
    const market = match.markets.find((m) => m.id === marketId);
    const option = market?.options.find((o) => o.id === selectionId);
    if (!market || !option) return;

    const key = selectionKey(match.id, marketId, selectionId);
    setSelections((prev) => {
      if (prev.some((s) => selectionKey(s.matchId, s.marketId, s.selectionId) === key)) {
        return prev.filter((s) => selectionKey(s.matchId, s.marketId, s.selectionId) !== key);
      }
      // Selections of the SAME market of the SAME match exclude each other (picking "2" after "1"
      // drops "1": they can never both win).
      const others = prev.filter((s) => !(s.matchId === match.id && s.marketId === marketId));
      return [...others, {
        matchId: match.id,
        matchHome: match.homeTeam,
        matchAway: match.awayTeam,
        marketId: market.id,
        marketName: market.name,
        selectionId: option.id,
        selectionName: option.name,
        odds: boosted ? Number((option.odds * BOOST_MULTIPLIER).toFixed(2)) : option.odds,
        status: 'PENDING' as any,
        boosted: !!boosted,
      }];
    });
  }, [currentUser]);

  const removeSelection = useCallback((key: string) => {
    setSelections((prev) => prev.filter((s) => selectionKey(s.matchId, s.marketId, s.selectionId) !== key));
  }, []);

  const clearSelections = useCallback(() => setSelections([]), []);

  const placeBet = useCallback(async (stake: number, type: 'SINGLE' | 'ACCUMULATOR') => {
    if (!currentUser || selections.length === 0) return;
    setBetError(null);
    try {
      const result = await api.placeBet(stake, type, selections);
      setCurrentUser((prev) => (prev ? { ...prev, balance: result.balance } : prev));
      setSelections([]);
      await onPlaced();
    } catch (e: any) {
      // The server re-verifies every price and market at placement time. Two answers leave the
      // ticket fixable, so the slip is updated instead of leaving a generic error:
      if (e instanceof api.ApiError && e.code === 'ODDS_CHANGED' && Array.isArray(e.body?.changes)) {
        // prices moved: show "was X, now Y" and let the person accept the new prices
        const changes = e.body.changes as OddsChange[];
        setSelections((prev) => prev.map((sel) => {
          const change = changes.find((c) => sameLeg(c, sel));
          return change ? { ...sel, previousOdds: sel.odds, odds: change.newOdds } : sel;
        }));
        return;
      }
      if (e instanceof api.ApiError && (e.code === 'MARKET_CLOSED' || e.code === 'MATCH_FINISHED') && Array.isArray(e.body?.closed)) {
        // the market (or match) closed, or the outcome is already decided: drop exactly those legs
        const closed = e.body.closed as Closed[];
        setSelections((prev) => prev.filter((sel) => !closed.some((c) => sameLeg(c, sel))));
      }
      setBetError(e.message || 'Could not place bet');
    }
  }, [currentUser, selections, setCurrentUser, onPlaced]);

  return { selections, selectedIds, betError, toggleSelection, removeSelection, clearSelections, placeBet, reset: clearSelections };
}
