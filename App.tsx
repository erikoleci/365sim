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
  // Load users from local storage to ensure they are not deleted on reload
  const [users, setUsers] = useState<User[]>(() => {
      const savedUsers = localStorage.getItem('betsim_users');
      return savedUsers ? JSON.parse(savedUsers) : INITIAL_USERS;
  });

  // Matches start empty to satisfy "No fake matches" request
  const [matches, setMatches] = useState<Match[]>([]);
  
  // Load bets from local storage
  const [bets, setBets] = useState<Bet[]>(() => {
      const savedBets = localStorage.getItem('betsim_bets');
      return savedBets ? JSON.parse(savedBets) : [];
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
  
  // Search State
  const [searchQuery, setSearchQuery] = useState('');

  // Bet Slip State
  const [selections, setSelections] = useState<BetSelectionItem[]>([]);

  // --- PERSISTENCE EFFECTS ---
  useEffect(() => {
      localStorage.setItem('betsim_users', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
      localStorage.setItem('betsim_bets', JSON.stringify(bets));
  }, [bets]);

  // Load Data
  useEffect(() => {
    if (currentView !== 'sports') return;

    const loadRealData = async () => {
      setIsLoading(true);
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


  // --- OPTIMIZED REAL TIME ODDS ENGINE ---
  useEffect(() => {
    if (matches.length === 0) return;

    const interval = setInterval(() => {
        setMatches(prevMatches => {
            let hasChanges = false;
            const nextMatches = prevMatches.map(match => {
                if (match.status === MatchStatus.LIVE) {
                    // Update odds with 30% probability per second per match for "Alive" feel
                    // This prevents re-rendering every single row every second
                    const shouldUpdate = Math.random() < 0.3;

                    if (shouldUpdate) {
                         hasChanges = true;
                         // Clock tick simulation (very slow, 1% chance per second ~ 1 min per 100s)
                         let newMinute = match.currentMinute;
                         if (Math.random() < 0.02) {
                             let minNum = parseInt(newMinute?.replace("'", "") || "0");
                             if (!isNaN(minNum) && minNum < 90 && !newMinute?.includes('+')) {
                                 minNum++;
                                 newMinute = `${minNum}'`;
                             }
                         }

                         return {
                            ...match,
                            currentMinute: newMinute,
                            markets: match.markets.map(market => ({
                                ...market,
                                options: market.options.map(opt => ({
                                    ...opt,
                                    // Micro fluctuation
                                    odds: Math.max(1.01, Number((opt.odds + (Math.random() * 0.04 - 0.02)).toFixed(2)))
                                }))
                            }))
                         };
                    }
                }
                // Return same reference if no update
                return match;
            });
            return hasChanges ? nextMatches : prevMatches;
        });
    }, 1000); // 1 Second Interval for responsiveness

    return () => clearInterval(interval);
  }, [matches.length]);


  // Filtering
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

  // --- Dynamic League List for Sidebar ---
  const dynamicLeagues = useMemo(() => {
      const fetchedLeagues = Array.from(new Set(matches.map(m => m.league)));
      const standardLeagues = [
        'All Top Football',
        'Champions League',
        'Premier League',
        'La Liga',
        'Serie A',
        'Bundesliga',
        'Ligue 1',
        'Europa League',
        'Albanian Superliga'
      ];
      // Merge unique leagues and sort
      return Array.from(new Set([...standardLeagues, ...fetchedLeagues])).sort();
  }, [matches]);

  // --- Handlers & Memoization ---
  
  // Memoize selected IDs to prevent unnecessary MatchRow re-renders
  const uniqueId = (matchId: string, marketId: string, selId: string) => `${matchId}-${marketId}-${selId}`;
  const selectedIds = useMemo(() => 
    selections.map(s => uniqueId(s.matchId, s.marketId, s.selectionId)), 
  [selections]);

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
  
  const handleResetPassword = (userId: string, newPass: string) => {
      setUsers(prevUsers => prevUsers.map(u => {
          if (u.id === userId) {
              return { ...u, password: newPass };
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

  // --- Betting Handlers (Memoized) ---
  const handleToggleSelection = useCallback((match: Match, marketId: string, selectionId: string) => {
    if (!currentUser) return;
    
    const market = match.markets.find(m => m.id === marketId);
    const option = market?.options.find(o => o.id === selectionId);
    if (!market || !option) return;

    const uId = uniqueId(match.id, marketId, selectionId);
    
    setSelections(prev => {
        // Check if exists in current state (using the previous state to be safe, though uId calc used closure)
        // Re-calculating uniqueness check inside setter for correctness with prev state
        const exists = prev.some(s => uniqueId(s.matchId, s.marketId, s.selectionId) === uId);
        
        if (exists) {
            return prev.filter(s => uniqueId(s.matchId, s.marketId, s.selectionId) !== uId);
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
            return [...prev, newSel];
        }
    });
  }, [currentUser]);

  const handleRemoveSelection = useCallback((uId: string) => {
    setSelections(prev => prev.filter(s => uniqueId(s.matchId, s.marketId, s.selectionId) !== uId));
  }, []);

  const handlePlaceBet = useCallback((stake: number, type: 'SINGLE' | 'ACCUMULATOR') => {
    if (!currentUser || selections.length === 0) return;
    
    // Optimistic update
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
  }, [currentUser, selections]);

  // --- Ticket Cancellation Logic ---
  const handleCancelBet = useCallback((betId: string, origin: 'USER' | 'ADMIN') => {
      const bet = bets.find(b => b.id === betId);
      if (!bet) return;

      // Logic for User cancellation
      if (origin === 'USER') {
          // Check time limit (10 minutes)
          const timeDiff = Date.now() - bet.timestamp;
          if (timeDiff > 10 * 60 * 1000) {
              alert("Tickets can only be deleted within 10 minutes of placement.");
              return;
          }
          // Only pending bets
          if (bet.status !== BetStatus.PENDING) {
              alert("Cannot delete settled tickets.");
              return;
          }
          if (!confirm("Are you sure you want to cancel this ticket? Stake will be refunded.")) return;
      }
      
      // Logic for Admin cancellation (always allowed)
      if (origin === 'ADMIN') {
          if (!confirm("Admin Delete: This will remove the ticket and revert balance impact. Continue?")) return;
      }

      // Calculate Balance Reversion
      let balanceAdjustment = 0;
      if (bet.status === BetStatus.PENDING) {
          balanceAdjustment = bet.stake; // Give back stake
      } else if (bet.status === BetStatus.WON) {
          // Revert win: Deduct winnings, give back stake? Or just deduct net win? 
          // Standard revert: return to state before bet.
          // User has (OldBal + Returns). We want (OldBal).
          // Adjustment = -Returns + Stake. (Basically deduct Profit). 
          // Wait, actually user PAID stake. 
          // If they WON, they got Returns. Net change was +Profit.
          // To revert, we subtract Profit and give back Stake? No.
          // Simplest: Balance = Balance - Returns + Stake.
          balanceAdjustment = bet.stake - bet.potentialReturn;
      } else if (bet.status === BetStatus.LOST) {
          // User lost stake. Revert means give back stake.
          balanceAdjustment = bet.stake;
      }

      // Update Users
      setUsers(prevUsers => prevUsers.map(u => {
          if (u.id === bet.userId) {
              const updatedUser = { ...u, balance: u.balance + balanceAdjustment };
              if (currentUser?.id === u.id) setCurrentUser(updatedUser);
              return updatedUser;
          }
          return u;
      }));

      // Remove Bet
      setBets(prev => prev.filter(b => b.id !== betId));

  }, [bets, currentUser]);


  // --- Settlement Logic ---
  const checkSelectionOutcome = (sel: BetSelectionItem, score: MatchScore): BetStatus => {
    // 1X2
    if (sel.marketId === 'm_res') {
        if (sel.selectionId === '1') return score.home > score.away ? BetStatus.WON : BetStatus.LOST;
        if (sel.selectionId === '2') return score.away > score.home ? BetStatus.WON : BetStatus.LOST;
        if (sel.selectionId === 'X') return score.home === score.away ? BetStatus.WON : BetStatus.LOST;
    }
    // Simple goals logic
    if (sel.marketId === 'm_goals_25') {
        const total = score.home + score.away;
        if (sel.selectionId === 'O2.5') return total > 2.5 ? BetStatus.WON : BetStatus.LOST;
        if (sel.selectionId === 'U2.5') return total < 2.5 ? BetStatus.WON : BetStatus.LOST;
    }
    // Fallback simulation for other markets
    return Math.random() > 0.5 ? BetStatus.WON : BetStatus.LOST; 
  };

  const handleSettleMatch = useCallback(async (match: Match) => {
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
  }, [currentUser, simulatingMatchId]);

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
                onResetPassword={handleResetPassword}
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
                            {isLiveMode ? '● LIVE NOW' : 'Next 14 Days Schedule'}
                        </div>
                        <div className="text-xl font-bold italic">
                            {isLiveMode ? 'In-Play Global' : currentLeague}
                        </div>
                        <div className="text-xs opacity-80 mt-1">
                            {isLiveMode ? '+1100 Leagues covered via Live API.' : 'Focus on Top 5 Leagues & Major Cups.'}
                        </div>
                    </div>
                    {/* Abstract background element */}
                    <div className="absolute right-0 top-0 h-full w-1/3 bg-white/5 skew-x-12 transform origin-bottom-left"></div>
                </div>

                {/* Loading / Empty States */}
                {isLoading ? (
                    <div className="flex flex-col justify-center items-center h-64 bg-brand-panel rounded border border-brand-divider">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-yellow mb-4"></div>
                        <div className="text-brand-textMuted text-xs animate-pulse">
                            {isLiveMode ? 'Scanning Live Games...' : 'Fetching 14-Day Schedule...'}
                        </div>
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
                    Data Source: Google Grounding (Global Sports Feed).
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
                        onCancelBet={handleCancelBet}
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