import React, { useCallback, useEffect, useRef, useState } from 'react';
import StakeInput from './StakeInput';
import CoinBurst from './CoinBurst';
import CountUp from './CountUp';
import BigWin, { winTier } from './BigWin';
import { casinoCrashStart, casinoCrashState, casinoCrashCashout } from '../../services/api';
import { sfx, setSound, soundOn } from './slotSound';
import './casino.css';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }
type Phase = 'idle' | 'running' | 'won' | 'crashed';

const W = 600; const H = 300; const T_WINDOW_MIN = 8;

// CRASH: the multiplier rockets up a curve. Cash out before it blows. The server owns the crash point; the browser only draws.
const Crash: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [stake, setStake] = useState(100);
  const [auto, setAuto] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [mult, setMult] = useState(1);
  const [growth, setGrowth] = useState(0.12);
  const [elapsed, setElapsed] = useState(0);
  const [msg, setMsg] = useState('Set your stake and launch');
  const [history, setHistory] = useState<number[]>([]);
  const [winAmt, setWinAmt] = useState(0);
  const [burst, setBurst] = useState(0);
  const [bigWin, setBigWin] = useState<{ tier: 1 | 2 | 3; amount: number } | null>(null);
  const [snd, setSnd] = useState(soundOn());
  const round = useRef<{ id: string; t0: number; stake: number } | null>(null);
  const alive = useRef(true);
  const busyCash = useRef(false);

  useEffect(() => () => { alive.current = false; }, []);

  const end = useCallback((status: 'won' | 'crashed', m: number, payout: number, balance?: number) => {
    if (balance !== undefined) onSetBalance(balance);
    setMult(m); setPhase(status); setHistory((h) => [m, ...h].slice(0, 14));
    const st = round.current?.stake ?? 0;
    round.current = null;
    if (status === 'won') {
      setWinAmt(payout); setMsg(`Cashed out at ${m.toFixed(2)}x`); sfx.win(m >= 3); if (m >= 2) setBurst((b) => b + 1);
      const tier = winTier(payout, st); if (tier > 0) setBigWin({ tier: tier as 1 | 2 | 3, amount: payout });
    } else { setWinAmt(0); setMsg(`Crashed at ${m.toFixed(2)}x`); sfx.stop(); }
  }, [onSetBalance]);

  // animation clock + server polling while a round is running
  useEffect(() => {
    if (phase !== 'running') return undefined;
    let raf = 0; let stopped = false;
    const tick = () => {
      if (stopped || !round.current) return;
      const t = (performance.now() - round.current.t0) / 1000;
      setElapsed(t); setMult(Math.floor(Math.exp(growth * t) * 100) / 100);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const poll = window.setInterval(async () => {
      const r = round.current; if (!r || busyCash.current) return;
      try {
        const s = await casinoCrashState(r.id);
        if (!alive.current || !round.current) return;
        if (s.status === 'CRASHED') end('crashed', s.crashPoint ?? 1, 0, s.balance);
        else if (s.status === 'WON') end('won', s.multiplier ?? 1, s.payout ?? 0, s.balance);
      } catch { /* next poll retries */ }
    }, 280);
    return () => { stopped = true; cancelAnimationFrame(raf); window.clearInterval(poll); };
  }, [phase, growth, end]);

  const launch = async () => {
    if (userBalance < stake) { setMsg('Insufficient balance'); return; }
    try {
      const a = auto.trim() ? Number(auto) : null;
      const r = await casinoCrashStart(stake, a);
      onSetBalance(r.balance); setGrowth(r.growth);
      round.current = { id: r.roundId, t0: performance.now(), stake };
      setMult(1); setElapsed(0); setWinAmt(0); setPhase('running'); setMsg(r.autoCashout ? `Auto cash-out at ${r.autoCashout}x` : 'Cash out before it crashes!'); sfx.spin();
    } catch (e: any) { setMsg(e?.message || 'Error'); }
  };
  const cashout = async () => {
    const r = round.current; if (!r || busyCash.current) return;
    busyCash.current = true;
    try {
      const s = await casinoCrashCashout(r.id);
      if (s.status === 'WON') end('won', s.multiplier ?? 1, s.payout ?? 0, s.balance);
      else end('crashed', s.crashPoint ?? 1, 0, s.balance);
    } catch (e: any) { setMsg(e?.message || 'Error'); } finally { busyCash.current = false; }
  };

  // curve points
  const tMax = Math.max(T_WINDOW_MIN, elapsed * 1.15);
  const mMax = Math.max(2, Math.exp(growth * tMax));
  const pts: string[] = [];
  const steps = 60;
  const tEnd = phase === 'idle' ? 0 : elapsed || Math.log(Math.max(1, mult)) / growth;
  for (let i = 0; i <= steps; i += 1) {
    const t = (tEnd * i) / steps; const m = Math.exp(growth * t);
    pts.push(`${(t / tMax) * W},${H - ((m - 1) / (mMax - 1)) * (H - 20) - 10}`);
  }
  const tip = pts[pts.length - 1]?.split(',').map(Number) ?? [0, H - 10];
  const color = phase === 'crashed' ? '#ef4444' : phase === 'won' ? '#22c55e' : '#facc15';

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-6 text-white">
      {burst > 0 && <CoinBurst key={burst} />}
      {bigWin && <BigWin tier={bigWin.tier} amount={bigWin.amount} format={(v) => `${v.toFixed(2)} L`} onDone={() => setBigWin(null)} />}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onClose} className="text-sm text-gray-300 hover:text-white">← Casino</button>
        <div className="font-extrabold text-xl text-brand-yellow tracking-wide">CRASH</div>
        <button onClick={() => { setSound(!snd); setSnd(!snd); }} className="text-sm px-2 py-1 rounded bg-white/10">{snd ? '🔊' : '🔇'}</button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2" aria-label="Recent crashes">
        {history.length === 0 && <span className="text-[11px] text-gray-500">Recent rounds will show here</span>}
        {history.map((h, i) => <span key={i} className={`px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums whitespace-nowrap ${h >= 2 ? 'bg-emerald-600/80' : 'bg-slate-600/80'}`}>{h.toFixed(2)}x</span>)}
      </div>

      <div className={`relative rounded-2xl overflow-hidden border-2 border-yellow-500/50 cabinet-glow ${phase === 'crashed' ? 'cabinet-shake' : ''}`} style={{ background: 'radial-gradient(circle at 20% 100%, #1e1b4b, #020617 70%)' }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" role="img" aria-label="Multiplier curve">
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgba(255,255,255,.06)" />)}
          {phase !== 'idle' && <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 8px ${color})` }} />}
          {phase !== 'idle' && <polygon points={`0,${H} ${pts.join(' ')} ${tip[0]},${H}`} fill={color} opacity=".12" />}
          {phase === 'running' && <g transform={`translate(${tip[0]},${tip[1]})`}><circle r="9" fill={color} /><circle r="16" fill={color} opacity=".25"><animate attributeName="r" values="10;22;10" dur="0.9s" repeatCount="indefinite" /></circle></g>}
          {phase === 'crashed' && <g transform={`translate(${tip[0]},${tip[1]})`}><circle r="26" fill="#ef4444" opacity=".35" /><text y="10" textAnchor="middle" fontSize="34">💥</text></g>}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className={`font-black tabular-nums leading-none ${phase === 'crashed' ? 'text-red-400' : phase === 'won' ? 'text-emerald-300' : 'text-white'}`} style={{ fontSize: 'clamp(48px, 14vw, 96px)', textShadow: '0 4px 0 rgba(0,0,0,.5), 0 0 30px rgba(250,204,21,.4)' }}>{mult.toFixed(2)}x</div>
          <div className="mt-2 text-sm font-bold text-gray-200">
            {phase === 'won' && winAmt > 0 ? <span className="text-brand-yellow win-pop">You won <CountUp value={winAmt} format={(v) => `${v.toFixed(2)} L`} /></span> : msg}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] items-end">
        <StakeInput value={stake} onChange={setStake} min={1} max={5000} presets={[10, 50, 100, 500, 1000]} unit="L" balance={userBalance} disabled={phase === 'running'} />
        <label className="text-xs text-gray-300 flex flex-col gap-1">
          Auto cash-out (optional)
          <input value={auto} disabled={phase === 'running'} onChange={(e) => /^\d{0,4}(\.\d{0,2})?$/.test(e.target.value) && setAuto(e.target.value)} placeholder="e.g. 2.00" inputMode="decimal" className="w-32 rounded-lg bg-black/60 border border-white/20 px-2 py-2 text-center font-bold text-white" />
        </label>
      </div>
      {phase === 'running'
        ? <button onClick={cashout} className="mt-3 w-full py-4 rounded-xl font-black text-xl bg-gradient-to-b from-amber-300 to-orange-600 text-black shadow-lg active:scale-[.98]">CASH OUT · {(stake * mult).toFixed(2)} L</button>
        : <button onClick={launch} disabled={userBalance < stake} className="mt-3 w-full py-4 rounded-xl font-black text-xl bg-gradient-to-b from-green-400 to-green-700 text-white shadow-lg disabled:opacity-50 active:scale-[.98]">LAUNCH · {stake} L</button>}
      <div className="text-[11px] text-gray-400 mt-2 text-center">Balance: <b className="tabular-nums text-white">{userBalance.toFixed(2)} L</b> · RTP 96% · the crash point is drawn by the server before launch</div>
    </div>
  );
};
export default Crash;
