import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BetSelectionItem, Match, User } from '../types';
import * as api from '../services/api';
import { areCorrelated } from '../utils/betSlipRules';

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

  // Set when a pick is refused because it follows the same logic as a pick already on the slip.
  const [blockedNotice, setBlockedNotice] = useState<{ list: string } | null>(null);
  // True for a few seconds after a ticket was booked ("Agjenti pranoi biletën tuaj").
  const [betAccepted, setBetAccepted] = useState(false);
  useEffect(() => {
    if (!betAccepted) return;
    const timer = setTimeout(() => setBetAccepted(false), 5000);
    return () => clearTimeout(timer);
  }, [betAccepted]);
  const selectionsRef = useRef<BetSelectionItem[]>([]);
  selectionsRef.current = selections;
  useEffect(() => {
    if (!blockedNotice) return;
    const timer = setTimeout(() => setBlockedNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [blockedNotice]);

  const selectedIds = useMemo(() => selections.map((s) => selectionKey(s.matchId, s.marketId, s.selectionId)), [selections]);

  const toggleSelection = useCallback((match: Match, marketId: string, selectionId: string, boosted?: boolean) => {
    if (!currentUser) return;
    const market = match.markets.find((m) => m.id === marketId);
    const option = market?.options.find((o) => o.id === selectionId);
    if (!market || !option) return;

    const key = selectionKey(match.id, marketId, selectionId);
    const prev = selectionsRef.current;
    let next: BetSelectionItem[];
    if (prev.some((s) => selectionKey(s.matchId, s.marketId, s.selectionId) === key)) {
      next = prev.filter((s) => selectionKey(s.matchId, s.marketId, s.selectionId) !== key);
    } else {
      // Selections of the SAME market of the SAME match exclude each other (picking "2" after "1"
      // drops "1": they can never both win).
      const others = prev.filter((s) => !(s.matchId === match.id && s.marketId === marketId));
      const picked: BetSelectionItem = {
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
      // Same logic as a pick already on the slip (1+ and 2+ goals, Over 1.5 and Over 2.5, 1 and 1X ...):
      // one decides or overlaps the other, so the pick is not added at all. The server refuses such
      // tickets too (server/ticketCorrelation.js); this just stops them at the tap.
      const tied = others.filter((o) => areCorrelated(o, picked));
      if (tied.length) {
        setBlockedNotice({ list: tied.map((o) => `${o.marketName} - ${o.selectionName}`).join(', ') });
        return;
      }
      next = [...others, picked];
    }
    selectionsRef.current = next;
    setSelections(next);
  }, [currentUser]);

  const removeSelection = useCallback((key: string) => {
    setSelections((prev) => prev.filter((s) => selectionKey(s.matchId, s.marketId, s.selectionId) !== key));
  }, []);

  const clearSelections = useCallback(() => setSelections([]), []);

  const placeBet = useCallback(async (stake: number, type: 'SINGLE' | 'ACCUMULATOR', currency: 'ALL' | 'EUR' = 'ALL'): Promise<boolean> => {
    if (!currentUser || selections.length === 0) return false;
    setBetError(null);
    try {
      const result = await api.placeBet(stake, type, selections, currency);
      setCurrentUser((prev) => (prev ? { ...prev, balance: result.balance, balanceEur: result.balanceEur } : prev));
      setSelections([]);
      // The ticket is booked: tell the player the agent accepted it (see BetAcceptedToast).
      setBetAccepted(true);
      try { await onPlaced(); } catch { /* refreshing "my bets" must never turn a booked ticket into an error */ }
      return true;
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
        return false;
      }
      if (e instanceof api.ApiError && (e.code === 'MARKET_CLOSED' || e.code === 'MATCH_FINISHED') && Array.isArray(e.body?.closed)) {
        // the market (or match) closed, or the outcome is already decided: drop exactly those legs
        const closed = e.body.closed as Closed[];
        setSelections((prev) => prev.filter((sel) => !closed.some((c) => sameLeg(c, sel))));
      }
      setBetError(e.message || 'Could not place bet');
      return false;
    }
  }, [currentUser, selections, setCurrentUser, onPlaced]);

  return { selections, selectedIds, betError, blockedNotice, dismissBlockedNotice: () => setBlockedNotice(null), betAccepted, dismissBetAccepted: () => setBetAccepted(false), toggleSelection, removeSelection, clearSelections, placeBet, reset: clearSelections };
}
