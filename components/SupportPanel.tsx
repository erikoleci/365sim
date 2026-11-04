import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../services/api';
import type { Bet } from '../types';

// Player side of Support: write a problem (optionally tag one of your tickets and one of its matches), read the answers.
// Answers come from "Support": the player is never told which admin wrote them.
const FIELD = 'w-full rounded-lg border border-brand-divider bg-brand-bg text-white placeholder:text-brand-textMuted px-3 py-2 text-sm outline-none focus:border-brand-yellow [color-scheme:dark]';
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const Compose: React.FC<{ myBets: Bet[]; initialBetId?: string | null; onCreated: (id: string) => void; onCancel: () => void }> = ({ myBets, initialBetId, onCreated, onCancel }) => {
  const [betId, setBetId] = useState<string>(initialBetId || '');
  const [legIdx, setLegIdx] = useState<number>(-1);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [fresh, setFresh] = useState<Bet[] | null>(null);
  useEffect(() => { let on = true; api.fetchMyBets().then((b) => { if (on) setFresh(b); }).catch(() => {}); return () => { on = false; }; }, []);
  const bets = fresh && fresh.length ? fresh : myBets;
  const bet = bets.find((b) => b.id === betId);
  useEffect(() => setLegIdx(-1), [betId]);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const leg = bet && legIdx >= 0 ? bet.selections[legIdx] : null;
      const r = await api.supportCreate({ message: text.trim(), betId: betId || undefined, matchLabel: leg ? `${leg.matchHome} - ${leg.matchAway}` : undefined });
      onCreated(r.id);
    } catch (e: any) { setErr(e?.message || 'Gabim'); setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div className="bg-brand-bg rounded-lg p-3 text-xs text-brand-textMuted leading-relaxed">
        <p className="text-white font-bold mb-1">Shkruaj problemin që shikon</p>
        <p>Për shembull: bileta është mbyllur gabim, bileta është ende e hapur ndërsa ndeshja ka mbaruar, serveri ka ngecur ose rezultati nuk përditësohet. Zgjidh biletën më poshtë që ta shohim shpejt.</p>
      </div>
      <label className="block text-[11px] text-brand-textMuted">Bileta (opsionale)
        <select value={betId} onChange={(e) => setBetId(e.target.value)} className={FIELD + " mt-1"}>
          <option value="">— pa biletë —</option>
          {bets.slice(0, 60).map((b) => (
            <option key={b.id} value={b.id}>#{b.ticketNo ?? b.id.slice(-6)} · {b.selections.length > 1 ? `${b.selections.length}-Fish` : 'Bast i thjeshtë'} · {b.status}</option>
          ))}
        </select>
      </label>
      {bet && bet.selections.length > 0 && (
        <label className="block text-[11px] text-brand-textMuted">Ndeshja e biletës (opsionale)
          <select value={legIdx} onChange={(e) => setLegIdx(Number(e.target.value))} className={FIELD + " mt-1"}>
            <option value={-1}>— e gjithë bileta —</option>
            {bet.selections.map((l, i) => <option key={i} value={i}>{l.matchHome} - {l.matchAway} · {l.selectionName}</option>)}
          </select>
        </label>
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={5} placeholder="Shkruaj këtu…" className={FIELD} />
      {err && <div className="text-red-400 text-xs">{err}</div>}
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 border border-brand-divider text-brand-text py-2 rounded font-bold">Anulo</button>
        <button onClick={send} disabled={busy || !text.trim()} className="flex-1 bg-brand-yellow text-brand-bg py-2 rounded font-bold disabled:opacity-50">Dërgo</button>
      </div>
    </div>
  );
};

const Conversation: React.FC<{ id: string; onBack: () => void }> = ({ id, onBack }) => {
  const [data, setData] = useState<{ thread: api.SupportThread; messages: api.SupportMessage[] } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => { try { setData(await api.supportThread(id)); } catch { /* keep what is shown */ } }, [id]);
  useEffect(() => {
    load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 8000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [data?.messages.length]);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await api.supportReply(id, text.trim()); setText(''); await load(); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col h-full">
      <button onClick={onBack} className="text-xs text-brand-textMuted hover:text-white text-left mb-2">← Të gjitha mesazhet</button>
      {data?.thread.ticketNo != null && <div className="text-[11px] text-brand-yellow mb-2">Bileta #{data.thread.ticketNo}{data.thread.matchLabel ? ` · ${data.thread.matchLabel}` : ''}</div>}
      <div className="flex-1 overflow-y-auto space-y-2 pb-2">
        {(data?.messages || []).map((m) => (
          <div key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.from === 'me' ? 'ml-auto bg-brand-yellow/90 text-brand-bg' : 'bg-brand-bg text-white'}`}>
            {m.from !== 'me' && <div className="text-[10px] font-bold text-brand-accent mb-0.5">Support</div>}
            <div className="whitespace-pre-wrap break-words">{m.body}</div>
            <div className="text-[10px] opacity-60 mt-1 text-right">{when(m.at)}</div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <div className="flex gap-2 pt-2 border-t border-brand-divider">
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={2} placeholder="Shkruaj një mesazh…" className={FIELD + " flex-1"} />
        <button onClick={send} disabled={busy || !text.trim()} className="bg-brand-yellow text-brand-bg px-4 rounded font-bold disabled:opacity-50">Dërgo</button>
      </div>
    </div>
  );
};

const SupportPanel: React.FC<{ myBets: Bet[]; initialBetId?: string | null; onSeen?: () => void }> = ({ myBets, initialBetId, onSeen }) => {
  const [threads, setThreads] = useState<api.SupportThread[] | null>(null);
  const [composing, setComposing] = useState<boolean>(!!initialBetId);
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(async () => { try { setThreads((await api.supportThreads()).threads); } catch { setThreads((p) => p ?? []); } }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 10000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => { if (initialBetId) { setComposing(true); setOpenId(null); } }, [initialBetId]);

  if (composing) return <Compose myBets={myBets} initialBetId={initialBetId} onCancel={() => setComposing(false)} onCreated={(id) => { setComposing(false); setOpenId(id); load(); }} />;
  if (openId) return <Conversation id={openId} onBack={() => { setOpenId(null); load(); onSeen?.(); }} />;
  return (
    <div className="space-y-2">
      <button onClick={() => setComposing(true)} className="w-full bg-brand-yellow text-brand-bg py-2.5 rounded-lg font-bold">Shkruaj një problem</button>
      {threads == null && <div className="text-center text-brand-textMuted text-xs py-6">Duke ngarkuar…</div>}
      {threads && threads.length === 0 && <div className="text-center text-brand-textMuted text-xs py-8 leading-relaxed">Nuk ke shkruar ende asnjë problem.<br />Shkruaj nëse një biletë mbyllet gabim, mbetet e hapur ose serveri ngec.</div>}
      {(threads || []).map((t) => (
        <button key={t.id} onClick={() => setOpenId(t.id)} className="w-full text-left bg-brand-bg rounded-lg p-2.5 border border-brand-divider hover:border-brand-yellow/60">
          <div className="flex items-center justify-between text-[11px] text-brand-textMuted">
            <span>{t.ticketNo != null ? <b className="text-brand-yellow">#{t.ticketNo}</b> : 'Pa biletë'}{t.matchLabel ? ` · ${t.matchLabel}` : ''}</span>
            <span>{when(t.lastMessageAt)}</span>
          </div>
          <div className="text-sm text-white truncate mt-0.5">{t.unread && <span className="inline-block w-2 h-2 rounded-full bg-brand-accent mr-1.5" />}{t.lastBody}</div>
          {t.status === 'CLOSED' && <div className="text-[10px] text-brand-textMuted mt-0.5">Mbyllur</div>}
        </button>
      ))}
    </div>
  );
};

export default SupportPanel;
