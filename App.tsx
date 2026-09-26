import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Navbar from './components/Navbar';
import MatchRow from './components/MatchCard';
import MatchDetail from './components/MatchDetail';
import BetSlip from './components/BetSlip';
import OwnerDashboard from './components/OwnerDashboard';
import AgentUsersPanel from './components/AgentUsersPanel';
import { withBalance } from './utils/withBalance';
import Login from './components/Login';
import CasinoHub from './components/CasinoHub';
import { User, Match, Bet, UserRole, BetSelectionItem, MatchStatus } from './types';
import * as api from './services/api';
import { albaniaDateKey, albaniaTodayKey, isSameAlbaniaDay } from './utils/albaniaTime';
import FeaturedMatchCard from './components/FeaturedMatchCard';

const App: React.FC = () => {
  // --- Auth State ---
  // Same idea as the matches cache below: seed from the last known user so
  // a refresh shows the app instantly instead of a full-screen spinner
  // gating EVERYTHING (including already-cached matches) behind a fresh
  // network round-trip to /auth/me. The real verification still runs in
  // the effect below and will log the person out if the token turns out
  // to be expired/invalid — this only skips the WAIT when we already have
  // a very-likely-valid session.
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try { return JSON.parse(localStorage.getItem('cachedUser') || 'null'); } catch { return null; }
  });
  const [authChecked, setAuthChecked] = useState(() => {
    try { return !!api.getToken() && !!localStorage.getItem('cachedUser'); } catch { return false; }
  });

  // --- Data State (from backend; matches/leagueNames seed from a
  // localStorage snapshot of the last successful fetch so returning
  // users see their matches instantly instead of the loading spinner
  // — the background refresh below then replaces this with live data) ---
  const [matches, setMatches] = useState<Match[]>(() => {
    try { return JSON.parse(localStorage.getItem('cachedMatches') || '[]'); } catch { return []; }
  });
  // League key -> the name EXACTLY as LondonPro365's own API returns it
  // (untouched — no re-slugging/re-titlecasing). Populated from every
  // /matches response; leagueLabel() below prefers this over any derived
  // fallback.
  const [leagueNames, setLeagueNames] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('cachedLeagueNames') || '{}'); } catch { return {}; }
  });
  // Same idea as leagueNames, but carrying the provider's real numeric
  // league/country IDs alongside the name -- kept as its own cached state
  // (not merged into leagueNames) so existing code that reads leagueNames
  // as Record<string,string> is untouched. Not yet driving any filtering
  // UI itself; this is the data layer other features (admin lookups,
  // exact-ID filtering) can build on without another round-trip.
  const [leagueMeta, setLeagueMeta] = useState<Record<string, api.LeagueMeta>>(() => {
    try { return JSON.parse(localStorage.getItem('cachedLeagueMeta') || '{}'); } catch { return {}; }
  });
  const [myBets, setMyBets] = useState<Bet[]>([]);
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [adminAllBets, setAdminAllBets] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<api.Favorite[]>([]);

  // --- UI State ---
  const [simulatingMatchId, setSimulatingMatchId] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  // Home stays light and shows ONLY upcoming matches — live matches are
  // fetched/rendered only once the person actively presses "Live", not
  // mixed into the home feed by default.
  const [showLiveOnly, setShowLiveOnly] = useState(false);
  const [detailMatchId, setDetailMatchId] = useState<string | null>(null);
  // GET /api/matches (the list) now only returns the 1X2/"h2h" market per
  // match to keep that payload small/fast (see server/routes/matches.js).
  // Opening a match's detail view needs ALL of its markets, so this holds
  // the one full match object fetched on demand via GET /api/matches/:id
  // (which is unchanged and still returns everything) when detailMatchId
  // is set. Kept separate from `matches` so the list's live score/status
  // WebSocket patches (below) keep working exactly as before.
  const [detailMatchFull, setDetailMatchFull] = useState<Match | null>(null);
  // Persisted like `matches`/`leagueNames` above: without this, every page
  // refresh reset the view to 'All Top Football' even though the cached
  // matches were already there, so the league someone actually wanted only
  // appeared after they clicked it again by hand.
  const [currentLeague, setCurrentLeagueState] = useState(() => {
    try { return localStorage.getItem('currentLeague') || 'All Top Football'; } catch { return 'All Top Football'; }
  });
  const setCurrentLeague = useCallback((league: string) => {
    setCurrentLeagueState(league);
    try { localStorage.setItem('currentLeague', league); } catch {}
  }, []);
  const [selectedDate, setSelectedDate] = useState('ALL'); // 'ALL' or 'YYYY-MM-DD' (local date)
  const [isLoading, setIsLoading] = useState(false);
  // Tracks whether we've EVER successfully loaded matches, across the whole
  // component lifetime — not derived from the current matches array. Using
  // matches.length===0 as the "first load" signal meant a single empty/slow
  // background refresh (a transient backend hiccup, a purge job momentarily
  // clearing rows) got misread as "first load" and re-showed the full-screen
  // spinner, wiping out matches that were already visible on screen. This
  // ref makes "have we loaded before" independent of what the last fetch
  // happened to return.
  const hasLoadedMatchesOnceRef = useRef(matches.length > 0);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Auto-retry with backoff after a failed loadMatches -- without this, a
  // failure just sits there until the next scheduled poll (every 5 min,
  // see below) or the person notices and taps "Provo Përsëri" themselves.
  // A transient backend blip (a crash-restart cycle, a DB timeout cascade)
  // should heal itself in seconds, not minutes, with nobody watching.
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentView, setCurrentView] = useState<'sports' | 'casino'>('sports');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('searchHistory') || '[]'); } catch { return []; }
  });
  const [isMobileSlipOpen, setIsMobileSlipOpen] = useState(false);
  const [isLeagueMenuOpen, setIsLeagueMenuOpen] = useState(false);
  const [selections, setSelections] = useState<BetSelectionItem[]>([]);
  const [betError, setBetError] = useState<string | null>(null);

  // --- Restore session on load (JWT in localStorage, verified against backend) ---
  useEffect(() => {
    (async () => {
      const user = await api.fetchCurrentUser();
      setCurrentUser(user);
      setAuthChecked(true);
    })();
  }, []);

  // Keep the optimistic cache above in sync with whatever currentUser
  // actually is (login, logout, balance updates, or the background
  // verification above correcting/clearing a stale session).
  useEffect(() => {
    try {
      if (currentUser) localStorage.setItem('cachedUser', JSON.stringify(currentUser));
      else localStorage.removeItem('cachedUser');
    } catch {}
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) { setFavorites([]); return; }
    (async () => {
      try {
        const { favorites: f } = await api.getFavorites();
        setFavorites(f);
      } catch (e) {
        console.error('Failed to load favorites', e);
      }
    })();
  }, [currentUser]);

  const favoriteTeams = useMemo(() => new Set(favorites.filter(f => f.type === 'TEAM').map(f => f.value)), [favorites]);
  const favoriteLeagues = useMemo(() => new Set(favorites.filter(f => f.type === 'LEAGUE').map(f => f.value)), [favorites]);

  const toggleFavorite = useCallback(async (type: 'TEAM' | 'LEAGUE', value: string) => {
    // Optimistic: flip the star and update the count immediately on click —
    // don't make the user wait a full round-trip to see it react. Reconcile
    // with the server's response right after, and roll back to the exact
    // previous state if the request fails, instead of leaving the UI out of
    // sync with a silent console.error as the only trace.
    let previous: api.Favorite[] = [];
    setFavorites((current) => {
      previous = current;
      const alreadyFavorited = current.some((f) => f.type === type && f.value === value);
      return alreadyFavorited
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

  // --- Load matches from the real backend ---
  // Fetch the FULL set (no league filter) so the LIVE section can show live
  // matches from any league, and the league sidebar has the complete list.
  // All filtering (live / league / search) happens client-side below.
  const loadMatches = useCallback(async () => {
    if (!currentUser || currentView !== 'sports') return;
    setIsLoading((prev) => (hasLoadedMatchesOnceRef.current ? prev : true));
    try {
      const { matches: fresh, leagueNames: freshLeagueNames, leagueMeta: freshLeagueMeta } = await api.fetchMatches();
      setMatches(fresh);
      try { localStorage.setItem('cachedMatches', JSON.stringify(fresh)); } catch {}
      if (freshLeagueNames) {
        setLeagueNames((prev) => {
          const next = { ...prev, ...freshLeagueNames };
          try { localStorage.setItem('cachedLeagueNames', JSON.stringify(next)); } catch {}
          return next;
        });
      }
      if (freshLeagueMeta) {
        setLeagueMeta((prev) => {
          const next = { ...prev, ...freshLeagueMeta };
          try { localStorage.setItem('cachedLeagueMeta', JSON.stringify(next)); } catch {}
          return next;
        });
      }
      setLoadError(null);
      hasLoadedMatchesOnceRef.current = true;
      retryAttemptRef.current = 0;
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    } catch (e) {
      console.error('Failed to load matches', e);
      setLoadError('S\'arritëm të lidhemi me serverin. Kontrollo internetin dhe provo përsëri.');
      // Backoff: 10s, 20s, 40s, capped at 60s -- fast enough to ride out a
      // crash-restart cycle or a DB timeout cascade unattended, capped so
      // a genuinely long outage doesn't hammer the server every few
      // seconds forever.
      const attempt = retryAttemptRef.current;
      const delayMs = Math.min(10000 * 2 ** attempt, 60000);
      retryAttemptRef.current = attempt + 1;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => { loadMatchesRef.current(); }, delayMs);
    } finally {
      setIsLoading(false);
    }
  }, [currentUser, currentView]);

  // The retry timeout above schedules a call to the NEXT loadMatches it
  // gets (via this ref) rather than closing over the one from this render,
  // since useCallback's identity can change between when the timer is set
  // and when it fires.
  const loadMatchesRef = useRef(loadMatches);
  useEffect(() => { loadMatchesRef.current = loadMatches; }, [loadMatches]);

  useEffect(() => {
    return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); };
  }, []);


  useEffect(() => {
    loadMatches();
    // Was 60s. WebSocket (below) already pushes odds/score/live-tick
    // updates in real time, so this REST re-fetch of the *entire* matches
    // list is now only a slow safety net for the rare missed/dropped
    // socket message — not the primary update path. Every client re-
    // downloading the full match list every 60s was the single biggest
    // driver of Render's 5GB/month bandwidth cap, multiplied by however
    // many people had the page open.
    const interval = setInterval(loadMatches, 5 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, currentView]);

  // Applies an ODDS_CHANGED payload's per-selection price updates to one
  // match's markets array, returning the SAME array reference if nothing
  // in it was actually touched (so callers can skip re-rendering that
  // match). Shared by the list (`matches`, h2h-only) and, below, whichever
  // match's full markets are currently loaded for the open detail view —
  // both need the identical patch, just against different state.
  const patchMarketsOdds = useCallback((markets: Match['markets'], changes: { marketId: string; selectionId: string; newOdds?: number }[]) => {
    let touched = false;
    const next = markets.map((mk) => {
      const relevant = changes.filter((c) => c.marketId === mk.id);
      if (!relevant.length) return mk;
      let mkTouched = false;
      const options = mk.options.map((opt) => {
        const c = relevant.find((c) => c.selectionId === opt.id);
        if (!c || typeof c.newOdds !== 'number') return opt;
        mkTouched = true;
        return { ...opt, odds: c.newOdds };
      });
      if (mkTouched) touched = true;
      return mkTouched ? { ...mk, options } : mk;
    });
    return touched ? next : markets;
  }, []);

  // --- Real-time source events (WebSocket) ---
  // Auto-reconnects with exponential backoff on drop instead of going
  // permanently silent — the 30s poll above is only a slow fallback, not
  // a substitute for live updates.
  const [wsConnected, setWsConnected] = useState(false);
  useEffect(() => {
    if (!currentUser || currentView !== 'sports') return;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let cancelled = false;

    const connect = () => {
      socket = new WebSocket(api.getWsUrl());
      socket.onopen = () => {
        attempt = 0;
        setWsConnected(true);
        const token = api.getToken();
        if (token) socket!.send(JSON.stringify({ type: 'auth', token }));
        socket!.send(JSON.stringify({ type: 'subscribe', topic: 'live' }));
        socket!.send(JSON.stringify({ type: 'subscribe', topic: 'odds' }));
      };
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (!msg.matchId) return;
          if (msg.type === 'GOAL') {
            setMatches((current) => current.map((m) => m.id === msg.matchId ? {
              ...m,
              status: MatchStatus.LIVE,
              isLive: true,
              liveHomeScore: msg.homeScore ?? m.liveHomeScore,
              liveAwayScore: msg.awayScore ?? m.liveAwayScore,
              currentMinute: msg.minute ?? m.currentMinute,
            } : m));
          } else if (msg.type === 'GOAL_DISALLOWED') {
            // A goal that was already shown got retracted (VAR overturn /
            // provider correction) — apply the corrected (lower) score the
            // same way GOAL applies a new one, just without implying anyone
            // scored. Without this, the frontend had no way to walk a goal
            // back at all: the old code treated every score change as a new
            // goal, so a disallowed goal showed up as a fabricated goal for
            // the WRONG team (see server/london365.js recordGoalIfChanged).
            setMatches((current) => current.map((m) => m.id === msg.matchId ? {
              ...m,
              liveHomeScore: msg.homeScore ?? m.liveHomeScore,
              liveAwayScore: msg.awayScore ?? m.liveAwayScore,
              currentMinute: msg.minute ?? m.currentMinute,
            } : m));
          } else if (msg.type === 'LIVE_TICK') {
            // Fast (~1/sec) resync from the gamedetails feed: keeps the
            // score/minute already shown in sync with the provider without
            // waiting for a goal or the slow 60s match-list poll. No full
            // reload — this only ever carries fields already verified on
            // the server (see server/london365GameDetails.js), so it's
            // safe/cheap to apply directly to local state every time.
            setMatches((current) => current.map((m) => m.id === msg.matchId ? {
              ...m,
              liveHomeScore: msg.homeScore ?? m.liveHomeScore,
              liveAwayScore: msg.awayScore ?? m.liveAwayScore,
              currentMinute: msg.minute ?? m.currentMinute,
            } : m));
          } else if (msg.type === 'CARD') {
            // A card changes nothing the LIST carries (score, minute, h2h
            // odds), so re-downloading and re-computing the whole /api/matches
            // list -- for every connected client, on every card in every
            // live match -- only defeated the server's 8s response cache and
            // hit the database. The open match detail view still refreshes
            // its own events on CARD (see MatchDetail.tsx).
          } else if (msg.type === 'LIVE_EVENT') {
            loadMatches();
          } else if (msg.type === 'MATCH_STARTED') {
            setMatches((current) => current.map((m) => m.id === msg.matchId ? { ...m, status: MatchStatus.LIVE, isLive: true } : m));
            loadMatches();
          } else if (msg.type === 'MATCH_ENDED') {
            // Without this, a match that just finished stayed in the "Live"
            // list — frozen at its last score — until the next slow REST
            // poll (widened to 5 min for bandwidth) caught up. Apply the
            // final score and flip status immediately so it drops out of
            // any Live-only view right away instead of minutes later.
            setMatches((current) => current.map((m) => m.id === msg.matchId ? {
              ...m,
              status: MatchStatus.FINISHED,
              isLive: false,
              liveHomeScore: msg.homeScore ?? m.liveHomeScore,
              liveAwayScore: msg.awayScore ?? m.liveAwayScore,
            } : m));
          } else if (msg.type === 'ODDS_CHANGED') {
            // Was calling loadMatches() here -- a FULL /api/matches reload
            // on every single price move, anywhere in the whole list. Odds
            // move constantly (many matches, many markets, every few
            // seconds), so this was firing very often, and worse: a fresh
            // JSON response replaces EVERY match object with a new
            // reference, defeating React.memo on MatchRow for the ENTIRE
            // list (not just the one match whose price moved) — every row
            // re-rendered on every price tick anywhere. On a phone with a
            // long visible list this is exactly the kind of thing that
            // shows up as scroll jank / the whole screen feeling laggy.
            // msg.changes carries {marketId, selectionId, newOdds} per
            // outcome that actually moved (see diffOddsChanges), and those
            // ids are built the identical way on both sides
            // (`${matchId}-${marketKey}` / outcomeId) — so we can patch
            // just the affected option's price in place instead.
            const changes: { marketId: string; selectionId: string; newOdds?: number }[] = Array.isArray(msg.changes) ? msg.changes : [];
            if (changes.length) {
              setMatches((current) => current.map((m) => {
                if (m.id !== msg.matchId) return m;
                const markets = patchMarketsOdds(m.markets, changes);
                return markets === m.markets ? m : { ...m, markets };
              }));
              // The list above only ever carries the h2h market, so this
              // patch will only actually change something there when the
              // move was in h2h. Mirror the same patch onto the full
              // markets fetched for whichever match's detail view is
              // currently open (see detailMatchFull above) so odds moving
              // in OTHER markets (correct score, handicaps, etc.) still
              // update live while someone's looking at that match, exactly
              // like before this match's full markets lived in `matches`.
              setDetailMatchFull((current) => {
                if (!current || current.id !== msg.matchId) return current;
                const markets = patchMarketsOdds(current.markets, changes);
                return markets === current.markets ? current : { ...current, markets };
              });
            }
          }
        } catch { /* ignore malformed socket messages */ }
      };
      socket.onclose = () => {
        setWsConnected(false);
        if (cancelled) return;
        // Exponential backoff: 1s, 2s, 4s, 8s... capped at 30s.
        const delay = Math.min(30000, 1000 * 2 ** attempt);
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [currentUser, currentView, loadMatches]);

  // --- Load my bets ---
  const loadMyBets = useCallback(async () => {
    if (!currentUser) return;
    try {
      const bets = await api.fetchMyBets();
      setMyBets(bets);
    } catch (e) {
      console.error('Failed to load bets', e);
    }
  }, [currentUser]);

  useEffect(() => { loadMyBets(); }, [loadMyBets]);

  // --- Load admin data when panel is open ---
  const loadAdminData = useCallback(async () => {
    if (!currentUser || currentUser.role !== UserRole.ADMIN) return;
    try {
      const [users, bets] = await Promise.all([api.adminFetchUsers(), api.adminFetchAllBets()]);
      setAdminUsers(users);
      setAdminAllBets(bets);
    } catch (e) {
      console.error('Failed to load admin data', e);
    }
  }, [currentUser]);

  // Owner/Admin data loads as soon as they log in (not gated on the old
  // showAdmin overlay toggle anymore) so the new standalone OwnerDashboard
  // page below has data immediately, with no play-first flash.
  useEffect(() => { if (showAdmin || currentUser?.role === UserRole.ADMIN) loadAdminData(); }, [showAdmin, currentUser, loadAdminData]);

  // Admin Panel: close on click-outside. adminPanelRef wraps only the
  // <main> content area where AdminPanel renders, so a click on the Admin
  // button itself, the navbar, or the sidebars doesn't get double-handled —
  // it's excluded via the ref check plus a dedicated data attribute on the
  // Admin toggle button (which has its own onClick that would otherwise
  // immediately reopen what this just closed).
  const adminPanelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!showAdmin) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (adminPanelRef.current && !adminPanelRef.current.contains(target) && !target.closest('[data-admin-toggle]')) {
        setShowAdmin(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAdmin]);

  // --- Date picker helpers (bet365-style: Sot / Nesër / next few days) ---
  // Always compare using Albania's calendar date (Europe/Tirane), not the
  // visitor's device timezone, so "today" is correct for the target audience.
  const dateOptions = useMemo(() => {
    const dayNames = ['Die', 'Hën', 'Mar', 'Mër', 'Enj', 'Pre', 'Sht'];
    const monthNames = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gus', 'Sht', 'Tet', 'Nën', 'Dhj'];
    const opts: { value: string; label: string }[] = [{ value: 'ALL', label: 'Të gjitha' }];
    for (let i = 0; i < 7; i++) {
      const value = albaniaTodayKey(i);
      const d = new Date(value + 'T12:00:00'); // noon avoids any DST-edge day-shift when re-deriving weekday/day/month
      const label = i === 0 ? 'Sot' : i === 1 ? 'Nesër' : `${dayNames[d.getDay()]} ${d.getDate()} ${monthNames[d.getMonth()]}`;
      opts.push({ value, label });
    }
    return opts;
  }, []);

  // Etiketa e një date-kalendarike (YYYY-MM-DD, sipas kohës së Shqipërisë)
  // e përdorur si ndarës brenda çdo lige, kështu që kur një ligë nuk ka
  // ndeshje sot, ndeshjet e ditëve të tjera shfaqen me datën e tyre.
  const SQ_DAY_NAMES = ['Die', 'Hën', 'Mar', 'Mër', 'Enj', 'Pre', 'Sht'];
  const SQ_MONTH_NAMES = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gus', 'Sht', 'Tet', 'Nën', 'Dhj'];
  const dateKeyLabel = (key: string): string => {
    if (key === albaniaTodayKey(0)) return 'Sot';
    if (key === albaniaTodayKey(1)) return 'Nesër';
    const d = new Date(key + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return key;
    return `${SQ_DAY_NAMES[d.getDay()]} ${d.getDate()} ${SQ_MONTH_NAMES[d.getMonth()]}`;
  };
  const groupMatchesByDate = (list: Match[]): [string, Match[]][] => {
    const byDate = new Map<string, Match[]>();
    for (const m of list) {
      const key = albaniaDateKey(m.startTime);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(m);
    }
    return Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  };

  // --- Filtering ---
  // Search applies everywhere. LIVE is always its own section at the top
  // (like a real bookmaker site), not a toggle that hides everything else.
  const searchFiltered = matches.filter((m) => {
    const q = searchQuery.toLowerCase();
    return m.homeTeam.toLowerCase().includes(q) || m.awayTeam.toLowerCase().includes(q) || m.league.toLowerCase().includes(q);
  });

  const commitSearchHistory = useCallback((term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    setSearchHistory((prev) => {
      const next = [trimmed, ...prev.filter((t) => t.toLowerCase() !== trimmed.toLowerCase())].slice(0, 8);
      try { localStorage.setItem('searchHistory', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const STALE_LIVE_MS = 6 * 60 * 60 * 1000; // matches don't last 6h — treat as stuck/stale if never settled
  const liveMatches = searchFiltered
    .filter((m) => m.status === MatchStatus.LIVE && (Date.now() - new Date(m.startTime).getTime()) < STALE_LIVE_MS)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  // `upcomingMatches` llogaritet më poshtë (pas leagueCountry/filtrave të
  // shtetit), sepse filtri i shtetit ka nevojë për leagueCountry() dhe sepse
  // duhet edhe lista PA filtrin e datës, për fallback-un "nuk ka ndeshje sot".

  // Raw sport_keys (e.g. "soccer_brazil_campeonato") are what we store/compare
  // internally, but users should see readable names. This maps known keys to
  // Albanian display labels; anything unmapped falls back to a prettified
  // version of the key so a new/unexpected league never shows the raw slug.
  const LEAGUE_LABELS: Record<string, string> = {
    'soccer_epl': 'Premier League',
    'soccer_spain_la_liga': 'La Liga',
    'soccer_italy_serie_a': 'Serie A',
    'soccer_germany_bundesliga': 'Bundesliga',
    'soccer_france_ligue_one': 'Ligue 1',
    'soccer_uefa_champs_league': 'UEFA Champions League',
    'soccer_uefa_champs_league_qualification': 'UEFA Champions League - Kualifikuese',
    'soccer_uefa_europa_league': 'UEFA Europa League',
    'soccer_uefa_europa_conference_league': 'UEFA Conference League',
    'soccer_fifa_world_cup': 'Kampionati Botëror',
    'soccer_fifa_world_cup_qualifiers_europe': 'Kualifikueset Botërore - Evropa',
    'soccer_usa_mls': 'MLS',
    'soccer_brazil_campeonato': 'Serie A',
    'oddsapiio_albania_superiore': 'Kategoria Superiore',
  };
  const leagueLabel = (key: string) =>
    key === 'All Top Football'
      ? 'Të Gjitha Kampionatet'
      : leagueNames[key] || LEAGUE_LABELS[key] ||
        // Only reached when we have no raw name for this key at all (e.g. a
        // league not seen since the last server restart). Strip
        // "<provider>_<country>__" so the row doesn't redundantly repeat
        // the country name that's already shown in the group header above it
        // (e.g. "l365_brazil__amazonense_serie_b" -> "Amazonense Serie B",
        // not "Brazil Amazonense Serie B").
        key.replace(/^(soccer|l365)_[a-z0-9-]+__/, '').replace(/^(soccer|l365)_/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());

  // Within a country, most people only care about the flagship top-flight
  // league (and, for "Ndërkombëtare", the big UEFA competitions) — everything
  // else (development leagues, reserve/U19 sides, obscure cups) is noise
  // they'd rather find themselves by opening the country/league picker. So
  // the flagship leagues sort first; everything else falls back to
  // alphabetical, exactly as before.
  const FLAGSHIP_LEAGUE_NAMES = [
    'premier league', 'laliga', 'la liga', 'serie a', 'bundesliga', 'ligue 1',
    'primeira liga', 'eredivisie', 'jupiler pro league', 'super lig',
    'uefa champions league', 'champions league',
    'uefa europa league', 'europa league',
    'uefa europa conference league', 'conference league',
    'uefa nations league',
  ];
  const leagueImportanceRank = (key: string) => {
    const label = leagueLabel(key).toLowerCase();
    const idx = FLAGSHIP_LEAGUE_NAMES.findIndex((name) => label === name || label.includes(name));
    return idx === -1 ? 999 : idx;
  };
  const byLeagueImportance = (a: string, b: string) => {
    const ra = leagueImportanceRank(a), rb = leagueImportanceRank(b);
    return ra !== rb ? ra - rb : leagueLabel(a).localeCompare(leagueLabel(b));
  };

  // Autocomplete suggestions — split into teams / leagues / direct match
  // hits so the dropdown can show each kind separately, instant (no
  // network call, just filtering data already loaded).
  const searchSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return { teams: [] as string[], leagues: [] as string[], matches: [] as Match[] };

    const teamSet = new Set<string>();
    matches.forEach((m) => {
      if (m.homeTeam.toLowerCase().includes(q)) teamSet.add(m.homeTeam);
      if (m.awayTeam.toLowerCase().includes(q)) teamSet.add(m.awayTeam);
    });
    const leagueSet = new Set<string>();
    matches.forEach((m) => {
      if (leagueLabel(m.league).toLowerCase().includes(q)) leagueSet.add(m.league);
    });
    const directMatches = matches.filter((m) => m.homeTeam.toLowerCase().includes(q) || m.awayTeam.toLowerCase().includes(q)).slice(0, 5);

    return { teams: Array.from(teamSet).slice(0, 5), leagues: Array.from(leagueSet).slice(0, 5), matches: directMatches };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, matches]);

  // Sport keys generally follow "<provider>_<country>_<league>" (e.g.
  // "soccer_spain_la_liga"). We use that country token to group leagues by
  // country in the sidebar, so browsing e.g. Spain shows only Spain's
  // leagues underneath it — with continental/international competitions
  // (Champions League, Europa League, World Cup, qualifiers, etc.) pulled
  // into their own "Ndërkombëtare" group instead of being mixed into
  // whichever country happens to sort next to them.
  const COUNTRY_TOKEN_LABELS: Record<string, string> = {
    epl: 'Anglia', england: 'Anglia', spain: 'Spanja', italy: 'Italia', germany: 'Gjermania',
    france: 'Franca', usa: 'SHBA', brazil: 'Brazil', argentina: 'Argjentinë', portugal: 'Portugali',
    netherlands: 'Holandë', belgium: 'Belgjikë', turkey: 'Turqi', greece: 'Greqi', scotland: 'Skoci',
    switzerland: 'Zvicër', austria: 'Austri', denmark: 'Danimarkë', sweden: 'Suedi', norway: 'Norvegji',
    russia: 'Rusi', poland: 'Poloni', mexico: 'Meksikë', japan: 'Japoni', korea: 'Korea e Jugut',
    china: 'Kinë', australia: 'Australi', chile: 'Kili', colombia: 'Kolumbi', albania: 'Shqipëri',
    croatia: 'Kroaci', serbia: 'Serbi', romania: 'Rumani', ukraine: 'Ukrainë', saudi: 'Arabia Saudite',
    kosovo: 'Kosovë',
    // Extended list so far more countries get a proper Albanian label
    // (and flag, via COUNTRY_TOKEN_ISO below) instead of falling back to a
    // raw title-cased English name.
    iceland: 'Islandë', hungary: 'Hungari', 'czech-republic': 'Republika Çeke', finland: 'Finlandë',
    peru: 'Peru', slovakia: 'Sllovaki', slovenia: 'Slloveni', ireland: 'Irlandë', uruguay: 'Uruguai',
    israel: 'Izrael', bulgaria: 'Bullgari', malaysia: 'Malajzi', belarus: 'Bjellorusi', estonia: 'Estoni',
    'northern-ireland': 'Irlanda e Veriut', wales: 'Uells', malta: 'Maltë',
    'bosnia-herzegovina': 'Bosnjë dhe Hercegovinë', lithuania: 'Lituani', latvia: 'Letoni',
    ecuador: 'Ekuador', luxembourg: 'Luksemburg', 'faroe-islands': 'Ishujt Faroe', georgia: 'Gjeorgji',
    'costa-rica': 'Kosta Rika', 'republic-of-korea': 'Korea e Jugut', armenia: 'Armeni',
    azerbaijan: 'Azerbajxhan', 'united-arab-emirates': 'Emiratet e Bashkuara Arabe', algeria: 'Algjeri',
    egypt: 'Egjipt', 'south-africa': 'Afrika e Jugut', jordan: 'Jordani', kuwait: 'Kuvajt',
    'hong-kong': 'Hong Kongu', 'hong-kong-china': 'Hong Kongu', bahrain: 'Bahrein', qatar: 'Katar', guatemala: 'Guatemalë',
    vietnam: 'Vietnam', 'el-salvador': 'El Salvador', indonesia: 'Indonezi', andorra: 'Andorë',
    bolivia: 'Bolivi', uzbekistan: 'Uzbekistan', montenegro: 'Mali i Zi', 'san-marino': 'San Marino',
    canada: 'Kanada', nicaragua: 'Nikaragua', honduras: 'Honduras', thailand: 'Tajlandë',
    iraq: 'Irak', panama: 'Panama', tanzania: 'Tanzani', botswana: 'Botsvanë', zimbabwe: 'Zimbabve',
    uganda: 'Ugandë', paraguay: 'Paraguai', venezuela: 'Venezuelë', kazakhstan: 'Kazakistan',
    moldova: 'Moldavi', cyprus: 'Qipro', 'northern-cyprus': 'Qipro Veriore',
    india: 'Indi', myanmar: 'Mianmar', nigeria: 'Nigeri', ghana: 'Ganë', kenya: 'Kenia',
    morocco: 'Marok', tunisia: 'Tunizi', iran: 'Iran',
    // Tokens që vijnë nga provider-a të tjerë (api-football etc.) ose në
    // formë pa vizë — pa këto, shtete reale përfundonin te "Të tjera".
    southkorea: 'Korea e Jugut', 'south-korea': 'Korea e Jugut', 'united-states': 'SHBA',
    holland: 'Holandë', czech: 'Republika Çeke', 'saudi-arabia': 'Arabia Saudite',
    'new-zealand': 'Zelanda e Re', singapore: 'Singapor', philippines: 'Filipine',
    lebanon: 'Liban', syria: 'Siri', libya: 'Libi', sudan: 'Sudan', senegal: 'Senegal',
    cameroon: 'Kamerun', 'ivory-coast': 'Bregu i Fildishtë', zambia: 'Zambi',
    mozambique: 'Mozambik', angola: 'Angolë', ethiopia: 'Etiopi', rwanda: 'Ruandë',
    gibraltar: 'Gjibraltar', liechtenstein: 'Lihtenshtajn', macedonia: 'Maqedoni',
    'north-macedonia': 'Maqedonia e Veriut', tajikistan: 'Taxhikistan',
    turkmenistan: 'Turkmenistan', kyrgyzstan: 'Kirgistan', mongolia: 'Mongoli',
    nepal: 'Nepal', bangladesh: 'Bangladesh', pakistan: 'Pakistan', 'sri-lanka': 'Shri Lanka',
    jamaica: 'Xhamajkë', 'dominican-republic': 'Republika Dominikane', cuba: 'Kubë',
    haiti: 'Haiti', belize: 'Belize', suriname: 'Surinam', 'puerto-rico': 'Porto Riko',
  };
  // ISO 3166-1 alpha-2 code per country token -> converted to a flag emoji
  // via regional indicator symbols. This is a clean, deterministic mapping
  // (country token -> ISO code -> flag) rather than one icon reused for
  // every country, and needs no image assets/network calls.
  const COUNTRY_TOKEN_ISO: Record<string, string> = {
    epl: 'GB', england: 'GB', spain: 'ES', italy: 'IT', germany: 'DE',
    france: 'FR', usa: 'US', brazil: 'BR', argentina: 'AR', portugal: 'PT',
    netherlands: 'NL', belgium: 'BE', turkey: 'TR', greece: 'GR', scotland: 'GB',
    switzerland: 'CH', austria: 'AT', denmark: 'DK', sweden: 'SE', norway: 'NO',
    russia: 'RU', poland: 'PL', mexico: 'MX', japan: 'JP', korea: 'KR',
    china: 'CN', australia: 'AU', chile: 'CL', colombia: 'CO', albania: 'AL',
    croatia: 'HR', serbia: 'RS', romania: 'RO', ukraine: 'UA', saudi: 'SA',
    kosovo: 'XK',
    iceland: 'IS', hungary: 'HU', 'czech-republic': 'CZ', finland: 'FI', peru: 'PE',
    slovakia: 'SK', slovenia: 'SI', ireland: 'IE', uruguay: 'UY', israel: 'IL',
    bulgaria: 'BG', malaysia: 'MY', belarus: 'BY', estonia: 'EE', 'northern-ireland': 'GB',
    wales: 'GB', malta: 'MT', 'bosnia-herzegovina': 'BA', lithuania: 'LT', latvia: 'LV',
    ecuador: 'EC', luxembourg: 'LU', 'faroe-islands': 'FO', georgia: 'GE', 'costa-rica': 'CR',
    armenia: 'AM', azerbaijan: 'AZ', 'united-arab-emirates': 'AE', algeria: 'DZ', egypt: 'EG',
    'south-africa': 'ZA', jordan: 'JO', kuwait: 'KW', 'hong-kong': 'HK', 'hong-kong-china': 'HK', bahrain: 'BH',
    qatar: 'QA', guatemala: 'GT', vietnam: 'VN', 'el-salvador': 'SV', indonesia: 'ID',
    andorra: 'AD', bolivia: 'BO', uzbekistan: 'UZ', montenegro: 'ME', 'san-marino': 'SM',
    canada: 'CA', nicaragua: 'NI', honduras: 'HN', thailand: 'TH', iraq: 'IQ', panama: 'PA',
    tanzania: 'TZ', botswana: 'BW', zimbabwe: 'ZW', uganda: 'UG', paraguay: 'PY',
    venezuela: 'VE', kazakhstan: 'KZ', moldova: 'MD', cyprus: 'CY', 'northern-cyprus': 'CY',
    india: 'IN', myanmar: 'MM', nigeria: 'NG', ghana: 'GH', kenya: 'KE', morocco: 'MA',
    tunisia: 'TN', iran: 'IR',
    southkorea: 'KR', 'south-korea': 'KR', 'united-states': 'US', holland: 'NL',
    czech: 'CZ', 'saudi-arabia': 'SA', 'new-zealand': 'NZ', singapore: 'SG',
    philippines: 'PH', lebanon: 'LB', syria: 'SY', libya: 'LY', sudan: 'SD',
    senegal: 'SN', cameroon: 'CM', 'ivory-coast': 'CI', zambia: 'ZM',
    mozambique: 'MZ', angola: 'AO', ethiopia: 'ET', rwanda: 'RW', gibraltar: 'GI',
    liechtenstein: 'LI', macedonia: 'MK', 'north-macedonia': 'MK', tajikistan: 'TJ',
    turkmenistan: 'TM', kyrgyzstan: 'KG', mongolia: 'MN', nepal: 'NP',
    bangladesh: 'BD', pakistan: 'PK', 'sri-lanka': 'LK', jamaica: 'JM',
    'dominican-republic': 'DO', cuba: 'CU', haiti: 'HT', belize: 'BZ',
    suriname: 'SR', 'puerto-rico': 'PR',
  };
  const isoToFlagEmoji = (iso: string): string =>
    iso.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
  const INTERNATIONAL_TOKENS = new Set(['uefa', 'fifa', 'conmebol', 'concacaf', 'afc', 'caf', 'international']);

  // Normalizon emrin e liges per klasifikim: heq aksentet ("Turkiye" ->
  // "turkiye"), zevendeson cdo shenje jo-alfanumerike (perfshire mojibake si
  // "T??Rkiye" ose "Women???S") me hapesire, dhe kthen shkronja te vogla.
  const normalizeLeagueName = (s: string): string =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  // Harta "emer i lexueshem -> token shteti". Shumica e providerve dergojne
  // ligat si emra ("Spain La Liga", "Brasileiro Serie B", "M15 Madrid",
  // "AFC U20 Asian Cup Qualification") — pa kete harte ato binin te gjitha
  // te "Të tjera". Rendi i kontrollit:
  //  1) emri i shtetit (ose fjale qe i perkasin vetem atij: "brasileiro",
  //     "ekstraklasa", "allsvenskan", qytetet e turnireve M15/W15/Challenger),
  //  2) kompeticione kombetare pa emer shteti ne rresht ("Premier League",
  //     "Serie A/B/C"...),
  //  3) kompeticione nderkombetare (UEFA/FIFA/AFC/ASEAN/FIBA/World Cup/
  //     Friendlies) -> grupi "Ndërkombëtare",
  //  4) asgje -> "Të tjera".
  const NAME_TOKEN_PATTERNS: [RegExp, string][] = [
    // --- 1) Emra shtetesh + fjale unike kombetare + qytete turnish ---
    [/algeria/, 'algeria'],
    [/argentina/, 'argentina'],
    [/armenia/, 'armenia'],
    [/australia|new south wales|npl queensland|sa premier league/, 'australia'],
    [/azerbaijan/, 'azerbaijan'],
    [/belgium|belgian/, 'belgium'],
    [/brazil|brasileiro|copa do brasil|paulista|pernambucano|cearense|goias|amazonense|campeonato brasileiro/, 'brazil'],
    [/bulgaria|plovdiv/, 'bulgaria'],
    [/chile/, 'chile'],
    [/china|zhangjiagang|cba/, 'china'],
    [/colombia/, 'colombia'],
    [/cyprus/, 'cyprus'],
    [/denmark|superligaen/, 'denmark'],
    [/ecuador|ligapro/, 'ecuador'],
    [/egypt|hurghada/, 'egypt'],
    [/england/, 'england'],
    [/estonia|esiliiga/, 'estonia'],
    [/finland|kakkonen|kolmonen/, 'finland'],
    [/france|ligue 1|ligue 2|ligue 3|coupe de france|cap d agde/, 'france'],
    [/georgia/, 'georgia'],
    [/germany|bundesliga|meerbusch|dfb/, 'germany'],
    [/greece/, 'greece'],
    [/hungary|nb i|nb ii|pecs|magyar/, 'hungary'],
    [/iceland/, 'iceland'],
    [/india|mizoram|shillong|sikkim/, 'india'],
    [/indonesia/, 'indonesia'],
    [/iraq/, 'iraq'],
    [/israel|liga alef|liga bet|liga leumit/, 'israel'],
    [/italy|coppa italia|primavera|fiano romano/, 'italy'],
    [/japan/, 'japan'],
    [/jordan/, 'jordan'],
    [/latvia/, 'latvia'],
    [/lithuania|a lyga/, 'lithuania'],
    [/malaysia/, 'malaysia'],
    [/mozambique|mocambola/, 'mozambique'],
    [/myanmar/, 'myanmar'],
    [/netherlands|eredivisie|dutch|holland/, 'netherlands'],
    [/paraguay/, 'paraguay'],
    [/poland|ekstraklasa|iv liga|puchar|szczawno|grodzisk/, 'poland'],
    [/portugal|porto/, 'portugal'],
    [/qatar/, 'qatar'],
    [/romania|buzau|brasov/, 'romania'],
    [/saudi/, 'saudi'],
    [/scotland/, 'scotland'],
    [/serbia|kursumlijska/, 'serbia'],
    [/slovenia/, 'slovenia'],
    [/spain|la liga|laliga|madrid|badalona|copa del rey/, 'spain'],
    [/sweden|allsvenskan/, 'sweden'],
    [/switzerland/, 'switzerland'],
    [/turkey|turkiye|rkiye|tff|super lig/, 'turkey'],
    [/uganda/, 'uganda'],
    [/ukraine/, 'ukraine'],
    [/uruguay/, 'uruguay'],
    [/\busa\b|united states|us open|major league soccer|\bmls\b/, 'usa'],
    [/uzbekistan/, 'uzbekistan'],
    [/vietnam/, 'vietnam'],
    [/wales/, 'wales'],
    [/tanzania|zanzibar/, 'tanzania'],
    [/thailand|nonthaburi/, 'thailand'],
    [/tunisia|monastir/, 'tunisia'],
    [/morocco|casablanca/, 'morocco'],
    [/bahrain/, 'bahrain'],
    [/hong kong/, 'hong-kong-china'],
    // --- 3) Nderkombetare (kontrollohen PARA kompeticioneve kombetare "te
    //     zhveshura" me poshte, sepse "ASEAN Championship Qualifying" perben
    //     fjalen "championship" dhe do perputhej gabimisht me Anglinë nese ky
    //     kontroll do vinte pas — nje kompeticion nderkombetar/rajonal duhet
    //     te fitoje mbi nje fjale te pergjithshme si "championship"/"premier
    //     league" qe shume vende e perdorin per ligen e tyre kombetare.) ---
    [/afc|asian cup|asean|fiba|world cup|world club|club friendlies|europe friendlies|women.{0,4}s friendly|uefa|champions league|europa league|conference league|nations league|intercontinental/, 'international'],
    // --- 2) Kompeticione kombetare pa emer shteti ne rresht ---
    [/premier league|championship|fa cup|efl|league one|league two|development league/, 'england'],
    [/serie a|serie b|serie c/, 'italy'],
    [/segunda division|primera division/, 'spain'],
    [/bundesliga|dfb pokal|regionalliga/, 'germany'],
    [/knvb/, 'netherlands'],
    [/pro league|first division/, 'belgium'],
    [/hnl/, 'croatia'],
    [/superettan/, 'sweden'],
    [/eliteserien/, 'norway'],
    [/veikkausliiga/, 'finland'],
    [/meistriliiga/, 'estonia'],
    [/virsliga/, 'latvia'],
    [/kategoria superiore/, 'albania'],
    [/sleague/, 'singapore'],
    [/prva liga|druga liga|superliga/, 'serbia'],
  ];

  const leagueCountryToken = (key: string): string | null => {
    if (key === 'soccer_epl') return 'epl';
    if (key === 'oddsapiio_albania_superiore') return 'albania';
    // New LondonPro365 format: l365_<country-slug>__<competition-slug> — the
    // DOUBLE underscore is the unambiguous boundary, so a multi-word
    // country (e.g. "costa-rica", "hong-kong-china") comes through intact
    // instead of being cut down to its first word.
    const dbl = key.match(/^[a-z0-9]+_([a-z0-9-]+)__/)?.[1];
    if (dbl) return dbl;
    // Legacy single-underscore format (older cached rows / other providers).
    const legacy = key.match(/^[a-z0-9]+_([a-z]+)_/)?.[1];
    if (legacy) return legacy;
    // Emra te lexueshem ("Spain La Liga", "M15 Madrid", "Brasileiro Serie B",
    // "AFC U20 Asian Cup Qualification") — klasifikohen sipas hartes me lart.
    const norm = normalizeLeagueName(key);
    const hit = NAME_TOKEN_PATTERNS.find(([re]) => re.test(norm));
    return hit ? hit[1] : null;
  };
  const leagueCountry = (key: string): string => {
    const token = leagueCountryToken(key);
    if (!token || token === 'other') return 'Të tjera';
    if (INTERNATIONAL_TOKENS.has(token)) return 'Ndërkombëtare';
    if (COUNTRY_TOKEN_LABELS[token]) return COUNTRY_TOKEN_LABELS[token];
    // Unknown country not yet in our Albanian dictionary — still show its
    // own real name (dash-slug -> Title Case Words) instead of "Të tjera".
    return token.split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };
  // Flag for a country GROUP NAME (as returned by leagueCountry above) —
  // looks up the underlying ISO code by reverse-mapping the label. Falls
  // back to a globe icon for "Ndërkombëtare"/"Të tjera" (no single country
  // flag applies) instead of forcing a flag onto non-country groups.
  const countryFlag = (countryName: string): string => {
    if (countryName === 'Ndërkombëtare') return '🌍';
    if (countryName === 'Të tjera') return '🏳️';
    const token = Object.keys(COUNTRY_TOKEN_LABELS).find((t) => COUNTRY_TOKEN_LABELS[t] === countryName);
    const iso = token ? COUNTRY_TOKEN_ISO[token] : null;
    return iso ? isoToFlagEmoji(iso) : '🏳️';
  };

  // Filtri "shtet": kur shtypet Spanja, currentLeague bëhet "COUNTRY:Spanja"
  // dhe faqja shfaq TË GJITHA ligat e Spanjës (të grupuara ligë-për-ligë),
  // në vend që të kërkohet të zgjedhet një ligë e vetme.
  const COUNTRY_FILTER_PREFIX = 'COUNTRY:';
  const countryFilterKey = (country: string) => `${COUNTRY_FILTER_PREFIX}${country}`;
  const isCountryFilter = (key: string) => key.startsWith(COUNTRY_FILTER_PREFIX);
  const countryFromFilter = (key: string) => key.slice(COUNTRY_FILTER_PREFIX.length);

  // Ndeshjet e ardhshme, brenda zgjedhjes aktuale (të gjitha / të
  // preferuarat / shtet / ligë), PA filtrin e datës. LIVE përfshihet VETËM
  // kur ka një filtër specifik vendi/lige (jo te "Të gjitha" e përgjithshme,
  // e as te "Favoritet") — sepse "Të gjitha" këtu do të thotë "të gjitha ato
  // që do të vijnë", ndërsa live ka tab-in e vet ("Live In-Play"). Por nëse
  // hap Francën ndërkohë që PSG-Monaco është live, s'ka kuptim ta fshehim —
  // ndeshja ekziston, është pjesë e vetë ligës/vendit që zgjodhe.
  const includeLiveInScope = isCountryFilter(currentLeague) ||
    (currentLeague !== 'All Top Football' && currentLeague !== 'FAVORITES');
  const scopedUpcoming = useMemo(() => searchFiltered
    .filter((m) => m.status === MatchStatus.UPCOMING || (includeLiveInScope && m.status === MatchStatus.LIVE))
    .filter((m) => {
      if (currentLeague === 'All Top Football') return true;
      if (currentLeague === 'FAVORITES') return favoriteTeams.has(m.homeTeam) || favoriteTeams.has(m.awayTeam) || favoriteLeagues.has(m.league);
      if (isCountryFilter(currentLeague)) return leagueCountry(m.league) === countryFromFilter(currentLeague);
      return m.league === currentLeague;
    })
    // LIVE në krye (siç e bën London365 — ndeshja që po luhet tani është
    // gjithmonë prioritet), pastaj UPCOMING sipas orarit të fillimit.
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === MatchStatus.LIVE ? -1 : 1;
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matches, searchQuery, currentLeague, favoriteTeams, favoriteLeagues, includeLiveInScope]);

  const dateScopedUpcoming = useMemo(
    () => scopedUpcoming.filter((m) => selectedDate === 'ALL' || albaniaDateKey(m.startTime) === selectedDate),
    [scopedUpcoming, selectedDate],
  );

  // Kur ligë/shteti i zgjedhur nuk ka ndeshje për datën e zgjedhur, por ka
  // ndeshje në ditët e tjera, shfaqim TË GJITHA ndeshjet e ardhshme me datën
  // e tyre — në vend që faqja të dalë bosh (p.sh. La Liga pa ndeshje sot).
  const dateFallbackActive = selectedDate !== 'ALL' && dateScopedUpcoming.length === 0 && scopedUpcoming.length > 0;
  const upcomingMatches = dateFallbackActive ? scopedUpcoming : dateScopedUpcoming;

  const detailMatchListEntry = matches.find((m) => m.id === detailMatchId);
  // Base fields (score/status/minute) always come from `matches` so the
  // usual WebSocket live-update patches above keep applying while the
  // detail view is open; `markets` is swapped in from the full fetch below
  // once it lands (until then this still shows the h2h market the list
  // already had, so the view isn't empty while loading).
  const detailMatch = detailMatchListEntry
    ? (detailMatchFull && detailMatchFull.id === detailMatchId
        ? { ...detailMatchListEntry, markets: detailMatchFull.markets }
        : detailMatchListEntry)
    : undefined;

  // Fetch full markets for whichever match is opened. The list only ever
  // carries the h2h market (see server/routes/matches.js), so opening a
  // match's detail (all ~100 markets) needs its own request.
  useEffect(() => {
    if (!detailMatchId) { setDetailMatchFull(null); return; }
    let cancelled = false;
    setDetailMatchFull(null); // don't show the PREVIOUS match's full markets while this one loads
    api.fetchMatchById(detailMatchId)
      .then((full) => { if (!cancelled) setDetailMatchFull(full); })
      .catch((e) => console.error('Failed to load match detail', e));
    return () => { cancelled = true; };
  }, [detailMatchId]);
  // "Ndeshjet Kryesore" -- a quick-glance horizontal strip above the full
  // grouped list, live matches first then the soonest upcoming ones across
  // ALL leagues/countries (not scoped to whatever league/country is
  // currently selected -- this is meant as a homepage highlight reel, same
  // idea as the reference site's featured row).
  // Quick "<Country> <League>" row (reference: "England Premier League")
  // above the general featured strip — whichever league we find that's
  // Premier League/England; simply omitted if that league isn't currently
  // populated (season gap, provider hiccup) rather than showing an empty
  // card row.
  const topLeagueMatches = useMemo(() => {
    const key = matches.map((m) => m.league).find((k) => leagueCountry(k) === 'Anglia' && /premier league/i.test(leagueLabel(k)));
    if (!key) return { key: null as string | null, label: '', list: [] as Match[] };
    const list = matches
      .filter((m) => m.league === key && (m.status === MatchStatus.UPCOMING || m.status === MatchStatus.LIVE))
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === MatchStatus.LIVE ? -1 : 1;
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      })
      .slice(0, 10);
    return { key, label: `${leagueCountry(key)} ${leagueLabel(key)}`, list };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches]);

  const featuredMatches = useMemo(() => {
    const live = matches.filter((m) => m.status === MatchStatus.LIVE);
    const upcoming = matches
      .filter((m) => m.status === MatchStatus.UPCOMING)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    return [...live, ...upcoming].slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches]);

  const [isTodaySectionOpen, setIsTodaySectionOpen] = useState(false);
  const todayMatches = useMemo(
    () => matches
      .filter((m) => (m.status === MatchStatus.UPCOMING || m.status === MatchStatus.LIVE) && isSameAlbaniaDay(m.startTime, albaniaTodayKey()))
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === MatchStatus.LIVE ? -1 : 1;
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      }),
    [matches],
  );

  const matchesByCountry = useMemo(() => {
    const byCountry: Record<string, Record<string, Match[]>> = {};
    const selectedCountry = isCountryFilter(currentLeague) ? countryFromFilter(currentLeague) : null;
    for (const match of upcomingMatches) {
      const country = leagueCountry(match.league);
      if (selectedCountry && country !== selectedCountry) continue;
      if (!byCountry[country]) byCountry[country] = {};
      if (!byCountry[country][match.league]) byCountry[country][match.league] = [];
      byCountry[country][match.league].push(match);
    }
    const PRIORITY_COUNTRIES = ['Anglia', 'Spanja', 'Italia', 'Gjermania', 'Franca', 'Portugali', 'Holandë', 'Belgjikë'];
    const countryNames = Object.keys(byCountry).sort((a, b) => {
      if (a === 'Të tjera') return 1;
      if (b === 'Të tjera') return -1;
      if (a === 'Ndërkombëtare') return 1;
      if (b === 'Ndërkombëtare') return -1;
      const pa = PRIORITY_COUNTRIES.indexOf(a);
      const pb = PRIORITY_COUNTRIES.indexOf(b);
      if (pa !== -1 || pb !== -1) return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
      return a.localeCompare(b);
    });
    return countryNames.map((country) => [
      country,
      Object.keys(byCountry[country])
        .sort(byLeagueImportance)
        .map((league) => [league, byCountry[country][league]] as [string, Match[]]),
    ] as [string, [string, Match[]][]]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcomingMatches, currentLeague]);
  const dynamicLeagues = useMemo(() => {
    const fetchedLeagues = Array.from(new Set(matches.map((m) => m.league)));
    return Array.from(new Set(['All Top Football', ...fetchedLeagues])).sort();
  }, [matches]);

  const leaguesByCountry = useMemo(() => {
    const groups: Record<string, string[]> = {};
    dynamicLeagues.filter((l) => l !== 'All Top Football').forEach((league) => {
      const country = leagueCountry(league);
      if (!groups[country]) groups[country] = [];
      groups[country].push(league);
    });
    Object.values(groups).forEach((arr) => arr.sort(byLeagueImportance));
    // Biggest European leagues first (what most people are looking for),
    // then every other country alphabetically, then continental/
    // international competitions (Champions League, World Cup, etc.) at
    // the very end — they're a different kind of thing than a country.
    const PRIORITY_COUNTRIES = ['Anglia', 'Spanja', 'Italia', 'Gjermania', 'Franca', 'Portugali', 'Holandë', 'Belgjikë'];
    const countryNames = Object.keys(groups).sort((a, b) => {
      if (a === 'Të tjera') return 1;
      if (b === 'Të tjera') return -1;
      if (a === 'Ndërkombëtare') return 1;
      if (b === 'Ndërkombëtare') return -1;
      const pa = PRIORITY_COUNTRIES.indexOf(a);
      const pb = PRIORITY_COUNTRIES.indexOf(b);
      if (pa !== -1 || pb !== -1) return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
      return a.localeCompare(b);
    });
    return countryNames.map((name) => [name, groups[name]] as [string, string[]]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynamicLeagues]);

  // Which country group is expanded in the sidebar. Kept in sync with
  // whatever league is currently selected (so picking a league from the
  // mobile chip strip, or resetting via "Home", opens/closes the right
  // group), while still letting the user freely open other groups to browse.
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null);
  useEffect(() => {
    if (currentLeague === 'All Top Football' || currentLeague === 'FAVORITES') { setExpandedCountry(null); return; }
    if (isCountryFilter(currentLeague)) { setExpandedCountry(countryFromFilter(currentLeague)); return; }
    setExpandedCountry(leagueCountry(currentLeague));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLeague]);

  const uniqueId = (matchId: string, marketId: string, selId: string) => `${matchId}-${marketId}-${selId}`;
  const selectedIds = useMemo(() => selections.map((s) => uniqueId(s.matchId, s.marketId, s.selectionId)), [selections]);

  // --- Auth handlers ---
  const handleAuthenticated = (user: User) => setCurrentUser(user);

  const handleLogout = () => {
    api.logout();
    setCurrentUser(null);
    setSelections([]);
    setShowAdmin(false);
    setDetailMatchId(null);
    setCurrentView('sports');
    setMatches([]);
    setMyBets([]);
    hasLoadedMatchesOnceRef.current = false;
  };

  // --- Admin: user management (all calls hit the real backend now) ---
  // Admin picks the role at creation time (USER vs AGENT) -- routed to the
  // matching backend endpoint, since they're separate tables/permissions
  // server-side, not just a field on one shared insert.
  const handleCreateUser = async (newUser: { name: string; username: string; password: string; balance: number; role: 'USER' | 'AGENT' }) => {
    try {
      const { role, ...rest } = newUser;
      if (role === 'AGENT') await api.adminCreateAgent(rest);
      else await api.adminCreateUser(rest);
      await loadAdminData();
    } catch (e: any) {
      alert(e.message || 'Failed to create user');
    }
  };

  // Safe delete first (refuses with USER_HAS_HISTORY if the user has bets/
  // transactions/casino rounds/sub-users). On that specific refusal, offer
  // the admin a force-delete that wipes everything -- confirmed explicitly
  // since it's irreversible and destroys financial history.
  const handleDeleteUser = async (userId: string) => {
    try {
      await api.adminDeleteUser(userId);
      await loadAdminData();
    } catch (e: any) {
      if (e?.code === 'USER_HAS_HISTORY') {
        const confirmed = window.confirm(
          (e.message || 'Ky user ka histori.') +
          '\n\nA doni ta fshini PLOTËSISHT këtë user, duke përfshirë të gjitha kuponat, transaksionet dhe historikun financiar? Ky veprim s\'kthehet mbrapa.'
        );
        if (confirmed) {
          try {
            await api.adminForceDeleteUser(userId);
            await loadAdminData();
          } catch (e2: any) {
            alert(e2.message || 'Failed to force-delete user');
          }
        }
        return;
      }
      alert(e.message || 'Failed to delete user');
    }
  };

  const handleAddCredit = async (userId: string, amount: number) => {
    try {
      await api.adminAddCredit(userId, amount);
      await loadAdminData();
      if (currentUser?.id === userId) {
        const refreshed = await api.fetchCurrentUser();
        setCurrentUser(refreshed);
      }
    } catch (e: any) {
      alert(e.message || 'Failed to add credit');
    }
  };

  const handleResetPassword = async (userId: string, newPass: string) => {
    try {
      await api.adminResetPassword(userId, newPass);
      alert('Password updated');
    } catch (e: any) {
      alert(e.message || 'Failed to reset password');
    }
  };

  // --- Bet slip ---
  const handleToggleSelection = useCallback((match: Match, marketId: string, selectionId: string, boosted?: boolean) => {
    if (!currentUser) return;
    const market = match.markets.find((m) => m.id === marketId);
    const option = market?.options.find((o) => o.id === selectionId);
    if (!market || !option) return;

    const uId = uniqueId(match.id, marketId, selectionId);
    setSelections((prev) => {
      const exists = prev.some((s) => uniqueId(s.matchId, s.marketId, s.selectionId) === uId);
      if (exists) return prev.filter((s) => uniqueId(s.matchId, s.marketId, s.selectionId) !== uId);
      // Selections within the SAME market of the SAME match are mutually
      // exclusive (e.g. picking "2" after "1" in the 1X2 market must drop
      // "1" — they can never both win, so keeping both makes no sense).
      const withoutSameMarket = prev.filter((s) => !(s.matchId === match.id && s.marketId === marketId));
      return [...withoutSameMarket, {
        matchId: match.id,
        matchHome: match.homeTeam,
        matchAway: match.awayTeam,
        marketId: market.id,
        marketName: market.name,
        selectionId: option.id,
        selectionName: option.name,
        odds: boosted ? Number((option.odds * 1.12).toFixed(2)) : option.odds,
        status: 'PENDING' as any,
        boosted: !!boosted,
      }];
    });
  }, [currentUser]);

  const handlePlaceBet = useCallback(async (stake: number, type: 'SINGLE' | 'ACCUMULATOR') => {
    if (!currentUser || selections.length === 0) return;
    setBetError(null);
    try {
      const result = await api.placeBet(stake, type, selections);
      setCurrentUser((prev) => (prev ? { ...prev, balance: result.balance } : prev));
      setSelections([]);
      setIsMobileSlipOpen(false);
      await loadMyBets();
    } catch (e: any) {
      // Odds may have moved since the client last fetched them — the server
      // re-verifies every price at placement time and rejects stale ones.
      // ODDS_CHANGED specifically (as opposed to e.g. SELECTION_SUSPENDED or
      // a plain network error) means the ticket is still placeable, just at
      // different prices — update the affected selection(s) in place with
      // previousOdds set, so the slip shows "was X, now Y" and a "Prano
      // ndryshimet" action, instead of leaving the person to figure out
      // which leg changed from a generic error string and re-add it by hand.
      if (e instanceof api.ApiError && e.code === 'ODDS_CHANGED' && Array.isArray(e.body?.changes)) {
        const changes = e.body.changes as { matchId: string; marketId: string; selectionId: string; newOdds: number }[];
        setSelections((prev) => prev.map((sel) => {
          const change = changes.find((c) => c.matchId === sel.matchId && c.marketId === sel.marketId && c.selectionId === sel.selectionId);
          return change ? { ...sel, previousOdds: sel.odds, odds: change.newOdds } : sel;
        }));
        return;
      }
      setBetError(e.message || 'Could not place bet');
    }
  }, [currentUser, selections, loadMyBets]);

  const handleCancelBet = useCallback(async (betId: string, origin: 'USER' | 'ADMIN') => {
    if (origin === 'ADMIN') {
      if (!window.confirm('Admin delete this bet and adjust balance?')) return;
      try {
        await api.adminCancelBet(betId);
        await loadAdminData();
      } catch (e: any) {
        alert(e.message || 'Failed to cancel bet');
      }
      return;
    }
    // Regular user cancelling their own still-pending ticket.
    try {
      const { balance } = await api.cancelMyBet(betId);
      setCurrentUser((u) => (u ? { ...u, balance } : u));
      await loadMyBets();
    } catch (e: any) {
      alert(e.message || 'Anulimi dështoi.');
    }
  }, [loadAdminData, loadMyBets]);

  const handleSettleMatch = useCallback(async (match: Match, homeScore: number, awayScore: number) => {
    if (simulatingMatchId) return;
    setSimulatingMatchId(match.id);
    try {
      const result = await api.adminSettleMatch(match.id, homeScore, awayScore);
      if (result.leftPendingForManualReview > 0) {
        alert(
          `${result.autoSettledLegs} kupon(a) u zgjidhën automatikisht.\n` +
          `${result.leftPendingForManualReview} kupon(a) mbetën PENDING (tregje si Double Chance/Handicap kërkojnë rishikim manual te "All Tickets").`
        );
      }
      await Promise.all([loadMatches(), loadAdminData()]);
    } catch (e: any) {
      alert(e.message || 'Failed to settle match');
    } finally {
      setSimulatingMatchId(null);
    }
  }, [simulatingMatchId, loadMatches, loadAdminData]);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-yellow"></div>
      </div>
    );
  }

  if (!currentUser) return <Login onAuthenticated={handleAuthenticated} />;

  // Owner (ADMIN) gets a completely separate, simple, read-first page —
  // never the sportsbook/casino shell below, so the Owner literally has no
  // way to place a bet or play. Reports come first; management (existing
  // AdminPanel: users/tickets/audit) is one tab away when needed.
  if (currentUser.role === UserRole.ADMIN) {
    return (
      <OwnerDashboard
        currentUser={currentUser}
        onLogout={handleLogout}
        users={adminUsers}
        allBets={adminAllBets}
        onCreateUser={handleCreateUser}
        onDeleteUser={handleDeleteUser}
        onAddCredit={handleAddCredit}
        onResetPassword={handleResetPassword}
        onCancelBet={handleCancelBet}
      />
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text flex flex-col font-sans selection:bg-brand-header selection:text-white pb-16 md:pb-0">
      <Navbar
        currentUser={currentUser}
        onLogout={handleLogout}
        onOpenAdmin={() => setShowAdmin(!showAdmin)}
        currentView={currentView}
        onNavigate={setCurrentView}
        onGoHome={() => { setShowLiveOnly(false); setCurrentLeague('All Top Football'); setSelectedDate('ALL'); setDetailMatchId(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        onGoLive={() => { setDetailMatchId(null); setShowLiveOnly(true); requestAnimationFrame(() => document.getElementById('live-section')?.scrollIntoView({ behavior: 'smooth' })); }}
        liveCount={liveMatches.length}
      />

      <div className="flex-1 flex max-w-[1450px] mx-auto w-full pt-4 px-2 gap-2 relative">

        {currentView === 'sports' && (
          <>
            {/* "Futboll" trigger — opens the sports/leagues list as a dropdown
                drawer from the left, on every screen size. Previously this
                was a permanently-open <aside> on large screens (pushing all
                the page content down/looking like a big static block) and
                only a drawer below the lg breakpoint; now it's always a
                dropdown you open on demand, matching the one pattern
                everywhere instead of two different UIs at different widths. */}
            <button
              onClick={() => setIsLeagueMenuOpen(true)}
              className="fixed left-2 top-[7.5rem] z-40 bg-brand-panel border border-[#444] rounded-full pl-2.5 pr-3.5 py-2.5 shadow-lg flex items-center gap-1.5"
              aria-label="Hap Futboll dhe ligat"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" className="w-5 h-5 fill-brand-yellow"><path fillRule="evenodd" d="M3 5h14a1 1 0 100-2H3a1 1 0 000 2zm0 6h14a1 1 0 100-2H3a1 1 0 000 2zm0 6h14a1 1 0 100-2H3a1 1 0 000 2z" clipRule="evenodd" /></svg>
              <span className="text-xs font-bold uppercase tracking-wider text-brand-text">Futboll</span>
            </button>

            {isLeagueMenuOpen && (
              <div className="fixed inset-0 z-50 flex" onClick={() => setIsLeagueMenuOpen(false)}>
                <div className="w-72 max-w-[85vw] h-full bg-brand-panel overflow-y-auto custom-scrollbar shadow-2xl" onClick={(e) => e.stopPropagation()}>
                  <div className="bg-[#383838] px-3 py-3 text-xs font-bold text-brand-text border-b border-[#444] uppercase flex justify-between items-center sticky top-0">
                    <span>Sportet</span>
                    <button onClick={() => setIsLeagueMenuOpen(false)} className="text-brand-textMuted hover:text-white text-lg leading-none px-1">✕</button>
                  </div>

                  <button
                    onClick={() => { setShowLiveOnly(false); setCurrentLeague('All Top Football'); setDetailMatchId(null); setIsLeagueMenuOpen(false); }}
                    className={`w-full text-left px-3 py-2.5 border-b border-brand-bg/10 flex items-center gap-2.5 transition-colors hover:bg-[#444] hover:text-white ${currentLeague === 'All Top Football' && !showLiveOnly ? 'bg-[#444] text-white font-bold border-l-4 border-l-brand-yellow' : 'text-brand-text'}`}
                  >
                    <span aria-hidden="true" className="text-base leading-none">⚽</span>
                    <span className="uppercase tracking-wider">Futboll</span>
                  </button>
                  {[
                    ['🏀', 'Basketboll'], ['⚾', 'Bejsboll'], ['🏒', 'Hokej Akull'], ['🎾', 'Tenis'],
                    ['🤾', 'Hendboll'], ['🏈', 'Futboll Amerikan'], ['🎱', 'Snooker'], ['🏓', 'Tenis Tavoline'],
                    ['🏏', 'Kriket'], ['🎯', 'Darts'], ['🏐', 'Volejboll'],
                  ].map(([icon, name]) => (
                    <div
                      key={name}
                      className="w-full text-left px-3 py-2.5 border-b border-brand-bg/10 flex items-center gap-2.5 text-brand-textMuted/50 cursor-not-allowed select-none"
                    >
                      <span aria-hidden="true" className="text-base leading-none opacity-50">{icon}</span>
                      <span className="uppercase tracking-wider">{name}</span>
                      <span className="ml-auto text-[9px] normal-case font-normal shrink-0">Së shpejti</span>
                    </div>
                  ))}

                  <div className="bg-[#383838] px-3 py-3 text-xs font-bold text-brand-text border-b border-[#444] uppercase flex justify-between items-center sticky top-0">
                    <span>Countries &amp; Leagues</span>
                  </div>

                  <button onClick={() => { setShowLiveOnly(false); setCurrentLeague('FAVORITES'); setDetailMatchId(null); setIsLeagueMenuOpen(false); }} className={`w-full text-left px-3 py-3 border-b border-brand-bg/10 flex justify-between items-center group transition-colors hover:bg-[#444] hover:text-white ${currentLeague === 'FAVORITES' ? 'bg-[#444] text-white font-bold border-l-4 border-l-brand-yellow' : ''}`}>
                    <div className="flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" className="w-3.5 h-3.5 fill-brand-yellow"><path d="M10 1.5l2.6 5.27 5.82.85-4.21 4.1.99 5.8L10 14.9l-5.2 2.62.99-5.8-4.21-4.1 5.82-.85L10 1.5z" /></svg>
                      <span className="uppercase tracking-wider">Të Preferuarat</span>
                    </div>
                  </button>

                  <button onClick={() => { setDetailMatchId(null); setIsLeagueMenuOpen(false); setShowLiveOnly(true); requestAnimationFrame(() => document.getElementById('live-section')?.scrollIntoView({ behavior: 'smooth' })); }} className={`w-full text-left px-3 py-3 border-b border-brand-bg/10 flex justify-between items-center group transition-colors ${showLiveOnly ? 'bg-[#444] text-white font-bold' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-accent"></span>
                      </span>
                      <span className="uppercase tracking-wider">In-Play / Live</span>
                      {liveMatches.length > 0 && <span className="text-[10px] bg-brand-accent text-black px-1.5 rounded font-bold">{liveMatches.length}</span>}
                    </div>
                  </button>

                  <div className="flex flex-col text-xs text-brand-textMuted">
                    {leaguesByCountry.map(([country, leagues]) => {
                      const isOpen = expandedCountry === country;
                      return (
                        <div key={country}>
                          <div className={`w-full flex items-stretch bg-[#333] border-b border-brand-bg/10 ${currentLeague === countryFilterKey(country) ? 'border-l-4 border-l-brand-yellow' : ''}`}>
                            <button
                              onClick={() => { setShowLiveOnly(false); setCurrentLeague(countryFilterKey(country)); setDetailMatchId(null); setIsLeagueMenuOpen(false); }}
                              className={`flex-1 min-w-0 text-left px-3 py-2 hover:bg-[#3a3a3a] text-brand-text font-bold uppercase text-[10px] tracking-wider transition-colors ${currentLeague === countryFilterKey(country) ? 'text-white bg-[#444]' : ''}`}
                            >
                              <span className="flex items-center gap-1.5">
                                <span aria-hidden="true">{countryFlag(country)}</span>
                                <span className="truncate">{country}</span>
                                <span className="ml-auto text-[9px] text-brand-textMuted font-normal shrink-0">{leagues.length}</span>
                              </span>
                            </button>
                            <button
                              onClick={() => setExpandedCountry(isOpen ? null : country)}
                              className="px-3 text-brand-textMuted hover:text-white hover:bg-[#3a3a3a] transition-colors"
                              aria-label={isOpen ? `Mbyll ligat e ${country}` : `Hap ligat e ${country}`}
                            >
                              {isOpen ? '▾' : '▸'}
                            </button>
                          </div>
                          {isOpen && (
                            <button onClick={() => { setShowLiveOnly(false); setCurrentLeague(countryFilterKey(country)); setDetailMatchId(null); setIsLeagueMenuOpen(false); }} className={`px-3 py-2 pl-6 w-full text-left text-[10px] uppercase tracking-wider hover:bg-[#444] hover:text-white transition-colors border-b border-brand-bg/10 ${currentLeague === countryFilterKey(country) ? 'bg-[#444] text-white font-bold' : 'text-brand-yellow'}`}>
                              Të gjitha ligat ({leagues.length})
                            </button>
                          )}
                          {isOpen && leagues.map((league) => (
                            <button key={league} onClick={() => { setShowLiveOnly(false); setCurrentLeague(league); setDetailMatchId(null); setIsLeagueMenuOpen(false); }} className={`px-3 py-2.5 pl-6 hover:bg-[#444] hover:text-white transition-colors border-b border-brand-bg/10 flex justify-between items-center group text-left w-full ${currentLeague === league ? 'bg-[#444] text-white font-bold border-l-4 border-l-brand-yellow' : ''}`}>
                              <span className="truncate">{leagueLabel(league)}</span>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}


        <main ref={adminPanelRef as React.RefObject<HTMLElement>} className="flex-1 min-w-0 mb-20 md:mb-0">
          {showAdmin && currentUser.role === UserRole.AGENT ? (
            <AgentUsersPanel
              currentUser={currentUser}
              onBalanceChanged={(balance) => setCurrentUser((p) => withBalance(p, balance))}
            />
          ) : currentView === 'casino' ? (
            <CasinoHub userBalance={currentUser.balance} onSetBalance={(balance) => setCurrentUser((p) => p ? { ...p, balance } : p)} />
          ) : detailMatch ? (
            <MatchDetail
              // Force a full remount when the viewed match changes (e.g.
              // jumping straight from one match's detail to another via
              // search, without closing first). Without this, React reuses
              // the same MatchDetail/LivePitch instance and their ticking
              // clocks keep counting up from the PREVIOUS match's minute
              // instead of resetting to the new match's real one.
              key={detailMatch.id}
              match={detailMatch}
              leagueLabel={leagueLabel(detailMatch.league)}
              onClose={() => setDetailMatchId(null)}
              onBetClick={handleToggleSelection}
              selectedIds={selectedIds}
            />
          ) : (
            <div className="space-y-3 md:space-y-4">
              {/* Sport icon strip — top-of-page quick switcher on the home
                  view only (matches the reference: it's on the homepage,
                  not repeated on every drilled-down page where the sidebar
                  already covers the same job). Soccer active; the rest
                  honestly disabled ("Së shpejti") since only soccer has
                  real data right now. */}
              {!showLiveOnly && currentLeague === 'All Top Football' && (
                <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar">
                  <button className="shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded bg-[#333] border-b-2 border-brand-yellow text-white">
                    <span className="text-lg leading-none" aria-hidden="true">⚽</span>
                    <span className="text-[9px] uppercase tracking-wide">Futboll</span>
                  </button>
                  {[
                    ['🏀', 'Basketboll'], ['⚾', 'Bejsboll'], ['🏒', 'Hokej'], ['🎾', 'Tenis'],
                    ['🤾', 'Hendboll'], ['🏈', 'Am. Futboll'], ['🎱', 'Snooker'], ['🏓', 'T. Tavoline'],
                    ['🏏', 'Kriket'], ['🎯', 'Darts'], ['🏐', 'Volejboll'],
                  ].map(([icon, name]) => (
                    <div key={name} className="shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded text-brand-textMuted/40 cursor-not-allowed" title="Së shpejti">
                      <span className="text-lg leading-none opacity-50" aria-hidden="true">{icon}</span>
                      <span className="text-[9px] uppercase tracking-wide">{name}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Breadcrumb — "Soccer / <Country> - <League>" style header
                  shown once the person has drilled into something specific,
                  same idea as the reference site's context bar. Home/
                  Favorites/root views stay breadcrumb-less on purpose. */}
              {(showLiveOnly || (currentLeague !== 'All Top Football' && currentLeague !== 'FAVORITES')) && (
                <div className="bg-[#2a2a2a] border border-brand-divider rounded px-3 py-2 text-xs text-brand-textMuted flex items-center justify-between gap-2">
                  <span className="truncate">
                    <span className="text-brand-text font-semibold">Futboll</span>
                    {showLiveOnly ? (
                      <span> / <span className="text-brand-accent font-semibold">Live InPlay</span></span>
                    ) : isCountryFilter(currentLeague) ? (
                      <span> / <span className="text-brand-text font-semibold">{countryFromFilter(currentLeague)}</span></span>
                    ) : (
                      <span> / <span className="text-brand-text font-semibold">{leagueCountry(currentLeague)} - {leagueLabel(currentLeague)}</span></span>
                    )}
                  </span>
                  <button
                    onClick={() => { setShowLiveOnly(false); setCurrentLeague('All Top Football'); setDetailMatchId(null); }}
                    className="shrink-0 text-[10px] uppercase tracking-wide text-brand-textMuted hover:text-white"
                  >
                    ← Kryefaqja
                  </button>
                </div>
              )}

              <div className="lg:hidden flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                <button onClick={() => { setShowLiveOnly(true); requestAnimationFrame(() => document.getElementById('live-section')?.scrollIntoView({ behavior: 'smooth' })); }} className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold flex items-center gap-1.5 ${showLiveOnly ? 'bg-brand-yellow text-black' : 'bg-brand-panel text-white'}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-accent animate-pulse"></span>
                  LIVE {liveMatches.length > 0 && `(${liveMatches.length})`}
                </button>
                <button onClick={() => { setShowLiveOnly(false); setCurrentLeague('All Top Football'); }} className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold ${currentLeague === 'All Top Football' ? 'bg-brand-yellow text-black' : 'bg-brand-panel text-white'}`}>Të Gjitha</button>
                {leaguesByCountry.map(([country, leagues]) => (
                  <button key={country} onClick={() => { setShowLiveOnly(false); setCurrentLeague(countryFilterKey(country)); setDetailMatchId(null); }} className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold flex items-center gap-1.5 ${currentLeague === countryFilterKey(country) ? 'bg-brand-yellow text-black' : 'bg-brand-panel text-white'}`}>
                    <span aria-hidden="true">{countryFlag(country)}</span>
                    {country}
                    <span className={`text-[10px] font-normal ${currentLeague === countryFilterKey(country) ? 'text-black/60' : 'text-brand-textMuted'}`}>{leagues.length}</span>
                  </button>
                ))}
              </div>

              <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                {dateOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSelectedDate(opt.value)}
                    className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                      selectedDate === opt.value
                        ? 'bg-brand-yellow text-black border-brand-yellow'
                        : 'bg-brand-panel text-white border-brand-divider hover:border-brand-yellow/50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="relative">
                <div className="bg-brand-panel p-3 rounded flex items-center gap-2 border border-brand-divider">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-brand-textMuted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  <input
                    type="text"
                    placeholder="Kërko skuadra, liga..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => setIsSearchFocused(true)}
                    onBlur={() => setTimeout(() => setIsSearchFocused(false), 150)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { commitSearchHistory(searchQuery); (e.target as HTMLInputElement).blur(); } }}
                    className="bg-transparent text-white text-sm w-full outline-none placeholder-brand-textMuted"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="text-brand-textMuted hover:text-white shrink-0">✕</button>
                  )}
                </div>

                {isSearchFocused && (searchQuery.trim() ? (searchSuggestions.teams.length + searchSuggestions.leagues.length + searchSuggestions.matches.length > 0) : searchHistory.length > 0) && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-brand-panel border border-brand-divider rounded shadow-xl max-h-80 overflow-y-auto text-sm">
                    {!searchQuery.trim() && searchHistory.length > 0 && (
                      <>
                        <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-brand-textMuted flex justify-between items-center">
                          <span>Kërkime të fundit</span>
                          <button onMouseDown={(e) => { e.preventDefault(); setSearchHistory([]); localStorage.removeItem('searchHistory'); }} className="hover:text-white">Pastro</button>
                        </div>
                        {searchHistory.map((term) => (
                          <button key={term} onMouseDown={(e) => { e.preventDefault(); setSearchQuery(term); commitSearchHistory(term); setIsSearchFocused(false); }} className="w-full text-left px-3 py-2 text-brand-textMuted hover:bg-[#444] hover:text-white flex items-center gap-2">
                            <span className="opacity-50">↺</span>{term}
                          </button>
                        ))}
                      </>
                    )}

                    {searchQuery.trim() && searchSuggestions.teams.length > 0 && (
                      <>
                        <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-brand-textMuted">Skuadra</div>
                        {searchSuggestions.teams.map((team) => (
                          <button key={team} onMouseDown={(e) => { e.preventDefault(); setSearchQuery(team); commitSearchHistory(team); setIsSearchFocused(false); }} className="w-full text-left px-3 py-2 text-white hover:bg-[#444] flex items-center justify-between">
                            <span>{team}</span>
                            {favoriteTeams.has(team) && <span className="text-brand-yellow text-xs">★</span>}
                          </button>
                        ))}
                      </>
                    )}

                    {searchQuery.trim() && searchSuggestions.leagues.length > 0 && (
                      <>
                        <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-brand-textMuted">Liga</div>
                        {searchSuggestions.leagues.map((league) => (
                          <button key={league} onMouseDown={(e) => { e.preventDefault(); setShowLiveOnly(false); setCurrentLeague(league); setSearchQuery(''); commitSearchHistory(leagueLabel(league)); setIsSearchFocused(false); }} className="w-full text-left px-3 py-2 text-white hover:bg-[#444]">
                            {leagueLabel(league)}
                          </button>
                        ))}
                      </>
                    )}

                    {searchQuery.trim() && searchSuggestions.matches.length > 0 && (
                      <>
                        <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-brand-textMuted">Ndeshje</div>
                        {searchSuggestions.matches.map((m) => (
                          <button key={m.id} onMouseDown={(e) => { e.preventDefault(); commitSearchHistory(searchQuery); setDetailMatchId(m.id); setSearchQuery(''); setIsSearchFocused(false); }} className="w-full text-left px-3 py-2 text-white hover:bg-[#444]">
                            {m.homeTeam} <span className="text-brand-textMuted">vs</span> {m.awayTeam}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>

              {loadError ? (
                <div className="flex flex-col justify-center items-center h-64 bg-brand-panel rounded border border-brand-divider gap-3">
                  <div className="text-brand-textMuted text-sm text-center px-4">{loadError}</div>
                  <button onClick={() => loadMatches()} className="bg-brand-yellow hover:bg-yellow-400 text-brand-bg font-bold px-4 py-2 rounded text-sm">
                    Provo Përsëri
                  </button>
                </div>
              ) : isLoading ? (
                <div className="flex flex-col justify-center items-center h-64 bg-brand-panel rounded border border-brand-divider">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-yellow mb-4"></div>
                  <div className="text-brand-textMuted text-xs animate-pulse">Duke ngarkuar ndeshjet...</div>
                </div>
              ) : (
                <>
                  {/* LIVE — only rendered when the person pressed "Live In-Play".
                      Shown even if empty (real "no live matches" message, no
                      fake data) since that's the whole point of the button. */}
                  {showLiveOnly && (
                    <div id="live-section" className="bg-brand-panel rounded overflow-hidden shadow-sm border border-brand-accent/30 scroll-mt-4">
                      <div className="bg-[#2a1f1f] px-3 py-2 text-xs font-bold text-white border-b border-[#444] flex items-center gap-2 justify-between">
                        <div className="flex items-center gap-2">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-accent"></span>
                          </span>
                          <span className="text-brand-accent uppercase tracking-wider">Live Tani</span>
                          {liveMatches.length > 0 && <span className="text-[10px] bg-brand-accent text-black px-1.5 rounded font-bold">{liveMatches.length}</span>}
                        </div>
                        <button onClick={() => setShowLiveOnly(false)} className="text-[10px] text-brand-textMuted hover:text-white uppercase tracking-wide">
                          Kthehu te Kryefaqja ✕
                        </button>
                      </div>
                      {liveMatches.length === 0 ? (
                        <div className="text-center text-brand-textMuted text-xs py-8 px-4">
                          Nuk ka asnjë ndeshje live aktualisht.
                        </div>
                      ) : (
                        <div className="divide-y divide-brand-divider">
                          {liveMatches.map((match) => (
                            <MatchRow
                              key={match.id}
                              match={match}
                              onBetClick={handleToggleSelection}
                              onOpenDetail={(m) => setDetailMatchId(m.id)}
                              isAdmin={currentUser.role === UserRole.ADMIN}
                              onSettleMatch={handleSettleMatch}
                              isSimulating={simulatingMatchId === match.id}
                              selectedIds={selectedIds}
                              favoriteTeams={favoriteTeams}
                              onToggleFavoriteTeam={(team) => toggleFavorite('TEAM', team)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {!showLiveOnly && dateFallbackActive && (
                    <div className="bg-[#3a3320] border border-brand-yellow/40 text-brand-yellow text-xs rounded px-3 py-2 flex items-center justify-between gap-2">
                      <span>
                        Nuk ka ndeshje për datën e zgjedhur — po shfaqen ndeshjet e ardhshme, të ndara sipas datës.
                      </span>
                      <button onClick={() => setSelectedDate('ALL')} className="shrink-0 underline hover:text-white uppercase text-[10px] tracking-wide">
                        Të gjitha datat
                      </button>
                    </div>
                  )}

                  {!showLiveOnly && currentLeague === 'All Top Football' && topLeagueMatches.list.length > 0 && (
                    <div className="bg-brand-panel rounded overflow-hidden shadow-sm">
                      <button
                        onClick={() => { setShowLiveOnly(false); setCurrentLeague(topLeagueMatches.key!); setDetailMatchId(null); }}
                        className="w-full bg-[#2f2f2f] px-3 py-2 text-xs font-bold text-white border-b border-[#444] uppercase tracking-wider text-left hover:text-brand-yellow"
                      >
                        {topLeagueMatches.label}
                      </button>
                      <div className="flex gap-2 overflow-x-auto p-2.5 custom-scrollbar snap-x snap-mandatory">
                        {topLeagueMatches.list.map((match) => (
                          <FeaturedMatchCard
                            key={match.id}
                            match={match}
                            onBetClick={handleToggleSelection}
                            onOpenDetail={(m) => setDetailMatchId(m.id)}
                            selectedIds={selectedIds}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* "Ndeshjet Kryesore" + "Ndeshjet Sot" -- only on the
                      root/home view (not once a specific country/league is
                      selected, and not on the dedicated Live tab), same
                      placement as the reference site's homepage. */}
                  {!showLiveOnly && currentLeague === 'All Top Football' && featuredMatches.length > 0 && (
                    <div className="bg-brand-panel rounded overflow-hidden shadow-sm">
                      <div className="bg-[#2f2f2f] px-3 py-2 text-xs font-bold text-white border-b border-[#444] uppercase tracking-wider">
                        Ndeshjet Kryesore
                      </div>
                      <div className="flex gap-2 overflow-x-auto p-2.5 custom-scrollbar snap-x snap-mandatory">
                        {featuredMatches.map((match) => (
                          <FeaturedMatchCard
                            key={match.id}
                            match={match}
                            onBetClick={handleToggleSelection}
                            onOpenDetail={(m) => setDetailMatchId(m.id)}
                            selectedIds={selectedIds}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {!showLiveOnly && currentLeague === 'All Top Football' && todayMatches.length > 0 && (
                    <div className="bg-brand-panel rounded overflow-hidden shadow-sm">
                      <button
                        onClick={() => setIsTodaySectionOpen((o) => !o)}
                        className="w-full bg-[#2f2f2f] px-3 py-2 text-xs font-bold text-white border-b border-[#444] uppercase tracking-wider flex items-center justify-between"
                      >
                        <span>Ndeshjet Sot ({todayMatches.length})</span>
                        <span className={`transition-transform ${isTodaySectionOpen ? '' : '-rotate-90'}`}>▾</span>
                      </button>
                      {isTodaySectionOpen && (
                        <div className="divide-y divide-brand-divider">
                          {todayMatches.slice(0, 20).map((match) => (
                            <MatchRow
                              key={match.id}
                              match={match}
                              onBetClick={handleToggleSelection}
                              onOpenDetail={(m) => setDetailMatchId(m.id)}
                              isAdmin={currentUser.role === UserRole.ADMIN}
                              onSettleMatch={handleSettleMatch}
                              isSimulating={simulatingMatchId === match.id}
                              selectedIds={selectedIds}
                              favoriteTeams={favoriteTeams}
                              onToggleFavoriteTeam={(team) => toggleFavorite('TEAM', team)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Upcoming — grouped like the London site: Shtet -> Ligue -> ndeshje */}
                  {showLiveOnly ? null : matchesByCountry.length === 0 ? (
                    <div className="flex flex-col justify-center items-center h-64 bg-brand-panel rounded border border-brand-divider text-center px-6">
                      <div className="text-brand-textMuted text-sm mb-2">Asnjë ndeshje e disponueshme.</div>
                      <div className="text-brand-textMuted text-xs opacity-70">
                        {selectedDate !== 'ALL'
                          ? 'Nuk ka ndeshje të planifikuara për këtë datë në këtë kampionat. Provo "Të gjitha" ose një datë tjetër.'
                          : 'Ky kampionat mund të jetë aktualisht pa ndeshje të planifikuara (pushim sezonal) — provo përsëri më vonë, ose zgjidh një kampionat tjetër nga lista.'}
                      </div>
                    </div>
                  ) : (
                    matchesByCountry.map(([country, leagues]: [string, [string, Match[]][]]) => (
                      <div key={country} className="bg-brand-panel rounded overflow-hidden shadow-sm">
                        <div className="bg-[#2f2f2f] px-3 py-2 text-xs font-bold text-white border-b border-[#444] flex items-center gap-2 uppercase tracking-wider">
                          <span aria-hidden="true">{countryFlag(country)}</span>
                          <span>{country}</span>
                          <span className="ml-auto text-[10px] text-brand-textMuted font-normal">{leagues.length} ligë</span>
                        </div>
                        {leagues.map(([league, leagueMatches]: [string, Match[]]) => (
                          <div key={league} className="border-b border-brand-divider last:border-b-0">
                            <div className="bg-[#383838] px-3 py-2 text-xs font-bold text-white flex items-center gap-2">
                              <span className="w-1 h-3 rounded-full bg-brand-yellow"></span>
                              <span>{leagueLabel(league)}</span>
                              <span className="ml-auto text-[10px] text-brand-textMuted font-normal">{leagueMatches.length}</span>
                            </div>
                            {groupMatchesByDate(leagueMatches).map(([dateKey, dayMatches]) => (
                              <div key={dateKey}>
                                <div className="bg-[#2b2b2b] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 border-b border-brand-bg/20">
                                  <span className="text-brand-yellow">{dateKeyLabel(dateKey)}</span>
                                  <span className="text-brand-textMuted font-normal normal-case">{dayMatches.length} ndeshje</span>
                                </div>
                                <div className="divide-y divide-brand-divider">
                                  {dayMatches.map((match) => (
                                    <MatchRow
                                      key={match.id}
                                      match={match}
                                      onBetClick={handleToggleSelection}
                                      onOpenDetail={(m) => setDetailMatchId(m.id)}
                                      isAdmin={currentUser.role === UserRole.ADMIN}
                                      onSettleMatch={handleSettleMatch}
                                      isSimulating={simulatingMatchId === match.id}
                                      selectedIds={selectedIds}
                                      favoriteTeams={favoriteTeams}
                                      onToggleFavoriteTeam={(team) => toggleFavorite('TEAM', team)}
                                    />
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          )}
        </main>

        {currentView === 'sports' && (
          <aside className="w-80 hidden md:flex flex-col flex-shrink-0">
            <div className="bg-brand-panel rounded overflow-hidden shadow-sm flex-1 max-h-[calc(100vh-100px)] sticky top-20">
              {betError && (
                <div className="bg-red-900/30 border-b border-red-900/50 text-red-300 text-xs p-2 text-center">
                  {betError}
                </div>
              )}
              <BetSlip
                selections={selections}
                onRemoveSelection={(id) => setSelections((p) => p.filter((x) => uniqueId(x.matchId, x.marketId, x.selectionId) !== id))}
                onClearAll={() => setSelections([])}
                onPlaceBet={handlePlaceBet}
                onCancelBet={handleCancelBet}
                userBalance={currentUser.balance}
                myBets={myBets}
              />
            </div>
          </aside>
        )}
      </div>

      {currentView === 'sports' && (
        <>
          <div className="fixed bottom-4 right-4 md:hidden z-40">
            <button
              onClick={() => setIsMobileSlipOpen(true)}
              className="bg-brand-yellow text-black font-bold rounded-full w-14 h-14 shadow-2xl flex items-center justify-center relative border-2 border-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              {selections.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
                  {selections.length}
                </span>
              )}
            </button>
          </div>

          {isMobileSlipOpen && (
            <div className="fixed inset-0 z-50 md:hidden bg-black/50 backdrop-blur-sm flex justify-end animate-in slide-in-from-bottom">
              <div className="w-full h-full bg-brand-panel flex flex-col">
                <div className="flex justify-between items-center p-4 bg-brand-header text-white shadow-lg">
                  <span className="font-bold">Bet Slip</span>
                  <button onClick={() => setIsMobileSlipOpen(false)} className="text-white font-bold p-2">Close &times;</button>
                </div>
                <div className="flex-1 overflow-hidden">
                  {betError && (
                    <div className="bg-red-900/30 border-b border-red-900/50 text-red-300 text-xs p-2 text-center">
                      {betError}
                    </div>
                  )}
                  <BetSlip
                    selections={selections}
                    onRemoveSelection={(id) => setSelections((p) => p.filter((x) => uniqueId(x.matchId, x.marketId, x.selectionId) !== id))}
                    onClearAll={() => setSelections([])}
                    onPlaceBet={handlePlaceBet}
                    onCancelBet={handleCancelBet}
                    userBalance={currentUser.balance}
                    myBets={myBets}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
};

export default App;
