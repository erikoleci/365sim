import { isAdminRole, isSuperAdminRole } from '../utils/roles';
import React, { useState, useEffect } from 'react';
import MarketReportPanel from './MarketReportPanel';
import PendingLegsPanel from './PendingLegsPanel';
import { User, UserRole, Bet, BetStatus } from '../types';
import * as api from '../services/api';
import { useI18n } from '../i18n';
import TicketDetailModal, { TicketView } from './TicketDetailModal';
import MatchupLabel from './MatchupLabel';

interface AdminPanelProps {
  users: User[];
  allBets: Bet[];
  onCreateUser: (u: Omit<User, 'id' | 'role' | 'avatar'> & { role: 'USER' | 'AGENT' | 'ADMIN' }) => void;
  /** Role of whoever is looking at the panel (SUPER_ADMIN sees the extra controls). */
  viewerRole?: string;
  onDeleteUser: (userId: string) => void;
  onAddCredit: (userId: string, amount: number, amountEur?: number) => void;
  onResetPassword: (userId: string, newPass: string) => void;
  onCancelBet: (betId: string, origin: 'USER' | 'ADMIN') => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ users, allBets, onCreateUser, onDeleteUser, onAddCredit, onResetPassword, onCancelBet, viewerRole }) => {
  const viewerIsSuper = isSuperAdminRole(viewerRole);
  const { t, locale } = useI18n();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users' | 'tickets' | 'audit' | 'markets' | 'pending'>('dashboard');
  const [auditEntries, setAuditEntries] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [openTicket, setOpenTicket] = useState<TicketView | null>(null);
  const [kpi, setKpi] = useState<api.AdminDashboardKpi | null>(null);
  const [exposure, setExposure] = useState<api.AdminExposureRow[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  // Super admin's switch: may normal admins delete tickets? (everybody reads it, only the super admin changes it)
  const [ticketDeletionAllowed, setTicketDeletionAllowed] = useState(true);
  const [settingBusy, setSettingBusy] = useState(false);
  useEffect(() => { api.adminFetchSettings().then((r) => setTicketDeletionAllowed(r.ticketDeletionAllowed)).catch(() => {}); }, []);
  const toggleTicketDeletion = async () => {
    setSettingBusy(true);
    try { setTicketDeletionAllowed((await api.adminSetTicketDeletion(!ticketDeletionAllowed)).ticketDeletionAllowed); }
    catch (e: any) { alert(e.message || 'Failed to change the setting'); }
    finally { setSettingBusy(false); }
  };
  const canDeleteTickets = viewerIsSuper || ticketDeletionAllowed;

  useEffect(() => {
    if (viewerIsSuper && activeTab === 'audit') {
      setAuditLoading(true);
      api.adminFetchAuditLog()
        .then(setAuditEntries)
        .catch(() => setAuditEntries([]))
        .finally(() => setAuditLoading(false));
    }
    if (activeTab === 'dashboard') {
      setDashboardLoading(true);
      // markets / exposure are the super admin's: a normal admin only gets the profit / loss figures
      Promise.all([api.adminFetchDashboardKpi(), viewerIsSuper ? api.adminFetchExposure() : Promise.resolve([] as api.AdminExposureRow[])])
        .then(([k, e]) => { setKpi(k); setExposure(e); })
        .catch(() => { setKpi(null); setExposure([]); })
        .finally(() => setDashboardLoading(false));
    }
  }, [activeTab]);
  
  // Create User State -- role defaults to USER; admin can switch to AGENT
  // (routed server-side to POST /admin/agents instead of /admin/users).
  const [newUser, setNewUser] = useState<{ name: string; username: string; password: string; balance: number; role: 'USER' | 'AGENT' | 'ADMIN' }>({ name: '', username: '', password: '', balance: 0, role: 'USER' });
  
  // Credit State
  const [creditAmounts, setCreditAmounts] = useState<Record<string, string>>({});
  const [creditAmountsEur, setCreditAmountsEur] = useState<Record<string, string>>({});

  // Reset Password Modal State
  const [resetTarget, setResetTarget] = useState<{id: string, username: string} | null>(null);
  const [resetPassInput, setResetPassInput] = useState('');

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newUser.name && newUser.username && newUser.password) {
      onCreateUser(newUser);
      setNewUser({ name: '', username: '', password: '', balance: 0, role: 'USER' });
      alert(newUser.role === 'AGENT' ? t('Agjenti u krijua me sukses') : t('User u krijua me sukses'));
    }
  };

  const handleCreditChange = (id: string, val: string) => {
    setCreditAmounts(prev => ({ ...prev, [id]: val }));
  };

  // Lek (L) and euro (€) go together: fill one box or both, then press Add / Zbrit once.
  const executeAddCredit = (id: string) => {
    const lek = parseFloat(creditAmounts[id]) || 0;
    const eur = parseFloat(creditAmountsEur[id]) || 0;
    if (lek || eur) {
      onAddCredit(id, lek, eur);
      setCreditAmounts(prev => ({ ...prev, [id]: '' }));
      setCreditAmountsEur(prev => ({ ...prev, [id]: '' }));
    }
  };

  // Subtract: the same amounts, negative (an admin's credit goes back to the super admin / to the giver).
  const executeSubtractCredit = (id: string) => {
    const lek = Math.abs(parseFloat(creditAmounts[id]) || 0);
    const eur = Math.abs(parseFloat(creditAmountsEur[id]) || 0);
    if (lek || eur) {
      onAddCredit(id, -lek, -eur);
      setCreditAmounts(prev => ({ ...prev, [id]: '' }));
      setCreditAmountsEur(prev => ({ ...prev, [id]: '' }));
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

  const openResetModal = (userId: string, username: string) => {
      setResetTarget({ id: userId, username });
      setResetPassInput('');
  };

  const confirmResetPassword = () => {
      if (resetTarget && resetPassInput.trim()) {
          onResetPassword(resetTarget.id, resetPassInput);
          setResetTarget(null);
          setResetPassInput('');
      }
  };

  return (
    <div className="bg-brand-panel rounded border border-brand-divider shadow-lg mb-6 overflow-hidden relative">
      
      {/* Password Reset Modal Overlay */}
      {resetTarget && (
          <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
              <div className="bg-brand-bg border border-brand-divider p-6 rounded shadow-xl w-full max-w-sm">
                  <h3 className="text-brand-yellow font-bold text-lg mb-4">Reset Password</h3>
                  <p className="text-sm text-brand-textMuted mb-4">Enter new password for <span className="text-white font-bold">{resetTarget.username}</span>:</p>
                  
                  <input 
                    type="text" 
                    value={resetPassInput}
                    onChange={(e) => setResetPassInput(e.target.value)}
                    className="w-full bg-brand-panel border border-brand-divider rounded p-2 text-white mb-4 outline-none focus:border-brand-yellow"
                    placeholder="New Password"
                    autoFocus
                  />
                  
                  <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => setResetTarget(null)}
                        className="px-4 py-2 rounded text-brand-textMuted hover:text-white"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={confirmResetPassword}
                        disabled={!resetPassInput.trim()}
                        className="bg-brand-header hover:bg-brand-headerDark text-white px-4 py-2 rounded font-bold disabled:opacity-50"
                      >
                        Save Password
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Header Tabs */}
      <div className="flex overflow-x-auto border-b border-brand-divider bg-brand-bg">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`px-6 py-3 text-sm font-bold ${activeTab === 'dashboard' ? 'bg-brand-panel text-white border-t-2 border-brand-yellow' : 'text-brand-textMuted hover:text-white'}`}
        >
          Dashboard
        </button>
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
        {viewerIsSuper && (
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-6 py-3 text-sm font-bold ${activeTab === 'audit' ? 'bg-brand-panel text-white border-t-2 border-brand-yellow' : 'text-brand-textMuted hover:text-white'}`}
          >
            Audit Log
          </button>
        )}
        {viewerIsSuper && (<>
        <button
          onClick={() => setActiveTab('markets')}
          className={`px-6 py-3 text-sm font-bold whitespace-nowrap ${activeTab === 'markets' ? 'bg-brand-panel text-white border-t-2 border-brand-yellow' : 'text-brand-textMuted hover:text-white'}`}
        >
          Tregjet
        </button>
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-6 py-3 text-sm font-bold whitespace-nowrap ${activeTab === 'pending' ? 'bg-brand-panel text-white border-t-2 border-brand-yellow' : 'text-brand-textMuted hover:text-white'}`}
        >
          Pezull
        </button>
        </>)}
      </div>

      <div className="p-6">
        {activeTab === 'pending' ? (
          <PendingLegsPanel />
        ) : activeTab === 'markets' ? (
          <MarketReportPanel />
        ) : activeTab === 'dashboard' ? (
          <div className="space-y-6">
            {dashboardLoading ? (
              <div className="text-brand-textMuted text-sm">Loading...</div>
            ) : !kpi ? (
              <div className="text-brand-textMuted text-sm">Failed to load dashboard data.</div>
            ) : (
              <>
                {/* Fitimet / humbjet / bileta: what every admin sees */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="bg-brand-bg border border-brand-divider rounded p-4">
                    <div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Fitimet')}</div>
                    <div className="text-xl font-bold text-brand-accent">{kpi.profit.toFixed(2)} L</div>
                  </div>
                  <div className="bg-brand-bg border border-brand-divider rounded p-4">
                    <div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Humbjet')}</div>
                    <div className="text-xl font-bold text-red-400">{kpi.loss.toFixed(2)} L</div>
                  </div>
                  <div className="bg-brand-bg border border-brand-divider rounded p-4">
                    <div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Rezultati Neto')}</div>
                    <div className={`text-xl font-bold ${kpi.net >= 0 ? 'text-brand-accent' : 'text-red-400'}`}>{kpi.net.toFixed(2)} L</div>
                  </div>
                  <div className="bg-brand-bg border border-brand-divider rounded p-4">
                    <div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Bileta të hapura')}</div>
                    <div className="text-xl font-bold text-brand-yellow">{kpi.ticketsOpen}</div>
                  </div>
                  <div className="bg-brand-bg border border-brand-divider rounded p-4">
                    <div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Bileta të fituara')}</div>
                    <div className="text-xl font-bold text-white">{kpi.ticketsWon}</div>
                  </div>
                  <div className="bg-brand-bg border border-brand-divider rounded p-4">
                    <div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Bileta të humbura')}</div>
                    <div className="text-xl font-bold text-white">{kpi.ticketsLost}</div>
                  </div>
                </div>

                {/* The rest of the business is the super admin's */}
                {viewerIsSuper && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-brand-bg border border-brand-divider rounded p-4">
                    <div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">GGR</div>
                    <div className={`text-xl font-bold ${(kpi.ggr ?? 0) >= 0 ? 'text-brand-accent' : 'text-red-400'}`}>{(kpi.ggr ?? 0).toFixed(2)} L</div>
                  </div>
                  <div className="bg-brand-bg border border-brand-divider rounded p-4">
                    <div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">Turnover (Total)</div>
                    <div className="text-xl font-bold text-white">{(kpi.turnover ?? 0).toFixed(2)} L</div>
                  </div>
                  <div className="bg-brand-bg border border-brand-divider rounded p-4">
                    <div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">Open Liability</div>
                    <div className="text-xl font-bold text-brand-yellow">{(kpi.openLiability ?? 0).toFixed(2)} L</div>
                  </div>
                  <div className="bg-brand-bg border border-brand-divider rounded p-4">
                    <div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">Total Users</div>
                    <div className="text-xl font-bold text-white">{kpi.totalUsers ?? 0}</div>
                  </div>
                </div>
                )}

                {viewerIsSuper && (
                <div>
                  <h3 className="text-brand-yellow font-bold uppercase text-xs tracking-wider mb-3">Top Exposure (highest house liability, PENDING bets)</h3>
                  {exposure.length === 0 ? (
                    <div className="text-brand-textMuted text-sm">No pending exposure.</div>
                  ) : (
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                      <table className="w-full text-left text-xs text-brand-text">
                        <thead className="bg-brand-bg text-brand-textMuted uppercase sticky top-0">
                          <tr>
                            <th className="p-2">Match</th>
                            <th className="p-2">Market</th>
                            <th className="p-2">Selection</th>
                            <th className="p-2">Tickets</th>
                            <th className="p-2 text-right">Exposure</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-brand-divider">
                          {exposure.map((row, i) => (
                            <tr key={i} className="hover:bg-brand-bg/50">
                              <td className="p-2">{row.match_home} v {row.match_away}</td>
                              <td className="p-2 text-brand-textMuted">{row.market_name}</td>
                              <td className="p-2 font-bold">{row.selection_name}</td>
                              <td className="p-2">{row.ticket_count}</td>
                              <td className="p-2 text-right text-brand-yellow font-bold">{Number(row.total_exposure).toFixed(2)} L</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                )}
              </>
            )}
          </div>
        ) : activeTab === 'users' ? (
          <div className="space-y-8">
            {/* Create User Section */}
            <div className="bg-brand-bg p-4 rounded border border-brand-divider">
              <h3 className="text-brand-yellow font-bold mb-4 uppercase text-xs tracking-wider">Create New User</h3>
              <form onSubmit={handleCreateSubmit} className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
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
                <div>
                  <label className="text-xs text-brand-textMuted block mb-1">{t('Lloji')}</label>
                  <select className="w-full bg-brand-panel border border-brand-divider rounded p-2 text-white text-sm"
                    value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value as 'USER' | 'AGENT' | 'ADMIN'})}>
                    <option value="USER">User</option>
                    <option value="AGENT">{t('Agjent')}</option>
                    {viewerIsSuper && <option value="ADMIN">Admin</option>}
                  </select>
                </div>
                <button type="submit" className="bg-brand-header hover:bg-brand-headerDark text-white font-bold py-2 px-4 rounded text-sm transition-colors">
                  {newUser.role === 'AGENT' ? 'Create Agent' : newUser.role === 'ADMIN' ? 'Create Admin' : 'Create User'}
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
                            <div>
                              <div className="font-bold">{u.name}</div>
                              <div className="text-xs text-brand-textMuted">@{u.username}</div>
                              {/* Show current password for easy admin debugging in simulation */}
                              <div className="text-[10px] text-brand-textMuted opacity-50">pw: {u.password}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3">
                          <span className={`text-xs px-2 py-1 rounded ${isAdminRole(u.role) ? 'bg-purple-900 text-purple-200' : 'bg-brand-headerDark text-white'}`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="p-3 font-mono text-brand-yellow font-bold">{u.balance.toFixed(2)} L<br />{(u.balanceEur ?? 0).toFixed(2)} €</td>
                        
                        {/* Stats Columns */}
                        <td className="p-3 font-mono text-white">{stats.turnover.toFixed(2)} L</td>
                        <td className="p-3 font-mono text-brand-accent">{stats.won.toFixed(2)} L</td>
                        <td className="p-3 font-mono text-red-400">{stats.lost.toFixed(2)} L</td>
                        
                        <td className="p-3">
                          {isAdminRole(u.role) && !(viewerIsSuper && u.role === UserRole.ADMIN) ? (
                            <span className="text-[10px] text-brand-textMuted">{u.role === UserRole.SUPER_ADMIN ? '—' : t('Kredit vetëm nga super admini')}</span>
                          ) : (
                          <div className="flex items-center gap-2">
                            <input 
                              type="number" 
                              className="w-20 bg-brand-bg border border-brand-divider rounded p-1 text-xs text-white"
                              placeholder="L"
                              value={creditAmounts[u.id] || ''}
                              onChange={(e) => handleCreditChange(u.id, e.target.value)}
                            />
                            <input
                              type="number"
                              className="w-16 bg-brand-bg border border-brand-divider rounded p-1 text-xs text-white"
                              placeholder="€"
                              value={creditAmountsEur[u.id] || ''}
                              onChange={(e) => setCreditAmountsEur(prev => ({ ...prev, [u.id]: e.target.value }))}
                            />
                            <button 
                              onClick={() => executeAddCredit(u.id)}
                              className="bg-brand-accent text-brand-bg font-bold px-2 py-1 rounded text-xs hover:opacity-90"
                            >
                              Add
                            </button>
                            <button
                              onClick={() => executeSubtractCredit(u.id)}
                              className="bg-red-600 text-white font-bold px-2 py-1 rounded text-xs hover:opacity-90"
                            >
                              {t('Zbrit')}
                            </button>
                          </div>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex flex-col gap-1 items-end">
                              <button 
                                onClick={() => openResetModal(u.id, u.username)}
                                className="text-blue-400 hover:text-blue-300 text-xs underline"
                              >
                                Reset Pass
                              </button>
                              
                              {(u.role === UserRole.USER || u.role === UserRole.AGENT || (viewerIsSuper && u.role === UserRole.ADMIN)) && (
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
        ) : activeTab === 'tickets' ? (
          <div>
            {/* Global Tickets Table */}
            <div className="flex justify-between items-center mb-4">
               <h3 className="text-brand-yellow font-bold uppercase text-xs tracking-wider">Global Ticket History</h3>
               <div className="flex items-center gap-3">
                 {viewerIsSuper && (
                   <button
                     onClick={toggleTicketDeletion}
                     disabled={settingBusy}
                     className={`text-xs font-bold px-3 py-1.5 rounded border disabled:opacity-50 ${ticketDeletionAllowed ? 'bg-brand-accent/20 text-brand-accent border-brand-accent' : 'bg-red-900/40 text-red-300 border-red-700'}`}
                   >
                     {ticketDeletionAllowed ? t('Fshirja e biletave nga adminët: LEJUAR') : t('Fshirja e biletave nga adminët: NDALUAR')}
                   </button>
                 )}
                 {!canDeleteTickets && <span className="text-xs text-red-300">{t('Fshirja e biletave është çaktivizuar nga super admini')}</span>}
                 <div className="text-xs text-brand-textMuted">Total Bets: {allBets.length}</div>
               </div>
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
                                <tr key={bet.id} className="hover:bg-brand-bg/50 cursor-pointer" title="Hap biletën"
                                    onClick={() => setOpenTicket({ id: bet.id, createdAt: bet.timestamp, status: bet.status, type: bet.type, stake: bet.stake, totalOdds: bet.totalOdds, potentialReturn: bet.potentialReturn, user: user ? user.username : undefined, legs: bet.selections })}>
                                    <td className="p-3 text-xs text-brand-textMuted">{new Date(bet.timestamp).toLocaleString()}</td>
                                    <td className="p-3">
                                        <div className="flex items-center gap-1">
                                            {user ? (
                                                <>
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
                                            : (bet.matchDetails ? <MatchupLabel home={bet.matchDetails.homeTeam} away={bet.matchDetails.awayTeam} /> : 'Match')}
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
                                            bet.status === BetStatus.CANCELLED ? 'bg-gray-600/30 text-gray-300 line-through' : 
                                            'bg-yellow-600/20 text-yellow-500'
                                        }`}>
                                            {bet.status === BetStatus.CANCELLED ? t('ANULUAR') : bet.status}
                                        </span>
                                    </td>
                                    <td className="p-3 text-right">
                                        {canDeleteTickets && bet.status !== BetStatus.CANCELLED && (
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); onCancelBet(bet.id, 'ADMIN'); }}
                                            className="text-red-400 hover:text-white bg-red-900/30 hover:bg-red-900 px-2 py-1 rounded text-xs transition-colors"
                                        >
                                            {t('Anulo')}
                                        </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })
                    )}
                  </tbody>
                </table>
            </div>
          </div>
        ) : (
          <div>
            <h3 className="text-brand-yellow font-bold uppercase text-xs tracking-wider mb-4">Audit Log (last 200 actions)</h3>
            {auditLoading ? (
              <div className="text-brand-textMuted text-sm">Loading...</div>
            ) : auditEntries.length === 0 ? (
              <div className="text-brand-textMuted text-sm">No audit entries yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-brand-textMuted border-b border-brand-divider">
                      <th className="p-2">Time</th>
                      <th className="p-2">Admin</th>
                      <th className="p-2">Action</th>
                      <th className="p-2">Target</th>
                      <th className="p-2">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditEntries.map((e) => (
                      <tr key={e.id} className="border-b border-brand-divider/50">
                        <td className="p-2 whitespace-nowrap text-brand-textMuted">{new Date(Number(e.created_at)).toLocaleString(locale, { timeZone: 'Europe/Tirane' })}</td>
                        <td className="p-2 font-bold text-white">{e.actor_username}</td>
                        <td className="p-2"><span className="bg-brand-header px-2 py-0.5 rounded text-[10px] font-bold">{e.action}</span></td>
                        <td className="p-2 text-brand-textMuted">{e.target || '—'}</td>
                        <td className="p-2 text-brand-textMuted font-mono text-[10px]">{e.details || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      <TicketDetailModal ticket={openTicket} onClose={() => setOpenTicket(null)} />
    </div>
  );
};

export default AdminPanel;