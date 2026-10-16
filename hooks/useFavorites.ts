import { useCallback, useEffect, useMemo, useState } from 'react';
import { User } from '../types';
import * as api from '../services/api';

/** Favourite teams and leagues of the signed-in user, with an optimistic toggle. */
export function useFavorites(currentUser: User | null) {
  const [favorites, setFavorites] = useState<api.Favorite[]>([]);
  const userId = currentUser?.id ?? null;

  useEffect(() => {
    if (!userId) { setFavorites([]); return; }
    (async () => {
      try {
        const { favorites: f } = await api.getFavorites();
        setFavorites(f);
      } catch (e) {
        console.error('Failed to load favorites', e);
      }
    })();
  }, [userId]);

  const favoriteTeams = useMemo(() => new Set(favorites.filter((f) => f.type === 'TEAM').map((f) => f.value)), [favorites]);
  const favoriteLeagues = useMemo(() => new Set(favorites.filter((f) => f.type === 'LEAGUE').map((f) => f.value)), [favorites]);

  // Optimistic: the star flips on click, the server's answer reconciles it, and a failed request
  // rolls back to the exact previous state.
  const toggleFavorite = useCallback(async (type: 'TEAM' | 'LEAGUE', value: string) => {
    let previous: api.Favorite[] = [];
    setFavorites((current) => {
      previous = current;
      const already = current.some((f) => f.type === type && f.value === value);
      return already
        ? current.filter((f) => !(f.type === type && f.value === value))
        : [...current, { type, value }];
    });
    try {
      const { favorites: f } = await api.toggleFavorite(type, value);
      setFavorites(f);
    } catch (e) {
      console.error('Failed to toggle favorite', e);
      setFavorites(previous);
    }
  }, []);

  return { favoriteTeams, favoriteLeagues, toggleFavorite };
}
