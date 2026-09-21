import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User } from '../types';
import * as api from '../services/api';

const money = (n: number) => Number(n || 0).toLocaleString('sq-AL', { maximumFractionDigits: 2 });
const dateFmt = (ms: number) => new Date(ms).toLocaleString('sq-AL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const statusColor: Record<string, string> = {
  WON: 'text-green-400', LOST: 'text-red-400', PENDING: 'text-brand-yellow',
};

interface AgentUsersPanelProps {
  currentUser: User;
  onBalanceChanged?: (balance: number) => void;
}

// Entirely self-contained: fetches its own data from /api/agent/* so it
// doesn't need to plug into App.tsx's big shared state tree -- lowest-risk
// way to add Agent management on top of the existing sportsbook shell the
// Agent already plays through unchanged.
const AgentUsersPanel: React.FC<AgentUsersPanelProps> = ({ currentUser, onBalanceChanged }) => {
  const [tab, setTab] = useState<'users' | 'monthly'>('users');
  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<api.AgentUserPerformance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Record<string, api.AgentTicket[]>>({});

  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', username: '', password: '', initialBalance: 0 });

  const [amountDraft, setAmountDraft] = useState<Record<string, string>>({});

  const [monthly, setMonthly] = useState<api.AgentMonthlyReport | null>(null);
  const [monthInput, setMonthInput] = useState('');

  // Keep the latest callback in a ref so load() has a STABLE identity. It used
  // to depend on `onBalanceChanged`, an inline arrow that App recreates on every
  // render; load changed -> the effect below re-ran -> load() ran again ->
  // onBalanceChanged -> App re-rendered -> new callback ... an infinite request
  // loop (agent/me + agent/performance, plus every App effect keyed on
  // currentUser) that hit the rate limit and made every call answer 429.
  const onBalanceChangedRef = useRef(onBalanceChanged);
  useEffect(() => { onBalanceChangedRef.current = onBalanceChanged; }, [onBalanceChanged]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [meRes, perf] = await Promise.all([api.agentFetchMe(), api.agentFetchPerformance()]);
      setMe(meRes.agent);
      setUsers(perf);
      if (onBalanceChangedRef.current) onBalanceChangedRef.current(meRes.agent.balance);
    } catch (e: any) {
      setError(e.message || 'Ngarkimi deshtoi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (tab === 'users') load(); }, [tab, load]);

  useEffect(() => {
    if (tab !== 'monthly') return;
    api.agentFetchMonthlyReport(monthInput || undefined).then(setMonthly).catch((e) => setError(e.message));
  }, [tab, monthInput]);

  const toggleExpand = async (userId: string) => {
    if (expanded === userId) { setExpanded(null); return; }
    setExpanded(userId);
    if (!tickets[userId]) {
      try {
        const t = await api.agentFetchUserTickets(userId);
        setTickets((prev) => ({ ...prev, [userId]: t }));
      } catch (e: any) {
        setError(e.message);
      }
    }
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.name || !newUser.username || !newUser.password) return;
    try {
      await api.agentCreateUser(newUser);
      setNewUser({ name: '', username: '', password: '', initialBalance: 0 });
      setShowCreate(false);
      await load();
    } catch (err: any) {
      setError(err.message || 'Krijimi deshtoi');
    }
  };

  const doCredit = async (userId: string) => {
    const amount = Number(amountDraft[userId]);
    if (!amount || amount <= 0) return;
    try {
      await api.agentCreditUser(userId, amount);
      setAmountDraft((p) => ({ ...p, [userId]: '' }));
      await load();
    } catch (err: any) {
      setError(err.message || 'Kredituar deshtoi');
    }
  };

  const doDebit = async (userId: string) => {
    const amount = Number(amountDraft[userId]);
    if (!amount || amount <= 0) return;
    try {
      await api.agentDebitUser(userId, amount);
      setAmountDraft((p) => ({ ...p, [userId]: '' }));
      await load();
    } catch (err: any) {
      setError(err.message || 'Terheqja deshtoi');
    }
  };

  const doDelete = async (userId: string, username: string) => {
    if (!window.confirm(`Fshi userin @${username}? Kjo veprim s'kthehet mbrapa.`)) return;
    try {
      await api.agentDeleteUser(userId);
      await load();
    } catch (err: any) {
      setError(err.message || 'Fshirja deshtoi');
    }
  };

  const toggleActive = async (userId: string, active: boolean) => {
    try {
      await api.agentSetUserActive(userId, active);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="p-3 md:p-4 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex gap-1">
          {(['users', 'monthly'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={'px-4 py-2 text-xs font-bold rounded uppercase tracking-wide ' + (tab === t ? 'bg-brand-yellow text-black' : 'bg-brand-panel text-brand-textMuted hover:text-white border border-[#444]')}
            >
              {t === 'users' ? 'Userat e Mi' : 'Raporti Mujor'}
            </button>
          ))}
        </div>
        {me && (
          <div className="text-xs text-brand-textMuted">
            Balanca ime: <span className="text-brand-yellow font-bold text-sm">{money(me.balance)}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-500/50 text-red-300 text-xs px-3 py-2 rounded mb-3 flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="font-bold">x</button>
        </div>
      )}

      {tab === 'users' && (
        <div className="bg-brand-panel border border-[#444] rounded">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#444]">
            <h2 className="font-bold text-sm uppercase tracking-wide text-brand-textMuted">Userat e Mi ({users.length})</h2>
            <button onClick={() => setShowCreate((s) => !s)} className="text-xs px-3 py-1.5 rounded bg-brand-yellow text-black font-bold hover:brightness-95">
              + User i ri
            </button>
          </div>

          {showCreate && (
            <form onSubmit={submitCreate} className="p-4 border-b border-[#444] grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
              <label className="text-[10px] text-brand-textMuted uppercase flex flex-col gap-1">Emri
                <input value={newUser.name} onChange={(e) => setNewUser((p) => ({ ...p, name: e.target.value }))} className="input" />
              </label>
              <label className="text-[10px] text-brand-textMuted uppercase flex flex-col gap-1">Username
                <input value={newUser.username} onChange={(e) => setNewUser((p) => ({ ...p, username: e.target.value }))} className="input" />
              </label>
              <label className="text-[10px] text-brand-textMuted uppercase flex flex-col gap-1">Password
                <input type="password" value={newUser.password} onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))} className="input" />
              </label>
              <label className="text-[10px] text-brand-textMuted uppercase flex flex-col gap-1">Balanca fillestare
                <input type="number" value={newUser.initialBalance} onChange={(e) => setNewUser((p) => ({ ...p, initialBalance: Number(e.target.value) }))} className="input" />
              </label>
              <button type="submit" className="text-xs px-3 py-2 rounded bg-green-700 hover:bg-green-600 font-bold h-fit">Krijo</button>
            </form>
          )}

          {loading && users.length === 0 ? (
            <div className="px-4 py-8 text-sm text-brand-textMuted text-center">Duke ngarkuar...</div>
          ) : users.length === 0 ? (
            <div className="px-4 py-8 text-sm text-brand-textMuted text-center">Ende s'ke usera. Krijo te parin me buton siper.</div>
          ) : (
            <div className="divide-y divide-[#333]">
              {users.map((u) => (
                <div key={u.id}>
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <button onClick={() => toggleExpand(u.id)} className="flex items-center gap-2 flex-1 min-w-[160px] text-left">
                      <span className={'w-2 h-2 rounded-full ' + (u.is_active === false ? 'bg-red-500' : 'bg-green-500')} />
                      <span className="font-semibold">{u.name}</span>
                      <span className="text-xs text-brand-textMuted">@{u.username}</span>
                    </button>

                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-brand-yellow font-bold">{money(u.balance)}</span>
                      <span title="Kupona">Kupona: {u.tickets}</span>
                      <span title="Xhiro">Xhiro: {money(u.turnover)}</span>
                      <span className="text-green-400" title="Fitime">+{money(u.wins)}</span>
                      <span className="text-red-400" title="Humbje">-{money(u.losses)}</span>
                      {Number(u.pending) > 0 && <span className="text-brand-yellow" title="Pending">Pending: {money(u.pending)}</span>}
                    </div>

                    <div className="flex items-center gap-1">
                      <input
                        type="number" placeholder="Shuma" value={amountDraft[u.id] || ''}
                        onChange={(e) => setAmountDraft((p) => ({ ...p, [u.id]: e.target.value }))}
                        className="input w-20"
                      />
                      <button onClick={() => doCredit(u.id)} className="text-[10px] px-2 py-1.5 rounded bg-green-700 hover:bg-green-600 font-bold">+ Krediton</button>
                      <button onClick={() => doDebit(u.id)} className="text-[10px] px-2 py-1.5 rounded bg-orange-700 hover:bg-orange-600 font-bold">- Terheq</button>
                      <button
                        onClick={() => toggleActive(u.id, u.is_active === false)}
                        className={'text-[10px] px-2 py-1.5 rounded font-bold ' + (u.is_active === false ? 'bg-green-800 hover:bg-green-700' : 'bg-[#444] hover:bg-[#555]')}
                      >
                        {u.is_active === false ? 'Aktivizo' : 'Ç-aktivizo'}
                      </button>
                      <button
                        onClick={() => doDelete(u.id, u.username)}
                        title="Fshi (vetem nese balanca=0 dhe s'ka kupona)"
                        className="text-[10px] px-2 py-1.5 rounded font-bold bg-red-900 hover:bg-red-800"
                      >
                        Fshi
                      </button>
                    </div>
                  </div>

                  {expanded === u.id && (
                    <div className="bg-[#2a2a2a] px-4 py-3">
                      {!tickets[u.id] ? (
                        <div className="text-xs text-brand-textMuted">Duke ngarkuar kuponat...</div>
                      ) : tickets[u.id].length === 0 ? (
                        <div className="text-xs text-brand-textMuted">Ky user s'ka vendosur ende kupon.</div>
                      ) : (
                        <div className="space-y-2 max-h-[420px] overflow-y-auto">
                          {tickets[u.id].map((t) => (
                            <div key={t.id} className="border border-[#444] rounded p-2 bg-brand-panel">
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-brand-textMuted">{dateFmt(t.createdAt)} - Stake: {money(t.stake)} - Kuota: {t.totalOdds}</span>
                                <span className={'font-bold ' + (statusColor[t.status] || '')}>{t.status}</span>
                              </div>
                              <div className="space-y-0.5">
                                {t.selections.map((s, i) => (
                                  <div key={i} className="flex justify-between text-[11px] text-brand-textMuted">
                                    <span>{s.matchHome} vs {s.matchAway} - {s.marketName}: <span className="text-white">{s.selectionName}</span> @{s.odds}</span>
                                    <span className={statusColor[s.status] || ''}>{s.status}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
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
              <div className="text-xs text-brand-textMuted mb-2">Muaji: {monthly.month} - {monthly.totals.totalUsers} usera</div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
                <StatBox label="Kupona" value={String(monthly.totals.totalTickets)} />
                <StatBox label="Xhiro" value={money(monthly.totals.turnover)} />
                <StatBox label="Fitime" value={money(monthly.totals.wins)} tone="pos" />
                <StatBox label="Humbje" value={money(monthly.totals.losses)} tone="neg" />
                <StatBox label="Neto" value={money(monthly.totals.netResult)} tone={monthly.totals.netResult >= 0 ? 'pos' : 'neg'} />
              </div>

              <table className="w-full text-xs">
                <thead>
                  <tr className="text-brand-textMuted text-left border-b border-[#444]">
                    <th className="py-1.5 pr-2">User</th>
                    <th className="py-1.5 pr-2">Kupona</th>
                    <th className="py-1.5 pr-2">Xhiro</th>
                    <th className="py-1.5 pr-2">Fitime</th>
                    <th className="py-1.5 pr-2">Humbje</th>
                    <th className="py-1.5 pr-2">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.users.map((u) => (
                    <tr key={u.id} className="border-b border-[#333]">
                      <td className="py-1.5 pr-2">{u.name} <span className="text-brand-textMuted">@{u.username}</span></td>
                      <td className="py-1.5 pr-2">{u.tickets}</td>
                      <td className="py-1.5 pr-2">{money(u.turnover)}</td>
                      <td className="py-1.5 pr-2 text-green-400">{money(u.wins)}</td>
                      <td className="py-1.5 pr-2 text-red-400">{money(u.losses)}</td>
                      <td className="py-1.5 pr-2">{money(u.pending)}</td>
                    </tr>
                  ))}
                  {monthly.users.length === 0 && (
                    <tr><td colSpan={6} className="py-4 text-center text-brand-textMuted">S'ka te dhena per kete muaj.</td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      <style>{'.input { background:#1f1f1f; border:1px solid #444; border-radius:4px; padding:6px 8px; font-size:12px; color:#eee; }'}</style>
    </div>
  );
};

const StatBox: React.FC<{ label: string; value: string; tone?: 'pos' | 'neg' }> = ({ label, value, tone }) => (
  <div className="bg-[#2a2a2a] border border-[#444] rounded p-3">
    <div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{label}</div>
    <div className={'text-base font-extrabold ' + (tone === 'pos' ? 'text-green-400' : tone === 'neg' ? 'text-red-400' : 'text-white')}>{value}</div>
  </div>
);

export default AgentUsersPanel;
