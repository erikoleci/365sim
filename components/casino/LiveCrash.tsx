import React, { useCallback, useEffect, useRef, useState } from 'react';
import StakeInput from './StakeInput';
import CoinBurst from './CoinBurst';
import CountUp from './CountUp';
import BigWin, { winTier } from './BigWin';
import { casinoLiveCrashState, casinoLiveCrashBet, casinoLiveCrashCashout, LiveCrashState } from '../../services/api';
import { sfx, setSound, soundOn } from './slotSound';
import './casino.css';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }
const W = 600; const H = 300;

// LIVE CRASH: one rocket for the whole table every 40 s. Bet in the 10 s window, cash out before it crashes.
const LiveCrash: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [st, setSt] = useState<LiveCrashState | null>(null);
  const [stake, setStake] = useState(100);
  const [auto, setAuto] = useState('');
  const [now, setNow] = useState(Date.now());
  const [msg, setMsg] = useState('');
  const [cashed, setCashed] = useState<number | null>(null);
  const [winAmt, setWinAmt] = useState(0);
  const [burst, setBurst] = useState(0);
  const [bigWin, setBigWin] = useState<{ tier: 1 | 2 | 3; amount: number } | null>(null);
  const [snd, setSnd] = useState(soundOn());
  const offset = useRef(0); const alive = useRef(true); const stRef = useRef<LiveCrashState | null>(null); const lastRound = useRef<number | null>(null);
  const busy = useRef(false);

  const celebrate = (payout: number, staked: number) => {
    if (payout > 0) { setWinAmt(payout); setBurst((b) => b + 1); sfx.win(true); const t = winTier(payout, staked); if (t > 0) setBigWin({ tier: t as 1 | 2 | 3, amount: payout }); }
  };
  const refresh = useCallback(async () => {
    try {
      const s = await casinoLiveCrashState();
      if (!alive.current) return;
      offset.current = s.serverNow - Date.now(); stRef.current = s; setSt(s); onSetBalance(s.balance);
      if (lastRound.current !== null && lastRound.current !== s.round) { setCashed(null); setWinAmt(0); setMsg(''); }
      lastRound.current = s.round;
      for (const x of s.settled) { if (x.payout > 0) { setCashed(x.multiplier); celebrate(x.payout, x.staked); setMsg(`Cashed out at ${x.multiplier.toFixed(2)}x`); } else { setMsg(`Crashed at ${x.crashPoint.toFixed(2)}x`); sfx.stop(); } }
    } catch { /* retry */ }
  }, [onSetBalance]);

  useEffect(() => { alive.current = true; refresh(); return () => { alive.current = false; }; }, [refresh]);
  useEffect(() => {
    const phase = st?.phase;
    const t = window.setInterval(refresh, phase === 'flight' ? 600 : 1500);
    return () => window.clearInterval(t);
  }, [refresh, st?.phase]);
  // The clock redraws the screen: ~30 fps only while the rocket flies, 4x a second otherwise (a 60 fps loop on a still screen made the whole page heavy).
  const flightPhase = st?.phase === 'flight';
  useEffect(() => {
    if (!flightPhase) { const t = window.setInterval(() => setNow(Date.now() + offset.current), 250); return () => window.clearInterval(t); }
    let r = 0; let last = 0;
    const tick = (ts: number) => { if (ts - last >= 32) { last = ts; setNow(Date.now() + offset.current); } r = requestAnimationFrame(tick); };
    r = requestAnimationFrame(tick); return () => cancelAnimationFrame(r);
  }, [flightPhase]);

  const G = st?.growth ?? 0.18;
  const cycle = st?.cycleMs ?? 40000; const betMs = st?.betMs ?? 10000;
  const inCycle = now % cycle;
  const betting = !!st && st.phase === 'betting' && inCycle < betMs;
  const flightT = Math.max(0, (now - (Math.floor(now / cycle) * cycle + betMs)) / 1000);
  const crashed = st?.phase === 'crashed' && st.crashPoint !== null;
  const mult = crashed ? (st!.crashPoint as number) : betting ? 1 : Math.floor(Math.exp(G * flightT) * 100) / 100;
  const flying = !!st && !crashed && !betting;
  const hasBet = !!st?.my && st.my.round === st.round;

  const place = async () => {
    if (!st || !betting || busy.current) return;
    if (userBalance < stake) { setMsg('Insufficient balance'); return; }
    busy.current = true;
    try { const r = await casinoLiveCrashBet(st.round, stake, auto.trim() ? Number(auto) : null); onSetBalance(r.balance); setMsg('Bet placed — good luck!'); sfx.click(); refresh(); } catch (e: any) { setMsg(e?.message || 'Error'); } finally { busy.current = false; }
  };
  const cashout = async () => {
    if (!flying || !hasBet || busy.current) return;
    busy.current = true;
    try {
      const r = await casinoLiveCrashCashout(); onSetBalance(r.balance);
      if (r.crashed) { setMsg('Too late — it crashed'); sfx.stop(); } else { setCashed(r.multiplier); setMsg(`Cashed out at ${r.multiplier.toFixed(2)}x`); celebrate(r.payout, st?.my?.stake ?? stake); }
      refresh();
    } catch (e: any) { setMsg(e?.message || 'Error'); } finally { busy.current = false; }
  };

  const tMax = Math.max(8, flightT * 1.15); const mMax = Math.max(2, Math.exp(G * tMax));
  const pts: string[] = [];
  const tEnd = betting ? 0 : crashed ? Math.log(Math.max(1, mult)) / G : flightT;
  for (let i = 0; i <= 60; i += 1) { const t = (tEnd * i) / 60; const m = Math.exp(G * t); pts.push(`${(t / tMax) * W},${H - ((m - 1) / (mMax - 1)) * (H - 20) - 10}`); }
  const tip = pts[pts.length - 1].split(',').map(Number);
  const color = crashed ? '#ef4444' : cashed ? '#22c55e' : '#facc15';
  const myActive = hasBet && !cashed && !crashed;

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-6 text-white">
      {burst > 0 && <CoinBurst key={burst} />}
      {bigWin && <BigWin tier={bigWin.tier} amount={bigWin.amount} format={(v) => `${v.toFixed(2)} L`} onDone={() => setBigWin(null)} />}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onClose} className="text-sm text-gray-300 hover:text-white">← Casino</button>
        <div className="font-extrabold text-xl text-brand-yellow tracking-wide flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />LIVE CRASH</div>
        <button onClick={() => { setSound(!snd); setSnd(!snd); }} className="text-sm px-2 py-1 rounded bg-white/10">{snd ? '🔊' : '🔇'}</button>
      </div>
      <div className="flex items-center justify-between text-xs text-gray-300 mb-1">
        <span>Flight #{st?.round ?? '…'}{st?.simulatedPlayers && st.tablePlayers ? ` · ${st.tablePlayers} players on board` : ''}</span>
        <span className="font-bold tabular-nums">{betting ? `Takeoff in ${Math.max(0, Math.ceil((betMs - inCycle) / 1000))}s` : flying ? 'In flight' : 'Next flight soon'}</span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-1">{(st?.history ?? []).map((h, i) => <span key={i} className={`px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums whitespace-nowrap ${h >= 2 ? 'bg-emerald-600/80' : 'bg-slate-600/80'}`}>{h.toFixed(2)}x</span>)}</div>

      <div className={`relative rounded-2xl overflow-hidden border-2 border-yellow-500/50 cabinet-glow ${crashed ? 'cabinet-shake' : ''}`} style={{ background: 'radial-gradient(circle at 20% 100%, #1e1b4b, #020617 70%)' }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" role="img" aria-label="Multiplier curve">
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgba(255,255,255,.06)" />)}
          {!betting && <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="13" strokeLinecap="round" opacity=".22" />}
          {!betting && <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" />}
          {!betting && <polygon points={`0,${H} ${pts.join(' ')} ${tip[0]},${H}`} fill={color} opacity=".12" />}
          {flying && <g transform={`translate(${tip[0]},${tip[1]})`}><circle r="9" fill={color} /><circle r="16" fill={color} opacity=".25"><animate attributeName="r" values="10;22;10" dur="0.9s" repeatCount="indefinite" /></circle></g>}
          {crashed && <g transform={`translate(${tip[0]},${tip[1]})`}><circle r="26" fill="#ef4444" opacity=".35" /><text y="10" textAnchor="middle" fontSize="34">💥</text></g>}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className={`font-black tabular-nums leading-none ${crashed ? 'text-red-400' : cashed ? 'text-emerald-300' : 'text-white'}`} style={{ fontSize: 'clamp(48px, 14vw, 96px)', textShadow: '0 4px 0 rgba(0,0,0,.5), 0 0 30px rgba(250,204,21,.4)' }}>{mult.toFixed(2)}x</div>
          <div className="mt-2 text-sm font-bold text-gray-200 text-center px-2">{winAmt > 0 ? <span className="text-brand-yellow win-pop inline-block">You won <CountUp value={winAmt} format={(v) => `${v.toFixed(2)} L`} /></span> : msg || (betting ? 'Place your bet before takeoff' : '')}</div>
        </div>
      </div>

      {betting && !hasBet && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] items-end">
            <StakeInput value={stake} onChange={setStake} min={1} max={5000} presets={[10, 50, 100, 500, 1000]} unit="L" balance={userBalance} />
            <label className="text-xs text-gray-300 flex flex-col gap-1">Auto cash-out (optional)
              <input value={auto} onChange={(e) => /^\d{0,3}(\.\d{0,2})?$/.test(e.target.value) && setAuto(e.target.value)} placeholder="e.g. 2.00" inputMode="decimal" className="w-32 rounded-lg bg-black/60 border border-white/20 px-2 py-2 text-center font-bold text-white" />
            </label>
          </div>
          <button onClick={place} disabled={userBalance < stake} className="mt-3 w-full py-4 rounded-xl font-black text-xl bg-gradient-to-b from-green-400 to-green-700 text-white shadow-lg disabled:opacity-50">BET · {stake} L</button>
        </>
      )}
      {hasBet && betting && <div className="mt-4 text-center font-bold text-emerald-300">Bet placed: {st?.my?.stake} L{st?.my?.auto ? ` · auto ${st.my.auto}x` : ''} — waiting for takeoff…</div>}
      {myActive && flying && <button onClick={cashout} className="mt-4 w-full py-4 rounded-xl font-black text-xl bg-gradient-to-b from-amber-300 to-orange-600 text-black shadow-lg active:scale-[.98]">CASH OUT · {((st?.my?.stake ?? 0) * mult).toFixed(2)} L</button>}
      {!betting && !myActive && <div className="mt-4 text-center text-sm text-gray-400">{flying ? 'Watching this flight — bet on the next one!' : 'Round over — the next flight starts soon.'}</div>}
      <div className="text-[11px] text-gray-400 mt-3 text-center">Balance: <b className="tabular-nums text-white">{userBalance.toFixed(2)} L</b> · RTP ~96% · max 150x · one bet per flight · credit only{st?.simulatedPlayers ? ' · includes simulated players' : ''}</div>
    </div>
  );
};
export default LiveCrash;
