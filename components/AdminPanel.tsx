import React, { useState } from 'react';
import { User, UserRole, Bet, BetStatus } from '../types';

interface AdminPanelProps {
  users: User[];
  allBets: Bet[];
  onCreateUser: (u: Omit<User, 'id' | 'role' | 'avatar'>) => void;
  onDeleteUser: (userId: string) => void;
  onAddCredit: (userId: string, amount: number) => void;
  onResetPassword: (userId: string, newPass: string) => void;
  onCancelBet: (betId: string, origin: 'USER' | 'ADMIN') => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ users, allBets, onCreateUser, onDeleteUser, onAddCredit, onResetPassword, onCancelBet }) => {
  const [activeTab, setActiveTab] = useState<'users' | 'tickets'>('users');
  
  // Create User State
  const [newUser, setNewUser] = useState({ name: '', username: '', password: '', balance: 0 });
  
  // Credit State
  const [creditAmounts, setCreditAmounts] = useState<Record<string, string>>({});

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newUser.name && newUser.username && newUser.password) {
      onCreateUser(newUser);
      setNewUser({ name: '', username: '', password: '', balance: 0 });
      alert('User created successfully');
    }
  };

  const handleCreditChange = (id: string, val: string) => {
    setCreditAmounts(prev => ({ ...prev, [id]: val }));
  };

  const executeAddCredit = (id: string) => {
    const amount = parseFloat(creditAmounts[id]);
    if (amount) {
      onAddCredit(id, amount);
      setCreditAmounts(prev => ({ ...prev, [id]: '' }));
    }
  };

  // Helper to calculate user statistics
  const getUserStats = (userId: string) => {
    const userBets = allBets.filter(b => b.userId === userId);
    
    // Gjiro (Turnover) - Total amount staked regardless of result
    const turnover = userBets.reduce((acc, b) => acc + b.stake, 0);
    
    // Fituar (Won) - Total returns from won bets
    const won = userBets
        .filter(b => b.status === BetStatus.WON)
        .reduce((acc, b) => acc + b.potentialReturn, 0);

    // Humbur (Lost) - Total stakes of lost bets
    const lost = userBets
        .filter(b => b.status === BetStatus.LOST)
        .reduce((acc, b) => acc + b.stake, 0);

    return { turnover, won, lost };
  };

  const handlePasswordResetClick = (userId: string, username: string) => {
      const newPass = prompt(`Enter new password for ${username}:`);
      if (newPass && newPass.trim() !== "") {
          onResetPassword(userId, newPass);
          alert(`Password for ${username} has been updated.`);
      }
  };

  return (
    <div className="bg-brand-panel rounded border border-brand-divider shadow-lg mb-6 overflow-hidden">
      {/* Header Tabs */}
      <div className="flex border-b border-brand-divider bg-brand-bg">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-6 py-3 text-sm font-bold ${activeTab === 'users' ? 'bg-brand-panel text-white border-t-2 border-brand-yellow' : 'text-brand-textMuted hover:text-white'}`}
        >
          User Management
        </button>
        <button
          onClick={() => setActiveTab('tickets')}
          className={`px-6 py-3 text-sm font-bold ${activeTab === 'tickets' ? 'bg-brand-panel text-white border-t-2 border-brand-yellow' : 'text-brand-textMuted hover:text-white'}`}
        >
          All Tickets ({allBets.length})
        </button>
      </div>

      <div className="p-6">
        {activeTab === 'users' ? (
          <div className="space-y-8">
            {/* Create User Section */}
            <div className="bg-brand-bg p-4 rounded border border-brand-divider">
              <h3 className="text-brand-yellow font-bold mb-4 uppercase text-xs tracking-wider">Create New User</h3>
              <form onSubmit={handleCreateSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                <div>
                  <label className="text-xs text-brand-textMuted block mb-1">Full Name</label>
                  <input required className="w-full bg-brand-panel border border-brand-divider rounded p-2 text-white text-sm" 
                    value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} placeholder="John Doe" />
                </div>
                <div>
                  <label className="text-xs text-brand-textMuted block mb-1">Username</label>
                  <input required className="w-full bg-brand-panel border border-brand-divider rounded p-2 text-white text-sm" 
                    value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})} placeholder="johnny" />
                </div>
                <div>
                  <label className="text-xs text-brand-textMuted block mb-1">Password</label>
                  <input required className="w-full bg-brand-panel border border-brand-divider rounded p-2 text-white text-sm" 
                    value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} placeholder="secret" />
                </div>
                <div>
                  <label className="text-xs text-brand-textMuted block mb-1">Initial Balance (L)</label>
                  <input type="number" className="w-full bg-brand-panel border border-brand-divider rounded p-2 text-white text-sm" 
                    value={newUser.balance} onChange={e => setNewUser({...newUser, balance: parseFloat(e.target.value) || 0})} />
                </div>
                <button type="submit" className="bg-brand-header hover:bg-brand-headerDark text-white font-bold py-2 px-4 rounded text-sm transition-colors">
                  Create User
                </button>
              </form>
            </div>

            {/* User List Table */}
            <div>
              <h3 className="text-brand-yellow font-bold mb-4 uppercase text-xs tracking-wider">Existing Users & Stats</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-brand-text">
                  <thead className="bg-brand-bg text-brand-textMuted text-xs uppercase">
                    <tr>
                      <th className="p-3">User</th>
                      <th className="p-3">Role</th>
                      <th className="p-3">Balance</th>
                      <th className="p-3">Turnover (Gjiro)</th>
                      <th className="p-3">Won (Fituar)</th>
                      <th className="p-3">Lost (Humbur)</th>
                      <th className="p-3">Manage Credit</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-divider">
                    {users.map(u => {
                      const stats = getUserStats(u.id);
                      return (
                      <tr key={u.id} className="hover:bg-brand-bg/50">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <img src={u.avatar} className="w-6 h-6 rounded-full" />
                            <div>
                              <div className="font-bold">{u.name}</div>
                              <div className="text-xs text-brand-textMuted">@{u.username}</div>
                              {/* Show current password for easy admin debugging in simulation */}
                              <div className="text-[10px] text-brand-textMuted opacity-50">pw: {u.password}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3">
                          <span className={`text-xs px-2 py-1 rounded ${u.role === UserRole.ADMIN ? 'bg-purple-900 text-purple-200' : 'bg-brand-headerDark text-white'}`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="p-3 font-mono text-brand-yellow font-bold">{u.balance.toFixed(2)} L</td>
                        
                        {/* Stats Columns */}
                        <td className="p-3 font-mono text-white">{stats.turnover.toFixed(2)} L</td>
                        <td className="p-3 font-mono text-brand-accent">{stats.won.toFixed(2)} L</td>
                        <td className="p-3 font-mono text-red-400">{stats.lost.toFixed(2)} L</td>
                        
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <input 
                              type="number" 
                              className="w-20 bg-brand-bg border border-brand-divider rounded p-1 text-xs text-white"
                              placeholder="Amount"
                              value={creditAmounts[u.id] || ''}
                              onChange={(e) => handleCreditChange(u.id, e.target.value)}
                            />
                            <button 
                              onClick={() => executeAddCredit(u.id)}
                              className="bg-brand-accent text-brand-bg font-bold px-2 py-1 rounded text-xs hover:opacity-90"
                            >
                              Add
                            </button>
                          </div>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex flex-col gap-1 items-end">
                              <button 
                                onClick={() => handlePasswordResetClick(u.id, u.username)}
                                className="text-blue-400 hover:text-blue-300 text-xs underline"
                              >
                                Reset Pass
                              </button>
                              
                              {u.role !== UserRole.ADMIN && (
                                <button 
                                  onClick={() => { if(confirm('Delete user?')) onDeleteUser(u.id) }}
                                  className="text-red-400 hover:text-red-300 text-xs underline"
                                >
                                  Delete
                                </button>
                              )}
                          </div>
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div>
            {/* Global Tickets Table */}
            <div className="flex justify-between items-center mb-4">
               <h3 className="text-brand-yellow font-bold uppercase text-xs tracking-wider">Global Ticket History</h3>
               <div className="text-xs text-brand-textMuted">Total Bets: {allBets.length}</div>
            </div>
            
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-left text-sm text-brand-text">
                  <thead className="bg-brand-bg text-brand-textMuted text-xs uppercase sticky top-0">
                    <tr>
                      <th className="p-3">Time</th>
                      <th className="p-3">User</th>
                      <th className="p-3">Match</th>
                      <th className="p-3">Selection</th>
                      <th className="p-3">Stake</th>
                      <th className="p-3">Odds</th>
                      <th className="p-3">Potential Return</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-divider">
                    {allBets.length === 0 ? (
                        <tr><td colSpan={9} className="p-8 text-center text-brand-textMuted">No bets placed yet.</td></tr>
                    ) : (
                        allBets.sort((a,b) => b.timestamp - a.timestamp).map(bet => {
                            const user = users.find(u => u.id === bet.userId);
                            return (
                                <tr key={bet.id} className="hover:bg-brand-bg/50">
                                    <td className="p-3 text-xs text-brand-textMuted">{new Date(bet.timestamp).toLocaleString()}</td>
                                    <td className="p-3">
                                        <div className="flex items-center gap-1">
                                            {user ? (
                                                <>
                                                    <img src={user.avatar} className="w-4 h-4 rounded-full" />
                                                    <span className="text-xs">{user.username}</span>
                                                </>
                                            ) : (
                                                <span className="text-xs italic text-red-400">Deleted User</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-3 text-xs">
                                        {bet.type === 'ACCUMULATOR' 
                                            ? `${bet.selections.length} Matches` 
                                            : (bet.matchDetails ? `${bet.matchDetails.homeTeam} v ${bet.matchDetails.awayTeam}` : 'Match')}
                                    </td>
                                    <td className="p-3 font-bold text-white">
                                        {bet.type === 'ACCUMULATOR' 
                                            ? `${bet.selections.length}-Fold` 
                                            : bet.selections[0]?.selectionName}
                                    </td>
                                    <td className="p-3 text-brand-textMuted">{bet.stake.toFixed(2)} L</td>
                                    <td className="p-3 text-brand-yellow">@{bet.totalOdds.toFixed(2)}</td>
                                    <td className="p-3">{bet.potentialReturn.toFixed(2)} L</td>
                                    <td className="p-3">
                                        <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                                            bet.status === BetStatus.WON ? 'bg-brand-header text-white' : 
                                            bet.status === BetStatus.LOST ? 'bg-red-900 text-red-200' : 
                                            'bg-yellow-600/20 text-yellow-500'
                                        }`}>
                                            {bet.status}
                                        </span>
                                    </td>
                                    <td className="p-3 text-right">
                                        <button 
                                            onClick={() => onCancelBet(bet.id, 'ADMIN')}
                                            className="text-red-400 hover:text-white bg-red-900/30 hover:bg-red-900 px-2 py-1 rounded text-xs transition-colors"
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            );
                        })
                    )}
                  </tbody>
                </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPanel;