import React, { useState, useEffect, useCallback } from 'react';
import { User, Bet } from '../types';
import * as api from '../services/api';
import AdminPanel from './AdminPanel';

interface OwnerDashboardProps {
  currentUser: User;
  onLogout: () => void;
  users: User[];
  allBets: Bet[];
  onCreateUser: (u: { name: string; username: string; password: string; balance: number; role: 'USER' | 'AGENT' }) => void;
  onDeleteUser: (userId: string) => void;
  onAddCredit: (userId: string, amount: number) => void;
  onResetPassword: (userId: string, newPass: string) => void;
  onCancelBet: (betId: string, origin: 'USER' | 'ADMIN') => void;
}

const money = (n: number) => Number(n || 0).toLocaleString('sq-AL', { maximumFractionDigits: 2 });

// Owner/Admin never places bets or plays casino — this is a standalone,
// read-focused page: aggregate reports first, with the existing full
// AdminPanel (user/ticket/audit management) tucked in a second tab for
// when actual changes (create agent, credit, reset password) are needed.
const OwnerDashboard: React.FC<OwnerDashboardProps> = ({
  currentUser, onLogout, users, allBets,
  onCreateUser, onDeleteUser, onAddCredit, onResetPassword, onCancelBet,
}) => {
  const [tab, setTab] = useState<'reports' | 'monthly' | 'manage'>('reports');
  const [overview, setOverview] = useState<api.AdminOverview | null>(null);
  const [agents, setAgents] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [agentDetail, setAgentDetail] = useState<Record<string, api.AgentUserPerformance[]>>({});

  const [monthly, setMonthly] = useState<api.AdminMonthlyReport | null>(null);
  const [monthInput, setMonthInput] = useState('');

  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [newAgent, setNewAgent] = useState({ name: '', username: '', password: '', balance: 0 });
  const [agentAmount, setAgentAmount] = useState<Record<string, string>>({});
  const [agentActionBusy, setAgentActionBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, ag] = await Promise.all([api.adminFetchOverview(), api.adminFetchAgents()]);
      setOverview(ov);
      setAgents(ag);
    } catch (e) {
      console.error('Failed to load owner overview', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (tab === 'reports') load(); }, [tab, load]);

  useEffect(() => {
    if (tab !== 'monthly') return;
    api.adminFetchMonthlyReport(monthInput || undefined).then(setMonthly).catch((e) => console.error(e));
  }, [tab, monthInput]);

  const toggleAgent = async (agentId: string) => {
    if (expandedAgent === agentId) { setExpandedAgent(null); return; }
    setExpandedAgent(agentId);
    if (!agentDetail[agentId]) {
      try {
        const detail = await api.adminFetchAgentPerformance(agentId);
        setAgentDetail((prev) => ({ ...prev, [agentId]: detail.users }));
      } catch (e) {
        console.error('Failed to load agent performance', e);
      }
    }
  };

  const submitCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgent.name || !newAgent.username || !newAgent.password) return;
    try {
      await api.adminCreateAgent(newAgent);
      setNewAgent({ name: '', username: '', password: '', balance: 0 });
      setShowCreateAgent(false);
      await load();
    } catch (err: any) {
      alert(err.message || 'Krijimi i agjentit deshtoi');
    }
  };

  const fundAgent = async (agentId: string, direction: 'credit' | 'debit') => {
    const amount = Number(agentAmount[agentId]);
    if (!amount || amount <= 0) return;
    setAgentActionBusy(agentId);
    try {
      if (direction === 'credit') await api.adminCreditAgent(agentId, amount);
      else await api.adminDebitAgent(agentId, amount);
      setAgentAmount((p) => ({ ...p, [agentId]: '' }));
      await load();
    } catch (err: any) {
      alert(err.message || 'Veprimi deshtoi');
    } finally {
      setAgentActionBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text font-sans">
      <header className="bg-brand-header border-b border-[#444] px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <span className="text-brand-yellow font-extrabold text-lg tracking-wide">365SIM - OWNER</span>
          <span className="text-xs text-brand-textMuted hidden sm:inline">{currentUser.name}</span>
        </div>
        <button onClick={onLogout} className="text-xs px-3 py-1.5 rounded bg-brand-panel hover:bg-[#444] border border-[#444]">
          Dil
        </button>
      </header>

      <nav className="flex gap-1 px-4 pt-3 border-b border-[#333]">
        {(['reports', 'monthly', 'manage'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-bold rounded-t uppercase tracking-wide ${tab === t ? 'bg-brand-panel text-brand-yellow border border-b-0 border-[#444]' : 'text-brand-textMuted hover:text-white'}`}
          >
            {t === 'reports' ? 'Raporte' : t === 'monthly' ? 'Raporti Mujor' : 'Menaxho'}
          </button>
        ))}
      </nav>

      <main className="p-4 max-w-[1300px] mx-auto">
        {tab === 'reports' && (
          <div className="space-y-6">
            {loading && !overview ? (
              <div className="text-brand-textMuted text-sm py-10 text-center">Duke ngarkuar...</div>
            ) : overview ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <KpiCard label="Agjente (aktive)" value={overview.agents.total + ' (' + overview.agents.active + ')'} />
                  <KpiCard label="Balanca e Agjenteve" value={money(overview.agents.totalBalance)} />
                  <KpiCard label="Usera (aktive)" value={overview.users.total + ' (' + overview.users.active + ')'} />
                  <KpiCard label="Balanca e Userave" value={money(overview.users.totalBalance)} />
                  <KpiCard label="Kupona gjithsej" value={String(overview.tickets.total)} />
                  <KpiCard label="Xhiro (Turnover)" value={money(overview.tickets.turnover)} />
                  <KpiCard label="Pending" value={overview.tickets.pendingCount + ' (' + money(overview.tickets.pending) + ')'} />
                  <KpiCard label="Rezultati Neto" value={money(overview.netResult)} positive={overview.netResult >= 0} />
                </div>

                <div className="bg-brand-panel border border-[#444] rounded">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#444]">
                    <h2 className="font-bold text-sm uppercase tracking-wide text-brand-textMuted">Agjentet</h2>
                    <button
                      onClick={() => setShowCreateAgent((s) => !s)}
                      className="text-xs px-3 py-1.5 rounded bg-brand-yellow text-black font-bold hover:brightness-95"
                    >
                      + Agjent i ri
                    </button>
                  </div>

                  {showCreateAgent && (
                    <form onSubmit={submitCreateAgent} className="p-4 border-b border-[#444] grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
                      <Field label="Emri"><input value={newAgent.name} onChange={(e) => setNewAgent((p) => ({ ...p, name: e.target.value }))} className="input" /></Field>
                      <Field label="Username"><input value={newAgent.username} onChange={(e) => setNewAgent((p) => ({ ...p, username: e.target.value }))} className="input" /></Field>
                      <Field label="Password"><input type="password" value={newAgent.password} onChange={(e) => setNewAgent((p) => ({ ...p, password: e.target.value }))} className="input" /></Field>
                      <Field label="Balanca fillestare"><input type="number" value={newAgent.balance} onChange={(e) => setNewAgent((p) => ({ ...p, balance: Number(e.target.value) }))} className="input" /></Field>
                      <button type="submit" className="text-xs px-3 py-2 rounded bg-green-700 hover:bg-green-600 font-bold h-fit">Krijo</button>
                    </form>
                  )}

                  <div className="divide-y divide-[#333]">
                    {agents.length === 0 && <div className="px-4 py-6 text-sm text-brand-textMuted">Ende s'ka agjente.</div>}
                    {agents.map((a) => (
                      <div key={a.id}>
                        <div className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#333]">
                          <button onClick={() => toggleAgent(a.id)} className="flex items-center gap-2 text-left flex-1">
                            <span className={'w-2 h-2 rounded-full ' + (a.isActive === false ? 'bg-red-500' : 'bg-green-500')} />
                            <span className="font-semibold">{a.name}</span>
                            <span className="text-xs text-brand-textMuted">@{a.username}</span>
                          </button>
                          <div className="flex items-center gap-2 text-sm" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="number" placeholder="Shuma" value={agentAmount[a.id] || ''}
                              onChange={(e) => setAgentAmount((p) => ({ ...p, [a.id]: e.target.value }))}
                              className="input !w-24 text-xs"
                            />
                            <button
                              disabled={agentActionBusy === a.id}
                              onClick={() => fundAgent(a.id, 'credit')}
                              title="Shto fonde nga balanca e Owner-it"
                              className="text-xs px-2 py-1.5 rounded bg-green-700 hover:bg-green-600 font-bold disabled:opacity-50"
                            >+</button>
                            <button
                              disabled={agentActionBusy === a.id}
                              onClick={() => fundAgent(a.id, 'debit')}
                              title="Terhiq fonde te balanca e Owner-it"
                              className="text-xs px-2 py-1.5 rounded bg-red-800 hover:bg-red-700 font-bold disabled:opacity-50"
                            >−</button>
                            <span className="text-brand-yellow font-bold w-20 text-right">{money(a.balance)}</span>
                            <button onClick={() => toggleAgent(a.id)} className="text-brand-textMuted text-xs w-4">{expandedAgent === a.id ? '−' : '+'}</button>
                          </div>
                        </div>
                        {expandedAgent === a.id && (
                          <div className="bg-[#2a2a2a] px-4 py-3">
                            {!agentDetail[a.id] ? (
                              <div className="text-xs text-brand-textMuted">Duke ngarkuar userat...</div>
                            ) : agentDetail[a.id].length === 0 ? (
                              <div className="text-xs text-brand-textMuted">Ky agjent s'ka usera ende.</div>
                            ) : (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-brand-textMuted text-left border-b border-[#444]">
                                    <th className="py-1.5 pr-2">User</th>
                                    <th className="py-1.5 pr-2">Balance</th>
                                    <th className="py-1.5 pr-2">Kupona</th>
                                    <th className="py-1.5 pr-2">Xhiro</th>
                                    <th className="py-1.5 pr-2">Fitime</th>
                                    <th className="py-1.5 pr-2">Humbje</th>
                                    <th className="py-1.5 pr-2">Pending</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {agentDetail[a.id].map((u) => (
                                    <tr key={u.id} className="border-b border-[#333]">
                                      <td className="py-1.5 pr-2">{u.name} <span className="text-brand-textMuted">@{u.username}</span></td>
                                      <td className="py-1.5 pr-2 text-brand-yellow">{money(u.balance)}</td>
                                      <td className="py-1.5 pr-2">{u.tickets}</td>
                                      <td className="py-1.5 pr-2">{money(u.turnover)}</td>
                                      <td className="py-1.5 pr-2 text-green-400">{money(u.wins)}</td>
                                      <td className="py-1.5 pr-2 text-red-400">{money(u.losses)}</td>
                                      <td className="py-1.5 pr-2">{money(u.pending)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-red-400 text-sm">Ngarkimi deshtoi.</div>
            )}
          </div>
        )}

        {tab === 'monthly' && (
          <div className="bg-brand-panel border border-[#444] rounded p-4">
            <div className="flex items-center gap-2 mb-4">
              <label className="text-xs text-brand-textMuted">Muaji:</label>
              <input type="month" value={monthInput} onChange={(e) => setMonthInput(e.target.value)} className="input w-40" />
            </div>
            {!monthly ? (
              <div className="text-sm text-brand-textMuted">Duke ngarkuar...</div>
            ) : (
              <>
                <div className="text-xs text-brand-textMuted mb-2">
                  Muaji: {monthly.month} - {monthly.totals.totalAgents} agjente, {monthly.totals.totalUsers} usera
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
                  <KpiCard label="Kupona" value={String(monthly.totals.totalTickets)} />
                  <KpiCard label="Xhiro" value={money(monthly.totals.turnover)} />
                  <KpiCard label="Fitime" value={money(monthly.totals.wins)} positive />
                  <KpiCard label="Humbje" value={money(monthly.totals.losses)} positive={false} />
                  <KpiCard label="Neto" value={money(monthly.totals.netResult)} positive={monthly.totals.netResult >= 0} />
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-brand-textMuted text-left border-b border-[#444]">
                      <th className="py-1.5 pr-2">Agjenti</th>
                      <th className="py-1.5 pr-2">Usera</th>
                      <th className="py-1.5 pr-2">Kupona</th>
                      <th className="py-1.5 pr-2">Xhiro</th>
                      <th className="py-1.5 pr-2">Fitime</th>
                      <th className="py-1.5 pr-2">Humbje</th>
                      <th className="py-1.5 pr-2">Pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthly.agents.map((a) => (
                      <tr key={a.id} className="border-b border-[#333]">
                        <td className="py-1.5 pr-2">{a.name} <span className="text-brand-textMuted">@{a.username}</span></td>
                        <td className="py-1.5 pr-2">{a.total_users}</td>
                        <td className="py-1.5 pr-2">{a.tickets}</td>
                        <td className="py-1.5 pr-2">{money(a.turnover)}</td>
                        <td className="py-1.5 pr-2 text-green-400">{money(a.wins)}</td>
                        <td className="py-1.5 pr-2 text-red-400">{money(a.losses)}</td>
                        <td className="py-1.5 pr-2">{money(a.pending)}</td>
                      </tr>
                    ))}
                    {monthly.agents.length === 0 && (
                      <tr><td colSpan={7} className="py-4 text-center text-brand-textMuted">S'ka te dhena per kete muaj.</td></tr>
                    )}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        {tab === 'manage' && (
          <AdminPanel
            users={users} allBets={allBets}
            onCreateUser={onCreateUser} onDeleteUser={onDeleteUser}
            onAddCredit={onAddCredit} onResetPassword={onResetPassword}
            onCancelBet={onCancelBet}
          />
        )}
      </main>

      <style>{'.input { background:#1f1f1f; border:1px solid #444; border-radius:4px; padding:6px 8px; font-size:12px; color:#eee; width:100%; }'}</style>
    </div>
  );
};

const KpiCard: React.FC<{ label: string; value: string; positive?: boolean }> = ({ label, value, positive }) => (
  <div className="bg-brand-panel border border-[#444] rounded p-3">
    <div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{label}</div>
    <div className={'text-lg font-extrabold ' + (positive === undefined ? 'text-white' : positive ? 'text-green-400' : 'text-red-400')}>{value}</div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="text-[10px] text-brand-textMuted uppercase tracking-wide flex flex-col gap-1">
    {label}
    {children}
  </label>
);

export default OwnerDashboard;
