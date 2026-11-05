import React, { useCallback, useEffect, useRef, useState } from 'react';
import StakeInput from './StakeInput';
import CoinBurst from './CoinBurst';
import CountUp from './CountUp';
import BigWin, { winTier } from './BigWin';
import { casinoLiveHorsesState, casinoLiveHorsesBet, LiveHorsesState } from '../../services/api';
import { sfx, setSound, soundOn } from './slotSound';
import './casino.css';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

// LIVE HORSE RACE: one shared race every 45 seconds (30 s to bet). Everybody at the table watches the same race.
const LiveHorses: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [st, setSt] = useState<LiveHorsesState | null>(null);
  const [chip, setChip] = useState(50);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [left, setLeft] = useState(0);
  const [progress, setProgress] = useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [racing, setRacing] = useState(false);
  const [finished, setFinished] = useState<number[] | null>(null);
  const [msg, setMsg] = useState('Back your horses');
  const [winAmt, setWinAmt] = useState(0);
  const [burst, setBurst] = useState(0);
  const [bigWin, setBigWin] = useState<{ tier: 1 | 2 | 3; amount: number } | null>(null);
  const [snd, setSnd] = useState(soundOn());
  const offset = useRef(0); const stRef = useRef<LiveHorsesState | null>(null); const lastRound = useRef<number | null>(null);
  const racedFor = useRef<number | null>(null); const pending = useRef<LiveHorsesState['settled']>([]);
  const alive = useRef(true); const raf = useRef(0);

  const run = useCallback((order: number[], startedAt: number) => {
    setRacing(true); setFinished(null);
    const finish = order.map((_, place) => 6.5 + place * 0.45);
    const t = Array(6).fill(0); order.forEach((id, place) => { t[id] = finish[place]; });
    const wob = Array.from({ length: 6 }, (_, i) => ({ a: 0.04 + ((i * 37) % 5) * 0.012, f: 2 + (i % 3), p: i * 1.3 }));
    const tick = () => {
      if (!alive.current) return;
      const s = Math.max(0, (Date.now() + offset.current - startedAt) / 1000);
      setProgress(t.map((T, i) => { const x = Math.min(1, s / T); return Math.min(1, x + Math.sin(x * Math.PI) * wob[i].a * Math.sin(wob[i].f * x * 6 + wob[i].p)); }));
      if (s >= finish[5]) {
        setProgress(t.map(() => 1)); setFinished(order); setRacing(false);
        const mine = pending.current.filter((x) => x.order[0] === order[0]); pending.current = [];
        const staked = mine.reduce((a, x) => a + x.staked, 0); const paid = mine.reduce((a, x) => a + x.payout, 0);
        setMsg(`${stRef.current?.horses[order[0]]?.name ?? 'Horse'} wins!`);
        if (paid > 0) { setWinAmt(paid); setBurst((b) => b + 1); sfx.win(true); const tier = winTier(paid, staked); if (tier > 0) setBigWin({ tier: tier as 1 | 2 | 3, amount: paid }); } else if (staked > 0) sfx.stop();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(tick);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await casinoLiveHorsesState();
      if (!alive.current) return;
      offset.current = s.serverNow - Date.now(); stRef.current = s; setSt(s); onSetBalance(s.balance);
      if (s.settled.length) pending.current = [...pending.current, ...s.settled];
      if (lastRound.current !== null && lastRound.current !== s.round) { setDraft({}); setProgress([0, 0, 0, 0, 0, 0]); setFinished(null); setWinAmt(0); setMsg('Back your horses'); }
      lastRound.current = s.round;
      if (s.phase === 'race' && s.order && racedFor.current !== s.round) {
        racedFor.current = s.round; setMsg('And they\'re off!'); sfx.spin();
        run(s.order, Math.floor((s.serverNow) / s.cycleMs) * s.cycleMs + s.betMs);
      }
    } catch { /* retry */ }
  }, [onSetBalance, run]);

  useEffect(() => { alive.current = true; refresh(); const t = window.setInterval(refresh, 1500); return () => { alive.current = false; window.clearInterval(t); cancelAnimationFrame(raf.current); }; }, [refresh]);
  useEffect(() => {
    const t = window.setInterval(() => { const s = stRef.current; if (!s) return; const el = (Date.now() + offset.current) % s.cycleMs; setLeft(el < s.betMs ? s.betMs - el : s.cycleMs - el); }, 200);
    return () => window.clearInterval(t);
  }, []);

  const betting = st?.phase === 'betting' && (Date.now() + offset.current) % (st?.cycleMs ?? 45000) < (st?.betMs ?? 30000);
  const add = (id: number) => { if (!betting) return; sfx.click(); setDraft((d) => ({ ...d, [id]: Math.round(((d[id] || 0) + chip) * 100) / 100 })); };
  const draftTotal = Object.values(draft).reduce((a, b) => a + b, 0);
  const place = async () => {
    if (!st || !betting || draftTotal <= 0) return;
    if (draftTotal > userBalance) { setMsg('Insufficient balance'); return; }
    try { const r = await casinoLiveHorsesBet(st.round, draft); onSetBalance(r.balance); setDraft({}); setMsg('Bets placed — good luck!'); refresh(); } catch (e: any) { setMsg(e?.message || 'Error'); }
  };
  const horses = st?.horses ?? [];
  const pct = st ? Math.min(1, left / (st.phase === 'betting' ? st.betMs : st.cycleMs - st.betMs)) : 0;

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-6 text-white">
      {burst > 0 && <CoinBurst key={burst} />}
      {bigWin && <BigWin tier={bigWin.tier} amount={bigWin.amount} format={(v) => `${v.toFixed(2)} L`} onDone={() => setBigWin(null)} />}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onClose} className="text-sm text-gray-300 hover:text-white">← Casino</button>
        <div className="font-extrabold text-xl text-brand-yellow tracking-wide flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />LIVE HORSE RACE</div>
        <button onClick={() => { setSound(!snd); setSnd(!snd); }} className="text-sm px-2 py-1 rounded bg-white/10">{snd ? '🔊' : '🔇'}</button>
      </div>
      <div className="flex items-center justify-between text-xs text-emerald-100/80 mb-1">
        <span>Race #{st?.round ?? '…'}{st?.simulatedPlayers && st.tablePlayers ? ` · ${st.tablePlayers} players at the table` : ''}</span>
        <span className="font-bold tabular-nums">{betting ? `Bets close in ${Math.ceil(left / 1000)}s` : racing ? 'Race in progress' : 'Next race soon'}</span>
      </div>
      <div className="h-1.5 rounded-full bg-black/40 overflow-hidden mb-2"><div className={`h-full ${betting ? 'bg-yellow-300' : 'bg-red-500'}`} style={{ width: `${pct * 100}%`, transition: 'width .2s linear' }} /></div>

      <div className="rounded-2xl overflow-hidden border-2 border-amber-700/60 relative" style={{ background: 'linear-gradient(#14532d, #166534)' }}>
        <div className="absolute top-0 bottom-0 right-[7%] w-1.5 z-10" style={{ background: 'repeating-linear-gradient(0deg, #fff 0 8px, #111 8px 16px)' }} aria-hidden />
        {horses.map((h, i) => (
          <div key={h.id} className="relative h-11 border-b border-white/10" style={{ background: i % 2 ? 'rgba(0,0,0,.12)' : undefined }}>
            <div className="absolute left-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-[11px] font-black flex items-center justify-center text-black" style={{ background: h.color }}>{h.id + 1}</div>
            <div className="absolute top-1/2 text-3xl select-none" style={{ left: `calc(${progress[i] * 82}% + 28px)`, transform: 'translateY(-50%) scaleX(-1)', filter: `drop-shadow(0 3px 2px rgba(0,0,0,.5)) drop-shadow(0 0 6px ${h.color})` }}>🏇</div>
            {finished && <div className="absolute right-1 top-1/2 -translate-y-1/2 text-[11px] font-black px-1.5 rounded bg-black/60">{ORDINAL[finished.indexOf(h.id)]}</div>}
          </div>
        ))}
      </div>
      <div className="flex gap-1 justify-center my-2 min-h-[22px]">{(st?.winners ?? []).map((w, i) => <span key={i} className="w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center text-black" style={{ background: horses[w]?.color }}>{w + 1}</span>)}</div>
      <div className="text-center font-bold min-h-[26px]">{winAmt > 0 ? <span className="text-brand-yellow win-pop inline-block text-lg">You won <CountUp value={winAmt} format={(v) => `${v.toFixed(2)} L`} /></span> : msg}</div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
        {horses.map((h) => {
          const on = (st?.myBets[h.id] || 0) + (draft[h.id] || 0);
          return (
            <button key={h.id} disabled={!betting} onClick={() => add(h.id)} className={`relative rounded-xl p-2 text-left border-2 transition ${on ? 'border-yellow-300 bg-yellow-300/10' : 'border-white/10 bg-black/40 hover:bg-black/60'} disabled:opacity-70`}>
              <div className="flex items-center gap-2"><span className="w-5 h-5 rounded-full text-[11px] font-black flex items-center justify-center text-black" style={{ background: h.color }}>{h.id + 1}</span><span className="text-sm font-bold truncate">{h.name}</span></div>
              <div className="text-lg font-black text-brand-yellow tabular-nums mt-0.5">{h.odds.toFixed(2)}x</div>
              {on > 0 && <span className={`absolute -top-1 -right-1 min-w-[20px] px-1 rounded-full text-[10px] font-black text-black ${draft[h.id] ? 'bg-yellow-300' : 'bg-green-400'}`}>{on}</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-3"><StakeInput value={chip} onChange={setChip} min={1} max={5000} presets={[10, 50, 100, 500, 1000]} unit="L" balance={userBalance} disabled={!betting} /></div>
      <div className="flex gap-2 mt-2">
        <button disabled={!betting || draftTotal === 0} onClick={() => setDraft({})} className="px-4 rounded-xl border border-white/20 text-gray-200 disabled:opacity-40">Clear</button>
        <button onClick={place} disabled={!betting || draftTotal === 0 || draftTotal > userBalance} className="flex-1 py-3.5 rounded-xl font-black text-lg bg-gradient-to-b from-green-400 to-green-700 text-white shadow-lg disabled:opacity-50">{draftTotal ? `PLACE BETS · ${draftTotal.toFixed(2)} L` : 'TAP A HORSE TO BET'}</button>
      </div>
      <div className="text-[11px] text-gray-400 mt-2 text-center">Balance: <b className="tabular-nums text-white">{userBalance.toFixed(2)} L</b> · RTP 95% · max 5000 L per race · credit only{st?.simulatedPlayers ? ' · table includes simulated players' : ''}</div>
    </div>
  );
};
export default LiveHorses;
