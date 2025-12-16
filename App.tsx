import React, { useState, useEffect, useMemo } from 'react';
import Navbar from './components/Navbar';
import MatchRow from './components/MatchCard';
import MatchDetail from './components/MatchDetail';
import BetSlip from './components/BetSlip';
import AdminPanel from './components/AdminPanel';
import Login from './components/Login';
import CasinoHub from './components/CasinoHub';
import { User, Match, Bet, UserRole, BetStatus, BetSelectionItem, MatchScore, MatchStatus } from './types';
import { INITIAL_USERS, INITIAL_MATCHES } from './constants';
import { simulateMatchResult, fetchUpcomingMatches, fetchLiveMatches } from './services/geminiService';

const App: React.FC = () => {
  // --- Data State ---
  const [users, setUsers] = useState<User[]>(INITIAL_USERS);
  // Initialize EMPTY so no fake matches appear
  const [matches, setMatches] = useState<Match[]>([]);
  const [bets, setBets] = useState<Bet[]>([]);
  
  // --- UI/Auth State ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [simulatingMatchId, setSimulatingMatchId] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [detailMatchId, setDetailMatchId] = useState<string | null>(null);
  const [currentLeague, setCurrentLeague] = useState('All Top Football');
  const [isLoading, setIsLoading] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [currentView, setCurrentView] = useState<'sports' | 'casino'>('sports');
  
  // Search State
  const [searchQuery, setSearchQuery] = useState('');

  // Bet Slip State
  const [selections, setSelections] = useState<BetSelectionItem[]>([]);

  // Load Data (Real or Live) - ONLY if in Sports View
  useEffect(() => {
    if (currentView !== 'sports') return;

    const loadRealData = async () => {
      setIsLoading(true);
      // We do NOT clear matches immediately if switching leagues to prevent flickering, 
      // but we do if switching to live mode to ensure freshness.
      if(isLiveMode) setMatches([]); 
      
      try {
        let realMatches: Match[] = [];
        if (isLiveMode) {
             realMatches = await fetchLiveMatches();
        } else {
             realMatches = await fetchUpcomingMatches(currentLeague);
        }

        if (realMatches.length > 0) {
            setMatches(realMatches);
        }
      } catch (e) {
        console.error("Failed to load real data", e);
      } finally {
        setIsLoading(false);
      }
    };

    if (currentUser) {
        loadRealData();
    }
  }, [currentLeague, isLiveMode, currentUser, currentView]);


  // --- REAL TIME SIMULATION ENGINE ---
  // This makes the odds move and game clock tick for the REAL matches fetched
  useEffect(() => {
    if (matches.length === 0) return;

    const interval = setInterval(() => {
        setMatches(prevMatches => {
            return prevMatches.map(match => {
                // 1. Live Games: Tick clock and maybe score
                if (match.status === MatchStatus.LIVE) {
                    let newMinute = match.currentMinute;
                    // Only simulate tick if it looks like a time string (e.g. 45')
                    // If it's "HT" or "FT", leave it.
                    let minNum = parseInt(newMinute?.replace("'", "") || "0");
                    if (!isNaN(minNum) && minNum < 90 && !newMinute?.includes('+')) {
                        minNum++;
                        newMinute = `${minNum}'`;
                    }
                    
                    // Note: We are NOT simulating random goals anymore per user request for "No fake".
                    // The matches will update their score only when re-fetched (or if we added polling).
                    // We only animate the clock visually.

                    return {
                        ...match,
                        currentMinute: newMinute,
                        markets: match.markets.map(market => ({
                            ...market,
                            options: market.options.map(opt => ({
                                ...opt,
                                // Fluctuate odds significantly for live games
                                odds: Math.max(1.01, Number((opt.odds + (Math.random() * 0.1 - 0.05)).toFixed(2)))
                            }))
                        }))
                    };
                }
                return match;
            });
        });
    }, 5000); // Slower updates

    return () => clearInterval(interval);
  }, [matches.length]);


  // Derived state (Filtered by Search)
  const filteredMatches = matches.filter(m => {
      const q = searchQuery.toLowerCase();
      
      const leagueMatch = currentLeague === 'All Top Football' ? true : m.league === currentLeague;
      const liveMatch = isLiveMode ? m.status === MatchStatus.LIVE : true;

      return (
          leagueMatch &&
          liveMatch &&
          (m.homeTeam.toLowerCase().includes(q) ||
          m.awayTeam.toLowerCase().includes(q) ||
          m.league.toLowerCase().includes(q))
      );
  });

  const detailMatch = matches.find(m => m.id === detailMatchId);
  const matchesByLeague = filteredMatches.reduce((acc, match) => {
    if (!acc[match.league]) acc[match.league] = [];
    acc[match.league].push(match);
    return acc;
  }, {} as Record<string, Match[]>);

  // --- Dynamic League List ---
  // Extract all unique leagues from the currently fetched matches + standard ones
  const dynamicLeagues = useMemo(() => {
      const fetchedLeagues = Array.from(new Set(matches.map(m => m.league)));
      const standardLeagues = [
        'All Top Football',
        'Albanian Superliga',
        'Champions League',
        'Premier League',
        'La Liga',
        'Serie A',
        'Bundesliga',
        'Ligue 1'
      ];
      // Merge and deduplicate
      return Array.from(new Set([...standardLeagues, ...fetchedLeagues])).sort();
  }, [matches]);

  // --- Helpers ---
  const uniqueId = (matchId: string, marketId: string, selId: string) => `${matchId}-${marketId}-${selId}`;
  const selectedIds = selections.map(s => uniqueId(s.matchId, s.marketId, s.selectionId));

  // --- Handlers ---
  const handleLogin = (u: string, p: string) => {
    const user = users.find(user => user.username === u && user.password === p);
    if (user) {
      setCurrentUser(user);
      return true;
    }
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
    setUsers([...users, u]);
  };

  const handleDeleteUser = (userId: string) => {
    setUsers(users.filter(u => u.id !== userId));
  };

  const handleAddCredit = (userId: string, amount: number) => {
    setUsers(prevUsers => prevUsers.map(u => {
      if (u.id === userId) {
        const updated = { ...u, balance: u.balance + amount };
        if (currentUser?.id === u.id) setCurrentUser(updated);
        return updated;
      }
      return u;
    }));
  };

  const handleUpdateBalance = (amount: number) => {
    if (!currentUser) return;
    const newBalance = currentUser.balance + amount;
    const updatedUser = { ...currentUser, balance: newBalance };
    
    setCurrentUser(updatedUser);
    setUsers(prev => prev.map(u => u.id === currentUser.id ? updatedUser : u));
  };

  // --- Betting Handlers ---
  const handleToggleSelection = (match: Match, marketId: string, selectionId: string) => {
    if (!currentUser) return;
    
    const market = match.markets.find(m => m.id === marketId);
    const option = market?.options.find(o => o.id === selectionId);
    if (!market || !option) return;

    const uId = uniqueId(match.id, marketId, selectionId);
    
    if (selectedIds.includes(uId)) {
        setSelections(prev => prev.filter(s => uniqueId(s.matchId, s.marketId, s.selectionId) !== uId));
    } else {
        const newSel: BetSelectionItem = {
            matchId: match.id,
            matchHome: match.homeTeam,
            matchAway: match.awayTeam,
            marketId: market.id,
            marketName: market.name,
            selectionId: option.id,
            selectionName: option.name,
            odds: option.odds,
            status: BetStatus.PENDING
        };
        setSelections(prev => [...prev, newSel]);
    }
  };

  const handleRemoveSelection = (uId: string) => {
    setSelections(prev => prev.filter(s => uniqueId(s.matchId, s.marketId, s.selectionId) !== uId));
  };

  const handlePlaceBet = (stake: number, type: 'SINGLE' | 'ACCUMULATOR') => {
    if (!currentUser || selections.length === 0) return;
    const updatedUser = { ...currentUser, balance: currentUser.balance - stake };
    setCurrentUser(updatedUser);
    setUsers(prevUsers => prevUsers.map(u => u.id === currentUser.id ? updatedUser : u));

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
      matchDetails: {
          homeTeam: selections[0].matchHome, 
          awayTeam: selections[0].matchAway
      }
    };

    setBets(prev => [newBet, ...prev]);
    setSelections([]); 
  };

  // --- Settlement Logic ---
  const checkSelectionOutcome = (sel: BetSelectionItem, score: MatchScore): BetStatus => {
    // 1X2
    if (sel.marketId === 'm_res') {
        if (sel.selectionId === '1') return score.home > score.away ? BetStatus.WON : BetStatus.LOST;
        if (sel.selectionId === '2') return score.away > score.home ? BetStatus.WON : BetStatus.LOST;
        if (sel.selectionId === 'X') return score.home === score.away ? BetStatus.WON : BetStatus.LOST;
    }
    // Simple logic for other markets for simulation
    if (sel.marketId === 'm_goals_25') {
        const total = score.home + score.away;
        if (sel.selectionId === 'O2.5') return total > 2.5 ? BetStatus.WON : BetStatus.LOST;
        if (sel.selectionId === 'U2.5') return total < 2.5 ? BetStatus.WON : BetStatus.LOST;
    }
    return Math.random() > 0.5 ? BetStatus.WON : BetStatus.LOST; // Fallback
  };

  const handleSettleMatch = async (match: Match) => {
    if (simulatingMatchId) return;
    setSimulatingMatchId(match.id);

    try {
      const result = await simulateMatchResult(match);

      const finishedMatch: Match = {
        ...match,
        status: MatchStatus.FINISHED,
        score: result.score,
        summary: result.summary
      };

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
                         const outcome = checkSelectionOutcome(leg, result.score);
                         if (outcome === BetStatus.LOST) anyLegLost = true;
                         return { ...leg, status: outcome };
                     }
                     if (leg.status === BetStatus.PENDING) allLegsWon = false; 
                     if (leg.status === BetStatus.LOST) anyLegLost = true;
                     return leg;
                 });

                 updatedBets[betIdx] = { ...bet, selections: updatedSelections };

                 if (anyLegLost) {
                     updatedBets[betIdx].status = BetStatus.LOST;
                 } else if (allLegsWon) {
                     updatedBets[betIdx].status = BetStatus.WON;
                     usersToUpdate[bet.userId] = (usersToUpdate[bet.userId] || 0) + bet.potentialReturn;
                 }
             }
        });

        if (Object.keys(usersToUpdate).length > 0) {
            setUsers(currentUsers => {
                const nextUsers = currentUsers.map(u => {
                    if (usersToUpdate[u.id]) return { ...u, balance: u.balance + usersToUpdate[u.id] };
                    return u;
                });
                if (currentUser && usersToUpdate[currentUser.id]) {
                    const fresh = nextUsers.find(u => u.id === currentUser.id);
                    if (fresh) setCurrentUser(fresh);
                }
                return nextUsers;
            });
        }

        return updatedBets;
      });

    } catch (error) {
      console.error("Failed to settle", error);
    } finally {
      setSimulatingMatchId(null);
    }
  };


  // --- Render ---

  if (!currentUser) {
    return <Login onLogin={handleLogin} />;
  }

  const myBets = bets.filter(b => b.userId === currentUser.id).sort((a,b) => b.timestamp - a.timestamp);

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text flex flex-col font-sans selection:bg-brand-header selection:text-white">
      <Navbar 
        currentUser={currentUser} 
        onLogout={handleLogout} 
        onOpenAdmin={() => setShowAdmin(!showAdmin)}
        currentView={currentView}
        onNavigate={setCurrentView}
      />

      <div className="flex-1 flex max-w-[1450px] mx-auto w-full pt-4 px-2 gap-2">
        
        {/* Left Sidebar - Navigation */}
        {currentView === 'sports' && (
            <aside className="hidden lg:block w-60 flex-shrink-0">
            <div className="bg-brand-panel rounded overflow-hidden shadow-sm">
                <div className="bg-[#383838] px-3 py-2 text-xs font-bold text-brand-text border-b border-[#444] uppercase flex justify-between">
                    <span>Leagues</span>
                    <span className="text-[10px] bg-brand-yellow text-black px-1.5 rounded font-bold">SOCCER</span>
                </div>
                
                {/* Live Button */}
                <button
                    onClick={() => {
                        setIsLiveMode(true);
                        setDetailMatchId(null);
                    }}
                    className={`w-full text-left px-3 py-3 border-b border-brand-bg/10 flex justify-between items-center group transition-colors ${isLiveMode ? 'bg-[#444] text-brand-yellow font-bold border-l-4 border-l-brand-accent' : 'hover:bg-[#444] hover:text-white'}`}
                >
                    <div className="flex items-center gap-2">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-accent"></span>
                        </span>
                        <span className="uppercase tracking-wider">In-Play / Live</span>
                    </div>
                    <span className="text-[10px] text-brand-textMuted group-hover:text-white">›</span>
                </button>

                <div className="flex flex-col text-xs text-brand-textMuted max-h-[80vh] overflow-y-auto custom-scrollbar">
                    {dynamicLeagues.map((league) => (
                        <button 
                            key={league} 
                            onClick={() => {
                                if (currentLeague !== league || isLiveMode) {
                                    setIsLiveMode(false);
                                    setCurrentLeague(league);
                                    setDetailMatchId(null);
                                }
                            }}
                            className={`px-3 py-2.5 hover:bg-[#444] hover:text-white transition-colors border-b border-brand-bg/10 flex justify-between items-center group text-left w-full ${currentLeague === league && !isLiveMode ? 'bg-[#444] text-white font-bold border-l-4 border-l-brand-yellow' : 'pl-4'}`}
                        >
                            {league}
                            <span className="hidden group-hover:block text-[10px] text-brand-textMuted">›</span>
                        </button>
                    ))}
                </div>
            </div>
            </aside>
        )}

        {/* Center Content */}
        <main className="flex-1 min-w-0">
          {showAdmin && currentUser.role === UserRole.ADMIN ? (
            <AdminPanel 
                users={users} 
                allBets={bets}
                onCreateUser={handleCreateUser}
                onDeleteUser={handleDeleteUser}
                onAddCredit={handleAddCredit}
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
                {/* Search Bar Area */}
                <div className="bg-brand-panel p-3 rounded flex items-center gap-2 border border-brand-divider">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-brand-textMuted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input 
                        type="text" 
                        placeholder="Search teams or leagues..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-transparent text-white text-sm w-full outline-none placeholder-brand-textMuted"
                    />
                </div>

                {/* Promo / Hero Banner */}
                <div className="bg-gradient-to-r from-brand-headerDark to-[#0e4e3b] p-4 rounded text-white shadow-sm flex justify-between items-center relative overflow-hidden">
                    <div className="z-10 relative">
                        <div className="text-brand-yellow text-xs font-bold uppercase mb-1 animate-pulse">
                            {isLiveMode ? '● LIVE NOW' : 'Upcoming Schedule'}
                        </div>
                        <div className="text-xl font-bold italic">
                            {isLiveMode ? 'In-Play Global' : currentLeague}
                        </div>
                        <div className="text-xs opacity-80 mt-1">
                            {isLiveMode ? 'Real-time scores via Google.' : 'Official schedule & odds.'}
                        </div>
                    </div>
                    {/* Abstract background element */}
                    <div className="absolute right-0 top-0 h-full w-1/3 bg-white/5 skew-x-12 transform origin-bottom-left"></div>
                </div>

                {/* Loading / Empty States */}
                {isLoading ? (
                    <div className="flex flex-col justify-center items-center h-64 bg-brand-panel rounded border border-brand-divider">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-yellow mb-4"></div>
                        <div className="text-brand-textMuted text-xs animate-pulse">Connecting to API...</div>
                    </div>
                ) : matchesByLeague && Object.keys(matchesByLeague).length === 0 ? (
                    <div className="bg-brand-panel p-8 rounded text-center text-brand-textMuted border border-brand-divider">
                        {isLiveMode ? 'No live matches found right now.' : `No upcoming matches found for ${currentLeague}.`}
                        <br/>Try searching for a different league.
                    </div>
                ) : (
                    Object.entries(matchesByLeague).map(([league, leagueMatches]: [string, Match[]]) => (
                        <div key={league} className="bg-brand-panel rounded overflow-hidden shadow-sm">
                            <div className="bg-[#383838] px-3 py-2 text-xs font-bold text-white border-b border-[#444] flex justify-between items-center group cursor-pointer hover:bg-[#404040]">
                                <div className="flex items-center gap-2">
                                    <span className={`w-1 h-3 rounded-full ${isLiveMode ? 'bg-brand-accent animate-pulse' : 'bg-brand-yellow'}`}></span>
                                    <span>{league}</span>
                                </div>
                                <span className="text-[10px] text-brand-textMuted font-normal bg-black/20 px-2 py-0.5 rounded-full">Match Winner</span>
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
                
                <div className="text-[10px] text-brand-textMuted text-center mt-4">
                    Data Source: Google Grounding (Simulated Sportsbook Feed).
                </div>
              </div>
          )}
        </main>

        {/* Right Sidebar: Bet Slip */}
        {currentView === 'sports' && (
            <aside className="w-80 hidden md:flex flex-col flex-shrink-0">
                <div className="bg-brand-panel rounded overflow-hidden shadow-sm flex-1 max-h-[calc(100vh-100px)] sticky top-20">
                    <BetSlip 
                        selections={selections}
                        onRemoveSelection={handleRemoveSelection}
                        onClearAll={() => setSelections([])}
                        onPlaceBet={handlePlaceBet}
                        userBalance={currentUser.balance}
                        myBets={myBets}
                    />
                </div>
            </aside>
        )}
      </div>
    </div>
  );
};

export default App;