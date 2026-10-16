import { useCallback, useEffect, useState } from 'react';
import { Bet, User } from '../types';
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

  const reset = useCallback(() => setMyBets([]), []);
  return { myBets, loadMyBets, reset };
}
