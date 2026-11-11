import React, { useCallback, useEffect, useRef, useState } from 'react';
import RouletteWheel, { WheelPhase } from './RouletteWheel';
import StakeInput from './StakeInput';
import CoinBurst from './CoinBurst';
import CountUp from './CountUp';
import BigWin, { winTier } from './BigWin';
import { casinoLiveRouletteState, casinoLiveRouletteBet, LiveRouletteState } from '../../services/api';
import { sfx, setSound, soundOn } from './slotSound';
import './casino.css';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }
const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const colorOf = (n: number) => (n === 0 ? 'bg-green-700' : RED.includes(n) ? 'bg-red-700' : 'bg-zinc-900');
// standard table layout: 3 rows x 12 columns
const ROWS = [0, 1, 2].map((r) => Array.from({ length: 12 }, (_, c) => c * 3 + (3 - r)));
const OUTSIDE: { spot: string; label: string; cls: string }[] = [
  { spot: 'D1', label: '1st 12', cls: '' }, { spot: 'D2', label: '2nd 12', cls: '' }, { spot: 'D3', label: '3rd 12', cls: '' },
  { spot: 'LOW', label: '1-18', cls: '' }, { spot: 'EVEN', label: 'EVEN', cls: '' }, { spot: 'RED', label: 'RED', cls: 'bg-red-700' },
  { spot: 'BLACK', label: 'BLACK', cls: 'bg-zinc-900' }, { spot: 'ODD', label: 'ODD', cls: '' }, { spot: 'HIGH', label: '19-36', cls: '' },
];

// LIVE ROULETTE: one wheel for the whole table, a new spin every 30 seconds (20 s to bet).
const LiveRoulette: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [st, setSt] = useState<LiveRouletteState | null>(null);
  const [chip, setChip] = useState(50);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [left, setLeft] = useState(0);
  const [wheel, setWheel] = useState<WheelPhase>('idle');
  const [landResult, setLandResult] = useState<number | null>(null);
  const [shown, setShown] = useState<number[]>([]);
  const [msg, setMsg] = useState('Place your bets');
  const [winAmt, setWinAmt] = useState(0);
  const [burst, setBurst] = useState(0);
  const [bigWin, setBigWin] = useState<{ tier: 1 | 2 | 3; amount: number } | null>(null);
  const [snd, setSnd] = useState(soundOn());
  const offset = useRef(0); const lastRound = useRef<number | null>(null); const landedFor = useRef<number | null>(null);
  const pendingSettle = useRef<LiveRouletteState['settled']>([]);
  const alive = useRef(true);
  const stRef = useRef<LiveRouletteState | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await casinoLiveRouletteState();
      if (!alive.current) return;
      offset.current = s.serverNow - Date.now(); stRef.current = s; setSt(s); onSetBalance(s.balance);
      if (s.settled.length) pendingSettle.current = [...pendingSettle.current, ...s.settled];
      if (lastRound.current !== null && lastRound.current !== s.round) setDraft({});
      lastRound.current = s.round;
      if (s.phase === 'spin' && s.result !== null && landedFor.current !== s.round) { landedFor.current = s.round; setLandResult(s.result); setWheel('landing'); sfx.spin(); }
      if (s.phase === 'betting' && wheelRef.current !== 'idle') { setWheel('idle'); setMsg('Place your bets'); }
    } catch { /* retry on next tick */ }
  }, [onSetBalance]);
  const wheelRef = useRef<WheelPhase>('idle');
  useEffect(() => { wheelRef.current = wheel; }, [wheel]);

  useEffect(() => { alive.current = true; refresh(); const t = window.setInterval(refresh, 1500); return () => { alive.current = false; window.clearInterval(t); }; }, [refresh]);
  useEffect(() => {
    const t = window.setInterval(() => {
      const s = stRef.current; if (!s) return;
      const now = Date.now() + offset.current; const el = now % s.cycleMs;
      setLeft(el < s.betMs ? s.betMs - el : s.cycleMs - el);
      if (el >= s.betMs && wheelRef.current === 'idle') { setWheel('spinning'); setMsg('No more bets!'); }
    }, 200);
    return () => window.clearInterval(t);
  }, []);

  const onLanded = () => {
    const r = stRef.current?.result; if (r === null || r === undefined) return;
    setShown((h) => [r, ...h].slice(0, 14));
    const mine = pendingSettle.current.filter((x) => x.result === r); pendingSettle.current = [];
    const staked = mine.reduce((a, x) => a + x.staked, 0); const paid = mine.reduce((a, x) => a + x.payout, 0);
    setMsg(`${r} ${r === 0 ? 'GREEN' : RED.includes(r) ? 'RED' : 'BLACK'}`);
    if (paid > 0) { setWinAmt(paid); setBurst((b) => b + 1); sfx.win(true); const t = winTier(paid, staked); if (t > 0) setBigWin({ tier: t as 1 | 2 | 3, amount: paid }); } else if (staked > 0) { setWinAmt(0); sfx.stop(); }
  };

  const betting = st?.phase === 'betting' && wheel === 'idle';
  const add = (spot: string) => { if (!betting) return; sfx.click(); setDraft((d) => ({ ...d, [spot]: Math.round(((d[spot] || 0) + chip) * 100) / 100 })); };
  const draftTotal = Object.values(draft).reduce((a, b) => a + b, 0);
  const place = async () => {
    if (!st || !betting || draftTotal <= 0) return;
    if (draftTotal > userBalance) { setMsg('Insufficient balance'); return; }
    try { const r = await casinoLiveRouletteBet(st.round, draft); onSetBalance(r.balance); setDraft({}); setMsg('Bets placed — good luck!'); refresh(); } catch (e: any) { setMsg(e?.message || 'Error'); }
  };
  const history = st ? (shown.length ? [...shown, ...st.history.filter((h) => !shown.includes(h))].slice(0, 14) : st.history) : [];
  const chipFor = (spot: string) => { const c = (st?.myBets[spot] || 0); const d = draft[spot] || 0; return c + d > 0 ? <span className={`absolute -top-1 -right-1 min-w-[18px] px-1 rounded-full text-[9px] font-black text-black ${d ? 'bg-yellow-300' : 'bg-green-400'}`}>{c + d}</span> : null; };
  const pct = st ? Math.min(1, left / (st.phase === 'betting' ? st.betMs : st.cycleMs - st.betMs)) : 0;

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-6 text-white">
      {burst > 0 && <CoinBurst key={burst} />}
      {bigWin && <BigWin tier={bigWin.tier} amount={bigWin.amount} format={(v) => `${v.toFixed(2)} L`} onDone={() => setBigWin(null)} />}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onClose} className="text-sm text-gray-300 hover:text-white">← Casino</button>
        <div className="font-extrabold text-xl text-brand-yellow tracking-wide flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />LIVE ROULETTE</div>
        <button onClick={() => { setSound(!snd); setSnd(!snd); }} className="text-sm px-2 py-1 rounded bg-white/10">{snd ? '🔊' : '🔇'}</button>
      </div>

      <div className="rounded-2xl border-2 border-emerald-600/50 p-3 cabinet-glow" style={{ background: 'radial-gradient(circle at 50% 0%, #065f46, #022c22 75%)' }}>
        <div className="flex items-center justify-between text-xs text-emerald-100/80 mb-1">
          <span>Spin #{st?.round ?? '…'}{st?.simulatedPlayers && st.tablePlayers ? ` · ${st.tablePlayers} players at the table` : ''}</span>
          <span className="font-bold tabular-nums">{st?.phase === 'betting' && wheel === 'idle' ? `Bets close in ${Math.ceil(left / 1000)}s` : 'Wheel is spinning'}</span>
        </div>
        <div className="h-1.5 rounded-full bg-black/40 overflow-hidden mb-2"><div className={`h-full ${betting ? 'bg-yellow-300' : 'bg-red-500'}`} style={{ width: `${pct * 100}%`, transition: 'width .2s linear' }} /></div>
        <div className="flex justify-center"><RouletteWheel phase={wheel} result={landResult} onLanded={onLanded} size={260} /></div>
        <div className="flex gap-1 justify-center flex-wrap my-2 min-h-[24px]">{history.map((n, i) => <span key={`${n}-${i}`} className={`w-6 h-6 rounded-full text-[11px] font-black flex items-center justify-center ${colorOf(n)} ${i === 0 ? 'ring-2 ring-yellow-300' : ''}`}>{n}</span>)}</div>
        <div className="text-center font-bold min-h-[26px]">{winAmt > 0 ? <span className="text-brand-yellow win-pop inline-block text-lg">You won <CountUp value={winAmt} format={(v) => `${v.toFixed(2)} L`} /></span> : msg}</div>
      </div>

      <div className="mt-3 overflow-x-auto"><div className="min-w-[560px]">
        <div className="grid" style={{ gridTemplateColumns: '38px repeat(12, 1fr)' }}>
          <button disabled={!betting} onClick={() => add('0')} className={`relative row-span-3 rounded-l-md border border-white/20 font-black ${colorOf(0)} disabled:opacity-70`}>0{chipFor('0')}</button>
          {ROWS.flat().map((n) => <button key={n} disabled={!betting} onClick={() => add(String(n))} className={`relative h-9 border border-white/15 text-sm font-bold ${colorOf(n)} hover:brightness-125 disabled:opacity-70`}>{n}{chipFor(String(n))}</button>)}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-9 gap-1 mt-1">
          {OUTSIDE.map((o) => <button key={o.spot} disabled={!betting} onClick={() => add(o.spot)} className={`relative h-9 rounded border border-white/20 text-[11px] font-bold ${o.cls || 'bg-black/40'} hover:brightness-125 disabled:opacity-70`}>{o.label}{chipFor(o.spot)}</button>)}
        </div>
      </div></div>

      <div className="mt-3"><StakeInput value={chip} onChange={setChip} min={1} max={5000} presets={[10, 50, 100, 500, 1000]} unit="L" balance={userBalance} disabled={!betting} /></div>
      <div className="flex gap-2 mt-2">
        <button disabled={!betting || draftTotal === 0} onClick={() => setDraft({})} className="px-4 rounded-xl border border-white/20 text-gray-200 disabled:opacity-40">Clear</button>
        <button onClick={place} disabled={!betting || draftTotal === 0 || draftTotal > userBalance} className="flex-1 py-3.5 rounded-xl font-black text-lg bg-gradient-to-b from-green-400 to-green-700 text-white shadow-lg disabled:opacity-50">{draftTotal ? `PLACE BETS · ${draftTotal.toFixed(2)} L` : 'TAP THE TABLE TO BET'}</button>
      </div>
      <div className="text-[11px] text-gray-400 mt-2 text-center">Balance: <b className="tabular-nums text-white">{userBalance.toFixed(2)} L</b> · European roulette, single zero · max 5000 L per spin · credit only{st?.simulatedPlayers ? ' · table includes simulated players' : ''}</div>
    </div>
  );
};
export default LiveRoulette;
