import { useEffect, useState } from 'react';
import { User } from '../types';
import * as api from '../services/api';

const readCachedUser = (): User | null => {
  try { return JSON.parse(localStorage.getItem('cachedUser') || 'null'); } catch { return null; }
};

/**
 * The signed-in user. Seeded from the last known user so a refresh shows the app immediately
 * instead of a full-screen spinner; the real check against the backend still runs and logs the
 * person out if the token turned out to be expired.
 */
export function useAuth() {
  const [currentUser, setCurrentUser] = useState<User | null>(readCachedUser);
  const [authChecked, setAuthChecked] = useState(() => {
    try { return !!api.getToken() && !!localStorage.getItem('cachedUser'); } catch { return false; }
  });

  useEffect(() => {
    (async () => {
      const user = await api.fetchCurrentUser();
      setCurrentUser(user);
      setAuthChecked(true);
    })();
  }, []);

  // Keep the cached copy in step with the real user (login, logout, balance changes).
  useEffect(() => {
    try {
      if (currentUser) localStorage.setItem('cachedUser', JSON.stringify(currentUser));
      else localStorage.removeItem('cachedUser');
    } catch { /* storage unavailable */ }
  }, [currentUser]);

  return { currentUser, setCurrentUser, authChecked };
}
