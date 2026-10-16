import { useCallback, useEffect, useRef, useState } from 'react';
import { Nav, navKey, planNav } from '../utils/navHistory';
import { navToPath, pathToNav, PATHS } from '../utils/routes';
import { ALL_LEAGUES } from '../utils/leagueFilters';

const LEAGUE_STORAGE_KEY = 'currentLeague';

const readStoredLeague = (): string => {
  try { return localStorage.getItem(LEAGUE_STORAGE_KEY) || ALL_LEAGUES; } catch { return ALL_LEAGUES; }
};

/**
 * The screen to open on load: the one the address names (/ndeshjelive, /liga/..., /ndeshje/<id> ...).
 * On the bare root the league picked last time is restored, like before addresses existed.
 */
const initialNav = (): Nav => {
  const pathname = window.location.pathname;
  if (pathname === '/' || pathname === '') return { ...pathToNav('/'), currentLeague: readStoredLeague() };
  return pathToNav(pathname);
};

/**
 * Which screen of the sportsbook is open, kept in step with the browser address and history:
 *  - every screen has its own address (utils/routes.ts), so it can be opened, shared and bookmarked;
 *  - each step is one history entry, so the phone's back gesture/button walks back through screens
 *    instead of leaving the site (utils/navHistory.ts).
 * The bet slip SELECTIONS are not part of a screen: they live in the slip hook and survive going
 * into a match and coming back.
 */
export function useScreenNav() {
  const [start] = useState(initialNav);
  const [detailMatchId, setDetailMatchId] = useState<string | null>(start.detailMatchId);
  const [isMobileSlipOpen, setIsMobileSlipOpen] = useState(start.isMobileSlipOpen);
  const [showLiveOnly, setShowLiveOnly] = useState(start.showLiveOnly);
  const [showResults, setShowResults] = useState(start.showResults);
  const [currentLeague, setCurrentLeagueState] = useState(start.currentLeague);

  const setCurrentLeague = useCallback((league: string) => {
    setCurrentLeagueState(league);
    try { localStorage.setItem(LEAGUE_STORAGE_KEY, league); } catch { /* storage unavailable */ }
  }, []);

  // Drilling into a league/country leaves the results view.
  useEffect(() => { if (currentLeague !== ALL_LEAGUES) setShowResults(false); }, [currentLeague]);

  const nav: Nav = { detailMatchId, isMobileSlipOpen, showLiveOnly, showResults, currentLeague };
  const navRef = useRef(nav);
  navRef.current = nav;
  const currentKey = navKey(nav);

  const stackRef = useRef<Nav[]>([]);
  const idxRef = useRef(0);

  const applyNav = useCallback((next: Nav) => {
    setDetailMatchId(next.detailMatchId);
    setIsMobileSlipOpen(next.isMobileSlipOpen);
    setShowLiveOnly(next.showLiveOnly);
    setShowResults(next.showResults);
    setCurrentLeague(next.currentLeague);
  }, [setCurrentLeague]);

  useEffect(() => {
    stackRef.current = [navRef.current];
    idxRef.current = 0;
    // The entry we are on after a load must describe the screen that is actually showing.
    window.history.replaceState({ nav: navRef.current, idx: 0 }, '', navToPath(navRef.current));
    const onPop = (e: PopStateEvent) => {
      const idx = typeof e.state?.idx === 'number' ? e.state.idx : 0;
      // An entry from a previous page load has no stack: fall back to what the address says.
      const target: Nav | undefined = stackRef.current[idx] ?? e.state?.nav ?? pathToNav(window.location.pathname);
      idxRef.current = Math.max(0, Math.min(idx, stackRef.current.length - 1));
      if (!target || navKey(target) === navKey(navRef.current)) return;
      applyNav(target);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [applyNav]);

  useEffect(() => {
    const plan = planNav(stackRef.current, idxRef.current, navRef.current);
    if (plan.type === 'none') return;
    if (plan.type === 'back') { window.history.back(); return; }
    stackRef.current = plan.stack;
    idxRef.current = plan.idx;
    window.history.pushState({ nav: navRef.current, idx: plan.idx }, '', navToPath(navRef.current));
  }, [currentKey]);

  /** The phone-style "back" used by the on-screen buttons: it walks the same history. */
  const goBack = useCallback(() => {
    if (idxRef.current > 0) window.history.back();
    else { setDetailMatchId(null); setIsMobileSlipOpen(false); }
  }, []);

  // ---- named moves, so components never juggle the individual flags ----
  const goToLeague = useCallback((league: string) => {
    setShowLiveOnly(false); setShowResults(false); setCurrentLeague(league); setDetailMatchId(null);
  }, [setCurrentLeague]);

  const goToOdds = useCallback(() => goToLeague(ALL_LEAGUES), [goToLeague]);

  const goToLive = useCallback(() => {
    setDetailMatchId(null); setShowLiveOnly(true); setShowResults(false);
    requestAnimationFrame(() => document.getElementById('live-section')?.scrollIntoView({ behavior: 'smooth' }));
  }, []);

  const goToResults = useCallback(() => {
    setDetailMatchId(null); setShowLiveOnly(false); setCurrentLeague(ALL_LEAGUES); setShowResults(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setCurrentLeague]);

  const openMatch = useCallback((matchId: string) => setDetailMatchId(matchId), []);

  return {
    detailMatchId, isMobileSlipOpen, showLiveOnly, showResults, currentLeague,
    setIsMobileSlipOpen, setShowLiveOnly, setShowResults,
    goBack, goToLeague, goToOdds, goToLive, goToResults, openMatch, setDetailMatchId,
    resetForLogout: useCallback(() => setDetailMatchId(null), []),
  };
}

export { PATHS };
