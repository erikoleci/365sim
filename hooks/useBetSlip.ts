import { useCallback, useMemo, useRef, useState } from 'react';
import { BetSelectionItem, Match, User } from '../types';
import * as api from '../services/api';
// Applying the server's correlation rule at click time means the slip can never hold two legs
// that follow the same logic.
import { addToSlip, legLabel } from '../utils/betSlipRules';

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
  const [selections, setSelectionsState] = useState<BetSelectionItem[]>([]);
  const [betError, setBetError] = useState<string | null>(null);
  // Information (not an error): which earlier pick was replaced because it is tied to the new one.
  const [slipNotice, setSlipNotice] = useState<string | null>(null);

  // Always the latest list, so two quick clicks never work from a stale copy.
  const selectionsRef = useRef<BetSelectionItem[]>([]);
  const setSelections = useCallback((next: BetSelectionItem[] | ((prev: BetSelectionItem[]) => BetSelectionItem[])) => {
    const value = typeof next === 'function' ? next(selectionsRef.current) : next;
    selectionsRef.current = value;
    setSelectionsState(value);
  }, []);

  const selectedIds = useMemo(() => selections.map((s) => selectionKey(s.matchId, s.marketId, s.selectionId)), [selections]);

  const toggleSelection = useCallback((match: Match, marketId: string, selectionId: string, boosted?: boolean) => {
    if (!currentUser) return;
    const market = match.markets.find((m) => m.id === marketId);
    const option = market?.options.find((o) => o.id === selectionId);
    if (!market || !option) return;

    const key = selectionKey(match.id, marketId, selectionId);
    const prev = selectionsRef.current;
    setSlipNotice(null);
    if (prev.some((s) => selectionKey(s.matchId, s.marketId, s.selectionId) === key)) {
      setSelections(prev.filter((s) => selectionKey(s.matchId, s.marketId, s.selectionId) !== key));
      return;
    }

    const added: BetSelectionItem = {
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
    };

    // The new pick wins: other outcomes of the same market and every same-match leg that follows
    // the same logic (4+ with 1+/2+/3+, "1-3 goals" with "2+", "1" with "1X", BTTS with Over 1.5 ...)
    // are dropped, because the combined price of such legs would not be the real price.
    const { next, droppedTied } = addToSlip(prev, added);
    if (droppedTied.length > 0) {
      const names = droppedTied.map((s) => `"${legLabel(s)}"`).join(', ');
      setSlipNotice(`${names} u hoq sepse lidhet logjikisht me "${legLabel(added)}" (e njëjta ndeshje). Zgjedhje të lidhura nuk lejohen bashkë në të njëjtin kupon.`);
    }
    setSelections(next);
  }, [currentUser, setSelections]);

  const removeSelection = useCallback((key: string) => {
    setSlipNotice(null);
    setSelections((prev) => prev.filter((s) => selectionKey(s.matchId, s.marketId, s.selectionId) !== key));
  }, [setSelections]);

  const clearSelections = useCallback(() => {
    setSlipNotice(null);
    setSelections([]);
  }, [setSelections]);

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
  }, [currentUser, selections, setCurrentUser, onPlaced, setSelections]);

  return { selections, selectedIds, betError, slipNotice, toggleSelection, removeSelection, clearSelections, placeBet, reset: clearSelections };
}
