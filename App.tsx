import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Navbar from './components/Navbar';
import MatchRow from './components/MatchCard';
import MatchDetail from './components/MatchDetail';
import BetSlip from './components/BetSlip';
import AdminPanel from './components/AdminPanel';
import Login from './components/Login';
import CasinoHub from './components/CasinoHub';
import { User, Match, Bet, UserRole, BetStatus, BetSelectionItem, MatchScore, MatchStatus } from './types';
import { INITIAL_USERS } from './constants';
import { simulateMatchResult, fetchUpcomingMatches, fetchLiveMatches } from './services/geminiService';

const App: React.FC = () => {
  // --- Data State ---
  const [users, setUsers] = useState<User[]>(() => {
      try {
          const savedUsers = localStorage.getItem('betsim_users');
          if (savedUsers) {
              const parsed = JSON.parse(savedUsers);
              if (Array.isArray(parsed) && parsed.length > 0) return parsed;
          }
      } catch (error) {}
      return INITIAL_USERS;
  });

  const [matches, setMatches] = useState<Match[]>([]);
  
  const [bets, setBets] = useState<Bet[]>(() => {
      try {
          const savedBets = localStorage.getItem('betsim_bets');
          return savedBets ? JSON.parse(savedBets) : [];
      } catch (e) { return []; }
  });
  
  // --- UI/Auth State ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [simulatingMatchId, setSimulatingMatchId] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [detailMatchId, setDetailMatchId] = useState<string | null>(null);
  const [currentLeague, setCurrentLeague] = useState('All Top Football');
  const [isLoading, setIsLoading] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [currentView, setCurrentView] = useState<'sports' | 'casino'>('sports');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Mobile Bet Slip State
  const [isMobileSlipOpen, setIsMobileSlipOpen] = useState(false);

  // Bet Slip State
  const [selections, setSelections] = useState<BetSelectionItem[]>([]);

  // --- PERSISTENCE ---
  useEffect(() => { localStorage.setItem('betsim_users', JSON.stringify(users)); }, [users]);
  useEffect(() => { localStorage.setItem('betsim_bets', JSON.stringify(bets)); }, [bets]);

  // Load Data
  useEffect(() => {
    if (currentView !== 'sports') return;
    
    let isMounted = true;
    const loadRealData = async () => {
      if (matches.length === 0 && isMounted) setIsLoading(true);
      
      try {
        let realMatches: Match[] = [];
        if (isLiveMode) {
             realMatches = await fetchLiveMatches();
        } else {
             realMatches = await fetchUpcomingMatches(currentLeague);
        }

        if (isMounted) setMatches(realMatches.length > 0 ? realMatches : []);
      } catch (e) {
        console.error("Failed to load real data", e);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    if (currentUser) {
        if (isLiveMode) setMatches([]); 
        loadRealData();
    }
    
    let pollInterval: ReturnType<typeof setInterval>;
    if (isLiveMode && currentUser) {
        pollInterval = setInterval(loadRealData, 45000);
    }

    return () => {
        isMounted = false;
        if (pollInterval) clearInterval(pollInterval);
    };
  }, [currentLeague, isLiveMode, currentUser, currentView]);


  // --- ODDS ENGINE ---
  useEffect(() => {
    if (matches.length === 0) return;

    const interval = setInterval(() => {
        setMatches(prevMatches => {
            let hasChanges = false;
            const nextMatches = prevMatches.map(match => {
                if (match.status === MatchStatus.LIVE) {
                    const shouldUpdate = Math.random() < 0.3;

                    if (shouldUpdate) {
                         hasChanges = true;
                         let newMinute = match.currentMinute;
                         if (Math.random() < 0.02) {
                             let minNum = parseInt(newMinute?.replace("'", "") || "0");
                             if (!isNaN(minNum) && minNum < 90 && !newMinute?.includes('+')) {
                                 minNum++;
                                 newMinute = `${minNum}'`;
                             }
                         }

                         let newHomeScore = match.liveHomeScore || 0;
                         let newAwayScore = match.liveAwayScore || 0;

                         if (Math.random() < 0.002) {
                             if (Math.random() > 0.5) newHomeScore++; else newAwayScore++;
                         }

                         return {
                            ...match,
                            currentMinute: newMinute,
                            liveHomeScore: newHomeScore,
                            liveAwayScore: newAwayScore,
                            markets: match.markets.map(market => ({
                                ...market,
                                options: market.options.map(opt => ({
                                    ...opt,
                                    odds: Math.max(1.01, Number((opt.odds + (Math.random() * 0.04 - 0.02)).toFixed(2)))
                                }))
                            }))
                         };
                    }
                }
                return match;
            });
            return hasChanges ? nextMatches : prevMatches;
        });
    }, 1000);

    return () => clearInterval(interval);
  }, [matches.length]);


  // Filtering
  const filteredMatches = matches.filter(m => {
      const q = searchQuery.toLowerCase();
      const leagueMatch = currentLeague === 'All Top Football' ? true : m.league === currentLeague;
      const liveMatch = isLiveMode ? m.status === MatchStatus.LIVE : true;
      return leagueMatch && liveMatch && (m.homeTeam.toLowerCase().includes(q) || m.awayTeam.toLowerCase().includes(q) || m.league.toLowerCase().includes(q));
  });

  const detailMatch = matches.find(m => m.id === detailMatchId);
  const matchesByLeague = filteredMatches.reduce((acc, match) => {
    if (!acc[match.league]) acc[match.league] = [];
    acc[match.league].push(match);
    return acc;
  }, {} as Record<string, Match[]>);

  const dynamicLeagues = useMemo(() => {
      const fetchedLeagues = Array.from(new Set(matches.map(m => m.league)));
      const standardLeagues = ['All Top Football', 'Champions League', 'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Europa League'];
      return Array.from(new Set([...standardLeagues, ...fetchedLeagues])).sort();
  }, [matches]);

  const uniqueId = (matchId: string, marketId: string, selId: string) => `${matchId}-${marketId}-${selId}`;
  const selectedIds = useMemo(() => selections.map(s => uniqueId(s.matchId, s.marketId, s.selectionId)), [selections]);

  const handleLogin = (u: string, p: string) => {
    const user = users.find(user => user.username === u && user.password === p);
    if (user) { setCurrentUser(user); return true; }
    return false;
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setSelections([]);
    setShowAdmin(false);
    setDetailMatchId(null);
    setCurrentView('sports');
  };

  const handleCreateUser = (newUser: Omit<User, 'id' | 'role' | 'avatar'>) => {
    const u: User = {
      ...newUser,
      id: `u${Date.now()}`,
      role: UserRole.USER,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(newUser.name)}&background=random`
    };
    setUsers(prev => {
        const u2 = [...prev, u];
        localStorage.setItem('betsim_users', JSON.stringify(u2));
        return u2;
    });
  };

  const handleDeleteUser = (userId: string) => {
    setUsers(prev => {
        const u = prev.filter(u => u.id !== userId);
        localStorage.setItem('betsim_users', JSON.stringify(u));
        return u;
    });
  };

  const handleAddCredit = (userId: string, amount: number) => {
    setUsers(prev => {
        const u = prev.map(u => u.id === userId ? { ...u, balance: u.balance + amount } : u);
        localStorage.setItem('betsim_users', JSON.stringify(u));
        if (currentUser?.id === userId) setCurrentUser(u.find(x => x.id === userId)!);
        return u;
    });
  };
  
  const handleResetPassword = (userId: string, newPass: string) => {
      setUsers(prev => {
          const u = prev.map(u => u.id === userId ? { ...u, password: newPass } : u);
          localStorage.setItem('betsim_users', JSON.stringify(u));
          return u;
      });
  };

  const handleUpdateBalance = (amount: number) => {
    if (!currentUser) return;
    setUsers(prev => {
        const u = prev.map(u => u.id === currentUser.id ? { ...u, balance: u.balance + amount } : u);
        if (currentUser) setCurrentUser(u.find(x => x.id === currentUser.id)!);
        localStorage.setItem('betsim_users', JSON.stringify(u));
        return u;
    });
  };

  const handleToggleSelection = useCallback((match: Match, marketId: string, selectionId: string) => {
    if (!currentUser) return;
    const market = match.markets.find(m => m.id === marketId);
    const option = market?.options.find(o => o.id === selectionId);
    if (!market || !option) return;

    const uId = uniqueId(match.id, marketId, selectionId);
    
    setSelections(prev => {
        const exists = prev.some(s => uniqueId(s.matchId, s.marketId, s.selectionId) === uId);
        if (exists) return prev.filter(s => uniqueId(s.matchId, s.marketId, s.selectionId) !== uId);
        return [...prev, {
            matchId: match.id,
            matchHome: match.homeTeam,
            matchAway: match.awayTeam,
            marketId: market.id,
            marketName: market.name,
            selectionId: option.id,
            selectionName: option.name,
            odds: option.odds,
            status: BetStatus.PENDING
        }];
    });
  }, [currentUser]);

  const handlePlaceBet = useCallback((stake: number, type: 'SINGLE' | 'ACCUMULATOR') => {
    if (!currentUser || selections.length === 0) return;
    handleUpdateBalance(-stake);

    const totalOdds = selections.reduce((acc, curr) => acc * curr.odds, 1);
    const newBet: Bet = {
      id: Date.now().toString(),
      userId: currentUser.id,
      type,
      selections: [...selections], 
      stake,
      totalOdds,
      potentialReturn: stake * totalOdds,
      status: BetStatus.PENDING,
      timestamp: Date.now(),
      matchDetails: { homeTeam: selections[0].matchHome, awayTeam: selections[0].matchAway }
    };

    setBets(prev => {
        const b = [newBet, ...prev];
        localStorage.setItem('betsim_bets', JSON.stringify(b));
        return b;
    });
    setSelections([]); 
    setIsMobileSlipOpen(false); // Close mobile slip after bet
  }, [currentUser, selections]);

  const handleCancelBet = useCallback((betId: string, origin: 'USER' | 'ADMIN') => {
      const bet = bets.find(b => b.id === betId);
      if (!bet) return;

      if (origin === 'USER') {
          if (Date.now() - bet.timestamp > 600000) return alert("Too late to cancel.");
          if (bet.status !== BetStatus.PENDING) return alert("Cannot cancel settled bets.");
          if (!window.confirm("Cancel ticket?")) return;
      } else {
          if (!window.confirm("Admin delete?")) return;
      }

      let adjustment = 0;
      if (bet.status === BetStatus.PENDING || bet.status === BetStatus.LOST) adjustment = bet.stake;
      else if (bet.status === BetStatus.WON) adjustment = bet.stake - bet.potentialReturn;

      if (adjustment !== 0) handleUpdateBalance(adjustment);

      setBets(prev => {
          const b = prev.filter(x => x.id !== betId);
          localStorage.setItem('betsim_bets', JSON.stringify(b));
          return b;
      });
  }, [bets, currentUser]);

  const handleSettleMatch = useCallback(async (match: Match) => {
    if (simulatingMatchId) return;
    setSimulatingMatchId(match.id);

    try {
      const result = await simulateMatchResult(match);
      const finishedMatch: Match = { ...match, status: MatchStatus.FINISHED, score: result.score, summary: result.summary };

      setMatches(prev => prev.map(m => m.id === match.id ? finishedMatch : m));
      
      setBets(prevBets => {
        const updatedBets = [...prevBets];
        const usersToUpdate: Record<string, number> = {};

        updatedBets.forEach((bet, betIdx) => {
             if (bet.status === BetStatus.PENDING) {
                 let allLegsWon = true;
                 let anyLegLost = false;

                 const updatedSelections = bet.selections.map(leg => {
                     if (leg.matchId === match.id) {
                         let outcome = BetStatus.LOST;
                         // Logic check
                         if (leg.marketId === 'm_res') {
                             const s = result.score;
                             if (leg.selectionId === '1' && s.home > s.away) outcome = BetStatus.WON;
                             else if (leg.selectionId === '2' && s.away > s.home) outcome = BetStatus.WON;
                             else if (leg.selectionId === 'X' && s.home === s.away) outcome = BetStatus.WON;
                         } else {
                             // Simple Mock
                             outcome = Math.random() > 0.5 ? BetStatus.WON : BetStatus.LOST;
                         }
                         if (outcome === BetStatus.LOST) anyLegLost = true;
                         return { ...leg, status: outcome };
                     }
                     if (leg.status === BetStatus.PENDING) allLegsWon = false; 
                     if (leg.status === BetStatus.LOST) anyLegLost = true;
                     return leg;
                 });

                 updatedBets[betIdx] = { ...bet, selections: updatedSelections };

                 if (anyLegLost) updatedBets[betIdx].status = BetStatus.LOST;
                 else if (allLegsWon) {
                     updatedBets[betIdx].status = BetStatus.WON;
                     usersToUpdate[bet.userId] = (usersToUpdate[bet.userId] || 0) + bet.potentialReturn;
                 }
             }
        });
        
        localStorage.setItem('betsim_bets', JSON.stringify(updatedBets));

        if (Object.keys(usersToUpdate).length > 0) {
            setUsers(currentUsers => {
                const next = currentUsers.map(u => usersToUpdate[u.id] ? { ...u, balance: u.balance + usersToUpdate[u.id] } : u);
                if (currentUser && usersToUpdate[currentUser.id]) setCurrentUser(next.find(u => u.id === currentUser.id)!);
                localStorage.setItem('betsim_users', JSON.stringify(next));
                return next;
            });
        }
        return updatedBets;
      });
    } catch (e) { console.error(e); } finally { setSimulatingMatchId(null); }
  }, [currentUser, simulatingMatchId]);

  if (!currentUser) return <Login onLogin={handleLogin} />;

  const myBets = bets.filter(b => b.userId === currentUser.id).sort((a,b) => b.timestamp - a.timestamp);

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text flex flex-col font-sans selection:bg-brand-header selection:text-white pb-16 md:pb-0">
      <Navbar 
        currentUser={currentUser} 
        onLogout={handleLogout} 
        onOpenAdmin={() => setShowAdmin(!showAdmin)}
        currentView={currentView}
        onNavigate={setCurrentView}
      />

      <div className="flex-1 flex max-w-[1450px] mx-auto w-full pt-4 px-2 gap-2 relative">
        
        {/* Left Sidebar - Desktop Only */}
        {currentView === 'sports' && (
            <aside className="hidden lg:block w-60 flex-shrink-0">
                <div className="bg-brand-panel rounded overflow-hidden shadow-sm">
                    <div className="bg-[#383838] px-3 py-2 text-xs font-bold text-brand-text border-b border-[#444] uppercase flex justify-between">
                        <span>Leagues</span>
                        <span className="text-[10px] bg-brand-yellow text-black px-1.5 rounded font-bold">SOCCER</span>
                    </div>
                    
                    <button onClick={() => { setIsLiveMode(true); setDetailMatchId(null); }} className={`w-full text-left px-3 py-3 border-b border-brand-bg/10 flex justify-between items-center group transition-colors ${isLiveMode ? 'bg-[#444] text-brand-yellow font-bold border-l-4 border-l-brand-accent' : 'hover:bg-[#444] hover:text-white'}`}>
                        <div className="flex items-center gap-2">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-accent"></span>
                            </span>
                            <span className="uppercase tracking-wider">In-Play / Live</span>
                        </div>
                    </button>

                    <div className="flex flex-col text-xs text-brand-textMuted max-h-[80vh] overflow-y-auto custom-scrollbar">
                        {dynamicLeagues.map((league) => (
                            <button key={league} onClick={() => { setIsLiveMode(false); setCurrentLeague(league); setDetailMatchId(null); }} className={`px-3 py-2.5 hover:bg-[#444] hover:text-white transition-colors border-b border-brand-bg/10 flex justify-between items-center group text-left w-full ${currentLeague === league && !isLiveMode ? 'bg-[#444] text-white font-bold border-l-4 border-l-brand-yellow' : 'pl-4'}`}>
                                {league}
                                <span className="hidden group-hover:block text-[10px] text-brand-textMuted">›</span>
                            </button>
                        ))}
                    </div>
                </div>
            </aside>
        )}

        {/* Center Content */}
        <main className="flex-1 min-w-0 mb-20 md:mb-0">
          {showAdmin && currentUser.role === UserRole.ADMIN ? (
            <AdminPanel 
                users={users} allBets={bets}
                onCreateUser={handleCreateUser} onDeleteUser={handleDeleteUser}
                onAddCredit={handleAddCredit} onResetPassword={handleResetPassword}
                onCancelBet={handleCancelBet}
            />
          ) : currentView === 'casino' ? (
              <CasinoHub userBalance={currentUser.balance} onUpdateBalance={handleUpdateBalance} />
          ) : detailMatch ? (
             <MatchDetail 
                match={detailMatch} 
                onClose={() => setDetailMatchId(null)}
                onBetClick={handleToggleSelection}
                selectedIds={selectedIds}
             />
          ) : (
              <div className="space-y-4">
                {/* Mobile League Selector (Visible only on Mobile) */}
                <div className="lg:hidden flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                    <button onClick={() => setIsLiveMode(true)} className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold ${isLiveMode ? 'bg-brand-accent text-black' : 'bg-brand-panel text-white'}`}>LIVE</button>
                    {dynamicLeagues.map(l => (
                         <button key={l} onClick={() => { setIsLiveMode(false); setCurrentLeague(l); }} className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold ${currentLeague === l && !isLiveMode ? 'bg-brand-yellow text-black' : 'bg-brand-panel text-white'}`}>{l}</button>
                    ))}
                </div>

                <div className="bg-brand-panel p-3 rounded flex items-center gap-2 border border-brand-divider">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-brand-textMuted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    <input type="text" placeholder="Search teams..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="bg-transparent text-white text-sm w-full outline-none placeholder-brand-textMuted" />
                </div>

                {isLoading ? (
                    <div className="flex flex-col justify-center items-center h-64 bg-brand-panel rounded border border-brand-divider">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-yellow mb-4"></div>
                        <div className="text-brand-textMuted text-xs animate-pulse">Scanning...</div>
                    </div>
                ) : (
                    Object.entries(matchesByLeague).map(([league, leagueMatches]: [string, Match[]]) => (
                        <div key={league} className="bg-brand-panel rounded overflow-hidden shadow-sm">
                            <div className="bg-[#383838] px-3 py-2 text-xs font-bold text-white border-b border-[#444] flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <span className={`w-1 h-3 rounded-full ${isLiveMode ? 'bg-brand-accent animate-pulse' : 'bg-brand-yellow'}`}></span>
                                    <span>{league}</span>
                                </div>
                            </div>
                            <div className="divide-y divide-brand-divider">
                                {leagueMatches.map(match => (
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
              </div>
          )}
        </main>

        {/* Right Sidebar: Bet Slip (Desktop) */}
        {currentView === 'sports' && (
            <aside className="w-80 hidden md:flex flex-col flex-shrink-0">
                <div className="bg-brand-panel rounded overflow-hidden shadow-sm flex-1 max-h-[calc(100vh-100px)] sticky top-20">
                    <BetSlip 
                        selections={selections}
                        onRemoveSelection={(id) => setSelections(p => p.filter(x => uniqueId(x.matchId, x.marketId, x.selectionId) !== id))}
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

      {/* MOBILE BET SLIP TOGGLE & DRAWER */}
      {currentView === 'sports' && (
          <>
            {/* Floating Action Button (Mobile Only) */}
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

            {/* Mobile Drawer */}
            {isMobileSlipOpen && (
                <div className="fixed inset-0 z-50 md:hidden bg-black/50 backdrop-blur-sm flex justify-end animate-in slide-in-from-bottom">
                    <div className="w-full h-full bg-brand-panel flex flex-col">
                        <div className="flex justify-between items-center p-4 bg-brand-header text-white shadow-lg">
                            <span className="font-bold">Bet Slip</span>
                            <button onClick={() => setIsMobileSlipOpen(false)} className="text-white font-bold p-2">Close ✕</button>
                        </div>
                        <div className="flex-1 overflow-hidden">
                            <BetSlip 
                                selections={selections}
                                onRemoveSelection={(id) => setSelections(p => p.filter(x => uniqueId(x.matchId, x.marketId, x.selectionId) !== id))}
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