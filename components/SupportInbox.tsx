import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../services/api';

// Staff side of Support. An admin sees the players he owns; the super admin sees everyone and which admin each player belongs to.
// Replies are anonymous for the player: he only ever sees "Support".
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const legColor = (s: string) => (s === 'WON' || s === 'HALF_WON' ? 'text-brand-accent' : s === 'LOST' || s === 'HALF_LOST' ? 'text-red-400' : s === 'VOID' ? 'text-gray-400' : 'text-brand-yellow');

const Thread: React.FC<{ id: string; isSuper: boolean; onBack: () => void }> = ({ id, isSuper, onBack }) => {
  const [data, setData] = useState<{ thread: api.SupportThread; messages: api.SupportMessage[]; ticket: api.SupportTicket | null } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => { try { setData(await api.supportInboxThread(id)); } catch { /* keep what is shown */ } }, [id]);
  useEffect(() => {
    load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 8000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [data?.messages.length]);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await api.supportInboxReply(id, text.trim()); setText(''); await load(); } finally { setBusy(false); }
  };
  const toggle = async () => {
    if (!data) return;
    await api.supportInboxStatus(id, data.thread.status === 'OPEN' ? 'CLOSED' : 'OPEN');
    await load();
  };
  const t = data?.thread;
  const sym = data?.ticket?.currency === 'EUR' ? '€' : 'L';
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button onClick={onBack} className="text-xs text-brand-textMuted hover:text-white">← Të gjitha</button>
        {t && <button onClick={toggle} className="text-xs font-bold px-3 py-1.5 rounded border border-brand-divider text-brand-textMuted hover:text-white">{t.status === 'OPEN' ? 'Mbyll bisedën' : 'Rihap'}</button>}
      </div>
      {t && (
        <div className="bg-brand-bg rounded-lg p-3 mb-3 text-sm">
          <div className="text-white font-bold">{t.user?.role === 'AGENT' ? 'Agjenti' : 'Lojtari'}: {t.user?.username}{t.user?.name && t.user.name !== t.user.username ? ` · ${t.user.name}` : ''}</div>
          {t.agent && <div className="text-xs text-brand-textMuted">Agjenti i tij: <span className="text-white">{t.agent.username}{t.agent.name && t.agent.name !== t.agent.username ? ` · ${t.agent.name}` : ''}</span></div>}
          {isSuper && <div className="text-xs text-brand-yellow">Admini i lojtarit: {t.admin?.username || 'pa admin'}</div>}
          {t.ticketNo != null && <div className="text-xs text-brand-textMuted mt-1">Bileta <b className="text-brand-yellow">#{t.ticketNo}</b>{t.matchLabel ? ` · ${t.matchLabel}` : ''}</div>}
        </div>
      )}
      {data?.ticket && (
        <div className="bg-[#282828] rounded-lg p-3 mb-3 text-xs">
          <div className="flex justify-between text-brand-textMuted mb-1.5"><span>Bileta #{data.ticket.ticketNo ?? ''} · <b className={legColor(data.ticket.status)}>{data.ticket.status}</b></span><span>{when(data.ticket.createdAt)}</span></div>
          {data.ticket.legs.map((l, i) => (
            <div key={i} className="flex justify-between gap-2 py-0.5">
              <span className="text-white min-w-0 truncate">{l.match} <span className="text-brand-textMuted">· {l.market} · {l.selection} @{l.odds.toFixed(2)}</span></span>
              <b className={`${legColor(l.status)} flex-shrink-0`}>{l.status}</b>
            </div>
          ))}
          <div className="flex justify-between text-brand-textMuted mt-1.5 pt-1.5 border-t border-dashed border-brand-divider tabular-nums">
            <span>Stake {data.ticket.stake.toFixed(2)} {sym} · @{data.ticket.totalOdds.toFixed(2)}</span><span>Ret {data.ticket.potentialReturn.toFixed(2)} {sym}</span>
          </div>
        </div>
      )}
      <div className="space-y-2 max-h-[45vh] overflow-y-auto pb-2">
        {(data?.messages || []).map((m) => (
          <div key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.from === 'staff' ? 'ml-auto bg-brand-accent/90 text-brand-bg' : 'bg-brand-bg text-white'}`}>
            <div className="text-[10px] font-bold opacity-70 mb-0.5">{m.from === 'staff' ? 'Support' : 'Lojtari'}</div>
            <div className="whitespace-pre-wrap break-words">{m.body}</div>
            <div className="text-[10px] opacity-60 mt-1 text-right">{when(m.at)}</div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <div className="flex gap-2 pt-2 border-t border-brand-divider">
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={2} placeholder="Përgjigju lojtarit… (ai nuk sheh emrin tënd)" className="flex-1 rounded-lg border border-brand-divider bg-brand-bg text-white placeholder:text-brand-textMuted px-3 py-2 text-sm outline-none focus:border-brand-yellow [color-scheme:dark]" />
        <button onClick={send} disabled={busy || !text.trim()} className="bg-brand-yellow text-brand-bg px-4 rounded font-bold disabled:opacity-50">Dërgo</button>
      </div>
    </div>
  );
};

const SupportInbox: React.FC<{ isSuper: boolean; onChanged?: () => void }> = ({ isSuper, onChanged }) => {
  const [status, setStatus] = useState<'OPEN' | 'CLOSED'>('OPEN');
  const [threads, setThreads] = useState<api.SupportThread[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setThreads((await api.supportInbox(status)).threads); setError(''); } catch (e: any) { setError(e?.message || 'Gabim'); }
  }, [status]);
  useEffect(() => {
    setThreads(null); load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <div className="bg-brand-panel border border-[#444] rounded p-4">
      {openId ? <Thread id={openId} isSuper={isSuper} onBack={() => { setOpenId(null); load(); onChanged?.(); }} /> : (
        <>
          <div className="flex items-center gap-2 mb-3">
            {(['OPEN', 'CLOSED'] as const).map((s) => (
              <button key={s} onClick={() => setStatus(s)} className={`text-xs font-bold px-3 py-1.5 rounded ${status === s ? 'bg-brand-yellow text-brand-bg' : 'bg-brand-bg text-brand-textMuted'}`}>{s === 'OPEN' ? 'Të hapura' : 'Të mbyllura'}</button>
            ))}
            <button onClick={load} className="text-xs px-3 py-1.5 rounded bg-green-700 hover:bg-green-600 font-bold ml-auto">Rifresko</button>
          </div>
          {error && <div className="text-red-400 text-xs mb-2">{error}</div>}
          {threads && threads.length === 0 && <div className="text-center text-brand-textMuted text-xs py-8">Asnjë mesazh.</div>}
          <div className="space-y-1.5">
            {(threads || []).map((t) => (
              <button key={t.id} onClick={() => setOpenId(t.id)} className="w-full text-left rounded bg-black/25 p-2.5 text-xs hover:bg-black/40">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-white truncate">
                    {t.unread && <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5" />}{t.user?.username}
                    {t.agent && <span className="text-brand-textMuted font-normal"> · agjenti {t.agent.username}</span>}
                    {isSuper && <span className="text-brand-yellow font-normal"> → {t.admin?.username || 'pa admin'}</span>}
                  </span>
                  <span className="text-brand-textMuted flex-shrink-0">{when(t.lastMessageAt)}</span>
                </div>
                <div className="text-brand-textMuted mt-0.5">{t.ticketNo != null ? <b className="text-brand-yellow">#{t.ticketNo}</b> : 'Pa biletë'}{t.matchLabel ? ` · ${t.matchLabel}` : ''}</div>
                <div className="text-white/90 truncate mt-0.5">{t.lastFrom === 'STAFF' ? '↩ ' : ''}{t.lastBody}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default SupportInbox;
