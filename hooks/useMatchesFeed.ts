import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Match, MatchStatus } from '../types';
import * as api from '../services/api';
import { keepNewerLive } from '../utils/liveMerge';
import { isGhostLiveMatch, isStaleLiveMatch } from '../utils/liveStatus';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // slow safety net: the WebSocket is the primary update path
const RETRY_BASE_MS = 10_000;
const RETRY_MAX_MS = 60_000;
// Stored as the Albanian source text and translated where it is rendered, so it follows the language switch.
const LOAD_ERROR = 'S\'arritëm të lidhemi me serverin. Kontrollo internetin dhe provo përsëri.';

const readCache = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
};
const writeCache = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
};

/**
 * The match list: seeded from the last successful fetch (instant first paint), refreshed in the
 * background, retried with backoff after a failure. `enabled` is false until someone is signed in
 * and looking at the sportsbook; `sessionKey` (the user id) restarts everything for a new user.
 */
export function useMatchesFeed(enabled: boolean, sessionKey: string | null) {
  // Matches in play are NOT seeded from the cache: their minute, score and half-time status are
  // minutes or hours old, and showing them first meant a wrong clock until the fresh data arrived
  // (or until a manual refresh). They appear, correct, with the first /matches/live answer.
  const [allMatches, setMatches] = useState<Match[]>(() =>
    readCache<Match[]>('cachedMatches', []).filter((m) => !isStaleLiveMatch(m) && m.status !== MatchStatus.LIVE && !m.liveStatus));
  const [leagueNames, setLeagueNames] = useState<Record<string, string>>(() => readCache('cachedLeagueNames', {}));
  const [leagueMeta, setLeagueMeta] = useState<Record<string, api.LeagueMeta>>(() => readCache('cachedLeagueMeta', {}));
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Rows LIVE without a real provider clock are hidden; derived, so a hidden row appears the
  // moment a live tick brings its clock.
  const matches = useMemo(() => allMatches.filter((m) => !isGhostLiveMatch(m)), [allMatches]);

  // "Have we ever loaded" is independent of what the last fetch returned: a single empty refresh
  // must not bring the full-screen spinner back over matches that are already on screen.
  const hasLoadedOnceRef = useRef(matches.length > 0);
  const retryAttemptRef = useRef(0);
  const loadLiveRef = useRef<() => Promise<void>>(async () => {});
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadMatches = useCallback(async () => {
    if (!enabled) return;
    setIsLoading((prev) => (hasLoadedOnceRef.current ? prev : true));
    try {
      const { matches: freshAll, leagueNames: freshNames, leagueMeta: freshMeta } = await api.fetchMatches();
      // Drop matches the feed abandoned (still "LIVE" hours after kickoff).
      const fresh = freshAll.filter((m) => !isStaleLiveMatch(m));
      setMatches((current) => keepNewerLive(current, fresh)); // a list a few seconds old must not undo a newer live minute
      writeCache('cachedMatches', fresh);
      // The list the server keeps in memory can be up to a minute or so old; the matches in play are then refreshed from
      // their own small, cheap request, so scores, minutes and status are never as old as the list.
      loadLiveRef.current();
      if (freshNames) {
        setLeagueNames((prev) => { const next = { ...prev, ...freshNames }; writeCache('cachedLeagueNames', next); return next; });
      }
      if (freshMeta) {
        setLeagueMeta((prev) => { const next = { ...prev, ...freshMeta }; writeCache('cachedLeagueMeta', next); return next; });
      }
      setLoadError(null);
      hasLoadedOnceRef.current = true;
      retryAttemptRef.current = 0;
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    } catch (e) {
      console.error('Failed to load matches', e);
      setLoadError(LOAD_ERROR);
      // 10s, 20s, 40s, capped at 60s: rides out a restart unattended without hammering a long outage.
      const attempt = retryAttemptRef.current;
      retryAttemptRef.current = attempt + 1;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => { loadMatchesRef.current(); }, Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS));
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  // Fast path for a tab that was closed/hidden: the cached list holds old minutes and scores, and the full list
  // is big. This asks only for the matches in play and puts them over the cached rows right away.
  const loadLive = useCallback(async () => {
    if (!enabled) return;
    try {
      const { matches: live } = await api.fetchLiveMatches();
      const liveIds = new Set(live.map((m) => m.id));
      setMatches((current) => {
        const byId = new Map(live.map((m) => [m.id, m]));
        const known = new Set(current.map((m) => m.id));
        // A cached row still marked LIVE that the server no longer lists as live is old: drop it.
        const merged = current
          .filter((m) => m.status !== MatchStatus.LIVE || liveIds.has(m.id))
          .map((m) => byId.get(m.id) ?? m);
        for (const m of live) if (!known.has(m.id)) merged.push(m);
        return keepNewerLive(current, merged);
      });
    } catch { /* the full load below is the fallback */ }
  }, [enabled]);

  useEffect(() => { loadLiveRef.current = loadLive; }, [loadLive]);

  // The retry timer calls the NEWEST loadMatches (not the one from the render that set it).
  const loadMatchesRef = useRef(loadMatches);
  useEffect(() => { loadMatchesRef.current = loadMatches; }, [loadMatches]);

  useEffect(() => () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); }, []);

  useEffect(() => {
    loadLive(); // in parallel with the full load: live data shows first
    loadMatches();
    const interval = setInterval(loadMatches, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionKey]);

  /** Forget everything (logout). */
  const reset = useCallback(() => {
    setMatches([]);
    hasLoadedOnceRef.current = false;
  }, []);

  return { matches, setMatches, leagueNames, leagueMeta, isLoading, loadError, loadMatches, loadLive, reset };
}
