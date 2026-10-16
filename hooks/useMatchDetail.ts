import { useEffect, useMemo, useState } from 'react';
import { Match } from '../types';
import * as api from '../services/api';

/**
 * The match open in the detail view. The list only carries the 1X2 market per match (keeps the
 * payload small), so the full match with all its markets is fetched on demand. Score, status and
 * clock always come from the list entry, so the live updates keep applying while it is open; the
 * markets are swapped in once the full fetch lands.
 */
export function useMatchDetail(detailMatchId: string | null, matches: Match[]) {
  const [full, setFull] = useState<Match | null>(null);

  useEffect(() => {
    if (!detailMatchId) { setFull(null); return; }
    let cancelled = false;
    setFull(null); // never show the PREVIOUS match's markets while this one loads
    api.fetchMatchById(detailMatchId)
      .then((m) => { if (!cancelled) setFull(m); })
      .catch((e) => console.error('Failed to load match detail', e));
    return () => { cancelled = true; };
  }, [detailMatchId]);

  const detailMatch = useMemo(() => {
    const entry = matches.find((m) => m.id === detailMatchId);
    if (!entry) return undefined;
    return full && full.id === detailMatchId ? { ...entry, markets: full.markets } : entry;
  }, [matches, detailMatchId, full]);

  return { detailMatch, setDetailMatchFull: setFull };
}
