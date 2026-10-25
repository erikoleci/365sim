import { useCallback, useEffect, useState } from 'react';
import { Bet, BetStatus, User } from '../types';
import * as api from '../services/api';

/** The signed-in user's tickets. */
export function useMyBets(currentUser: User | null) {
  const [myBets, setMyBets] = useState<Bet[]>([]);
  const userId = currentUser?.id ?? null;

  const loadMyBets = useCallback(async () => {
    if (!userId) return;
    try {
      setMyBets(await api.fetchMyBets());
    } catch (e) {
      console.error('Failed to load bets', e);
    }
  }, [userId]);

  useEffect(() => { loadMyBets(); }, [loadMyBets]);

  // While any ticket is still open: look again every 15 s, and as soon as the page comes back into
  // view (tab switch, phone unlocked). A ticket that the server settled is then shown as won /
  // lost without a manual page refresh.
  const hasOpenBets = myBets.some((b) => b.status === BetStatus.PENDING);
  useEffect(() => {
    if (!userId || !hasOpenBets) return;
    const refresh = () => { if (document.visibilityState !== 'hidden') void loadMyBets(); };
    const timer = setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [userId, hasOpenBets, loadMyBets]);

  const reset = useCallback(() => setMyBets([]), []);
  return { myBets, loadMyBets, reset };
}
