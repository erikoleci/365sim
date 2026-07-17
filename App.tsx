import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Navbar from './components/Navbar';
import MatchRow from './components/MatchCard';
import MatchDetail from './components/MatchDetail';
import BetSlip from './components/BetSlip';
import AdminPanel from './components/AdminPanel';
import Login from './components/Login';
import CasinoHub from './components/CasinoHub';
import { User, Match, Bet, UserRole, BetSelectionItem, MatchStatus } from './types';
import * as api from './services/api';

const App: React.FC = () => {
  // --- Auth State ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // --- Data State (from backend, not localStorage) ---
  const [matches, setMatches] = useState<Match[]>([]);
  const [hasApiKey, setHasApiKey] = useState(true); // assume true until first load tells us otherwise
  const [myBets, setMyBets] = useState<Bet[]>([]);
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [adminAllBets, setAdminAllBets] = useState<any[]>([]);

  // --- UI State ---
  const [simulatingMatchId, setSimulatingMatchId] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [detailMatchId, setDetailMatchId] = useState<string | null>(null);
  const [currentLeague, setCurrentLeague] = useState('All Top Football');
  const [selectedDate, setSelectedDate] = useState('ALL'); // 'ALL' or 'YYYY-MM-DD' (local date)
  const [isLoading, setIsLoading] = useState(false);
  const [currentView, setCurrentView] = useState<'sports' | 'casino'>('sports');
  const [searchQuery, setSearchQuery] = useState('');
  const [isMobileSlipOpen, setIsMobileSlipOpen] = useState(false);
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

  // --- Load matches from the real backend ---
  // Fetch the FULL set (no league filter) so the LIVE section can show live
  // matches from any league, and the league sidebar has the complete list.
  // All filtering (live / league / search) happens client-side below.
  const loadMatches = useCallback(async () => {
    if (!currentUser || currentView !== 'sports') return;
    setIsLoading((prev) => (matches.length === 0 ? true : prev));
    try {
      const { matches: fresh, hasLiveApiKey } = await api.fetchMatches();
      setMatches(fresh);
      setHasApiKey(hasLiveApiKey);
    } catch (e) {
      console.error('Failed to load matches', e);
    } finally {
      setIsLoading(false);
    }
  }, [currentUser, currentView, matches.length]);

  useEffect(() => {
    loadMatches();
    const interval = setInterval(loadMatches, 60000); // refresh odds every minute
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, currentView]);

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

  useEffect(() => { if (showAdmin) loadAdminData(); }, [showAdmin, loadAdminData]);

  // --- Date picker helpers (bet365-style: Sot / Nesër / next few days) ---
  // Always compare using LOCAL calendar date (not UTC) so "today" lines up
  // with the user's own day, even though the API gives UTC timestamps.
  const toLocalDateKey = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const dateOptions = useMemo(() => {
    const dayNames = ['Die', 'Hën', 'Mar', 'Mër', 'Enj', 'Pre', 'Sht'];
    const monthNames = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gus', 'Sht', 'Tet', 'Nën', 'Dhj'];
    const opts: { value: string; label: string }[] = [{ value: 'ALL', label: 'Të gjitha' }];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const label = i === 0 ? 'Sot' : i === 1 ? 'Nesër' : `${dayNames[d.getDay()]} ${d.getDate()} ${monthNames[d.getMonth()]}`;
      opts.push({ value, label });
    }
    return opts;
  }, []);

  // --- Filtering ---
  // Search applies everywhere. LIVE is always its own section at the top
  // (like a real bookmaker site), not a toggle that hides everything else.
  const searchFiltered = matches.filter((m) => {
    const q = searchQuery.toLowerCase();
    return m.homeTeam.toLowerCase().includes(q) || m.awayTeam.toLowerCase().includes(q) || m.league.toLowerCase().includes(q);
  });

  const liveMatches = searchFiltered.filter((m) => m.status === MatchStatus.LIVE);
  const upcomingMatches = searchFiltered
    .filter((m) => m.status === MatchStatus.UPCOMING)
    .filter((m) => currentLeague === 'All Top Football' || m.league === currentLeague)
    .filter((m) => selectedDate === 'ALL' || toLocalDateKey(m.startTime) === selectedDate);

  // Raw sport_keys (e.g. "soccer_brazil_campeonato") are what we store/compare
  // internally, but users should see readable names. This maps known keys to
  // Albanian display labels; anything unmapped falls back to a prettified
  // version of the key so a new/unexpected league never shows the raw slug.
  const LEAGUE_LABELS: Record<string, string> = {
    'soccer_epl': 'Anglia - Premier League',
    'soccer_spain_la_liga': 'Spanja - La Liga',
    'soccer_italy_serie_a': 'Italia - Serie A',
    'soccer_germany_bundesliga': 'Gjermania - Bundesliga',
    'soccer_france_ligue_one': 'Franca - Ligue 1',
    'soccer_uefa_champs_league': 'UEFA Champions League',
    'soccer_uefa_champs_league_qualification': 'UEFA Champions League - Kualifikuese',
    'soccer_uefa_europa_league': 'UEFA Europa League',
    'soccer_uefa_europa_conference_league': 'UEFA Conference League',
    'soccer_fifa_world_cup': 'Kampionati Botëror',
    'soccer_fifa_world_cup_qualifiers_europe': 'Kualifikueset Botërore - Evropa',
    'soccer_usa_mls': 'SHBA - MLS',
    'soccer_brazil_campeonato': 'Brazil - Serie A',
  };
  const leagueLabel = (key: string) =>
    key === 'All Top Football'
      ? 'Të Gjitha Kampionatet'
      : LEAGUE_LABELS[key] ||
        key.replace(/^soccer_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const detailMatch = matches.find((m) => m.id === detailMatchId);
  const matchesByLeague = upcomingMatches.reduce((acc, match) => {
    if (!acc[match.league]) acc[match.league] = [];
    acc[match.league].push(match);
    return acc;
  }, {} as Record<string, Match[]>);

  const dynamicLeagues = useMemo(() => {
    const fetchedLeagues = Array.from(new Set(matches.map((m) => m.league)));
    return Array.from(new Set(['All Top Football', ...fetchedLeagues])).sort();
  }, [matches]);

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
  };

  // --- Admin: user management (all calls hit the real backend now) ---
  const handleCreateUser = async (newUser: { name: string; username: string; password: string; balance: number }) => {
    try {
      await api.adminCreateUser(newUser);
      await loadAdminData();
    } catch (e: any) {
      alert(e.message || 'Failed to create user');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      await api.adminDeleteUser(userId);
      await loadAdminData();
    } catch (e: any) {
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
  const handleToggleSelection = useCallback((match: Match, marketId: string, selectionId: string) => {
    if (!currentUser) return;
    const market = match.markets.find((m) => m.id === marketId);
    const option = market?.options.find((o) => o.id === selectionId);
    if (!market || !option) return;

    const uId = uniqueId(match.id, marketId, selectionId);
    setSelections((prev) => {
      const exists = prev.some((s) => uniqueId(s.matchId, s.marketId, s.selectionId) === uId);
      if (exists) return prev.filter((s) => uniqueId(s.matchId, s.marketId, s.selectionId) !== uId);
      return [...prev, {
        matchId: match.id,
        matchHome: match.homeTeam,
        matchAway: match.awayTeam,
        marketId: market.id,
        marketName: market.name,
        selectionId: option.id,
        selectionName: option.name,
        odds: option.odds,
        status: 'PENDING' as any,
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
    // Regular users cancelling their own pending ticket is not yet exposed
    // as a dedicated endpoint (kept out of scope) — route through admin cancel
    // only when the acting user is actually an admin viewing their own bets.
    if (currentUser?.role === UserRole.ADMIN) {
      try {
        await api.adminCancelBet(betId);
        await loadMyBets();
      } catch (e: any) {
        alert(e.message || 'Failed to cancel bet');
      }
    }
  }, [currentUser, loadAdminData, loadMyBets]);

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

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text flex flex-col font-sans selection:bg-brand-header selection:text-white pb-16 md:pb-0">
      <Navbar
        currentUser={currentUser}
        onLogout={handleLogout}
        onOpenAdmin={() => setShowAdmin(!showAdmin)}
        currentView={currentView}
        onNavigate={setCurrentView}
        onGoHome={() => { setCurrentLeague('All Top Football'); setSelectedDate('ALL'); setDetailMatchId(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        onGoLive={() => { setDetailMatchId(null); document.getElementById('live-section')?.scrollIntoView({ behavior: 'smooth' }); }}
        liveCount={liveMatches.length}
      />

      <div className="flex-1 flex max-w-[1450px] mx-auto w-full pt-4 px-2 gap-2 relative">

        {currentView === 'sports' && (
          <aside className="hidden lg:block w-60 flex-shrink-0">
            <div className="bg-brand-panel rounded overflow-hidden shadow-sm">
              <div className="bg-[#383838] px-3 py-2 text-xs font-bold text-brand-text border-b border-[#444] uppercase flex justify-between">
                <span>Leagues</span>
                <span className="text-[10px] bg-brand-yellow text-black px-1.5 rounded font-bold">SOCCER</span>
              </div>

              <button onClick={() => { setDetailMatchId(null); document.getElementById('live-section')?.scrollIntoView({ behavior: 'smooth' }); }} className={`w-full text-left px-3 py-3 border-b border-brand-bg/10 flex justify-between items-center group transition-colors hover:bg-[#444] hover:text-white ${liveMatches.length === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-accent"></span>
                  </span>
                  <span className="uppercase tracking-wider">In-Play / Live</span>
                  {liveMatches.length > 0 && <span className="text-[10px] bg-brand-accent text-black px-1.5 rounded font-bold">{liveMatches.length}</span>}
                </div>
              </button>

              <div className="flex flex-col text-xs text-brand-textMuted max-h-[80vh] overflow-y-auto custom-scrollbar">
                {dynamicLeagues.map((league) => (
                  <button key={league} onClick={() => { setCurrentLeague(league); setDetailMatchId(null); }} className={`px-3 py-2.5 hover:bg-[#444] hover:text-white transition-colors border-b border-brand-bg/10 flex justify-between items-center group text-left w-full ${currentLeague === league ? 'bg-[#444] text-white font-bold border-l-4 border-l-brand-yellow' : 'pl-4'}`}>
                    {leagueLabel(league)}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        )}

        <main className="flex-1 min-w-0 mb-20 md:mb-0">
          {showAdmin && currentUser.role === UserRole.ADMIN ? (
            <AdminPanel
              users={adminUsers} allBets={adminAllBets}
              onCreateUser={handleCreateUser} onDeleteUser={handleDeleteUser}
              onAddCredit={handleAddCredit} onResetPassword={handleResetPassword}
              onCancelBet={handleCancelBet}
            />
          ) : currentView === 'casino' ? (
            <CasinoHub userBalance={currentUser.balance} onUpdateBalance={(amount) => setCurrentUser((p) => p ? { ...p, balance: p.balance + amount } : p)} />
          ) : detailMatch ? (
            <MatchDetail
              match={detailMatch}
              onClose={() => setDetailMatchId(null)}
              onBetClick={handleToggleSelection}
              selectedIds={selectedIds}
            />
          ) : (
            <div className="space-y-4">
              <div className="lg:hidden flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                <button onClick={() => document.getElementById('live-section')?.scrollIntoView({ behavior: 'smooth' })} className="whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold bg-brand-panel text-white flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-accent animate-pulse"></span>
                  LIVE {liveMatches.length > 0 && `(${liveMatches.length})`}
                </button>
                {dynamicLeagues.map((l) => (
                  <button key={l} onClick={() => setCurrentLeague(l)} className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold ${currentLeague === l ? 'bg-brand-yellow text-black' : 'bg-brand-panel text-white'}`}>{leagueLabel(l)}</button>
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

              <div className="bg-brand-panel p-3 rounded flex items-center gap-2 border border-brand-divider">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-brand-textMuted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input type="text" placeholder="Kërko skuadra..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="bg-transparent text-white text-sm w-full outline-none placeholder-brand-textMuted" />
              </div>

              {isLoading ? (
                <div className="flex flex-col justify-center items-center h-64 bg-brand-panel rounded border border-brand-divider">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-yellow mb-4"></div>
                  <div className="text-brand-textMuted text-xs animate-pulse">Duke ngarkuar ndeshjet...</div>
                </div>
              ) : (
                <>
                  {/* LIVE — always its own section, independent of the league filter */}
                  {liveMatches.length > 0 && (
                    <div id="live-section" className="bg-brand-panel rounded overflow-hidden shadow-sm border border-brand-accent/30 scroll-mt-4">
                      <div className="bg-[#2a1f1f] px-3 py-2 text-xs font-bold text-white border-b border-[#444] flex items-center gap-2">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-accent"></span>
                        </span>
                        <span className="text-brand-accent uppercase tracking-wider">Live Tani</span>
                        <span className="text-[10px] bg-brand-accent text-black px-1.5 rounded font-bold">{liveMatches.length}</span>
                      </div>
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
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Upcoming, grouped by league, filtered by sidebar selection + search */}
                  {Object.keys(matchesByLeague).length === 0 && liveMatches.length === 0 ? (
                    <div className="flex flex-col justify-center items-center h-64 bg-brand-panel rounded border border-brand-divider text-center px-6">
                      <div className="text-brand-textMuted text-sm mb-2">Asnjë ndeshje e disponueshme.</div>
                      <div className="text-brand-textMuted text-xs opacity-70">
                        {!hasApiKey
                          ? 'ODDS_API_KEY s\u2019është konfiguruar në server — vendose te .env (lokal) ose te Environment Variables (Render/hosting) dhe rinis serverin.'
                          : selectedDate !== 'ALL'
                            ? 'Nuk ka ndeshje të planifikuara për këtë datë në kampionatet e mbuluara. Provo "Të gjitha" ose një datë tjetër.'
                            : 'Kampionatet kryesore mund të jenë pushim veror (pa ndeshje të planifikuara), ose kredia mujore e The Odds API mund të jetë konsumuar. Provo përsëri më vonë.'}
                      </div>
                    </div>
                  ) : (
                    Object.entries(matchesByLeague).map(([league, leagueMatches]: [string, Match[]]) => (
                      <div key={league} className="bg-brand-panel rounded overflow-hidden shadow-sm">
                        <div className="bg-[#383838] px-3 py-2 text-xs font-bold text-white border-b border-[#444] flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <span className="w-1 h-3 rounded-full bg-brand-yellow"></span>
                            <span>{leagueLabel(league)}</span>
                          </div>
                        </div>
                        <div className="divide-y divide-brand-divider">
                          {leagueMatches.map((match) => (
                            <MatchRow
                              key={match.id}
                              match={match}
                              onBetClick={handleToggleSelection}
                              onOpenDetail={(m) => setDetailMatchId(m.id)}
                              isAdmin={currentUser.role === UserRole.ADMIN}
                              onSettleMatch={handleSettleMatch}
                              isSimulating={simulatingMatchId === match.id}
                              selectedIds={selectedIds}
                            />
                          ))}
                        </div>
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
