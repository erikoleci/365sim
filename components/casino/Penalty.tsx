import React, { useRef, useState } from 'react';
import StakeInput from './StakeInput';
import CoinBurst from './CoinBurst';
import CountUp from './CountUp';
import BigWin, { winTier } from './BigWin';
import { casinoChainStart, casinoChainPick, casinoChainCashout } from '../../services/api';
import { sfx, setSound, soundOn } from './slotSound';
import './casino.css';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ZONES = ['LEFT', 'CENTRE', 'RIGHT'];
// x position (% of the goal) of each zone, used for both the ball and the keeper
const ZX = [18, 50, 82];

// PENALTY SHOOTOUT: pick a corner, the keeper dives. Every goal multiplies the prize; cash out between kicks.
const Penalty: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [stake, setStake] = useState(100);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [step, setStep] = useState(1.46);
  const [total, setTotal] = useState(1);
  const [kicks, setKicks] = useState<('goal' | 'save')[]>([]);
  const [ball, setBall] = useState<number | null>(null);      // zone the ball flew to
  const [keeper, setKeeper] = useState<number>(1);             // zone the keeper dived to
  const [flying, setFlying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('Set your stake and take the first kick');
  const [flash, setFlash] = useState<'goal' | 'save' | null>(null);
  const [winAmt, setWinAmt] = useState(0);
  const [burst, setBurst] = useState(0);
  const [bigWin, setBigWin] = useState<{ tier: 1 | 2 | 3; amount: number } | null>(null);
  const [snd, setSnd] = useState(soundOn());
  const locked = useRef(0);
  const playing = !!roundId;

  const win = (payout: number) => {
    setWinAmt(payout); setBurst((b) => b + 1); sfx.win(true);
    const tier = winTier(payout, locked.current); if (tier > 0) setBigWin({ tier: tier as 1 | 2 | 3, amount: payout });
  };
  const start = async () => {
    if (userBalance < stake) { setMsg('Insufficient balance'); return; }
    setBusy(true);
    try {
      const r = await casinoChainStart('penalty', stake);
      locked.current = stake; onSetBalance(r.balance); setRoundId(r.roundId); setStep(r.step); setTotal(1); setKicks([]); setBall(null); setKeeper(1); setWinAmt(0); setFlash(null);
      setMsg('Pick where to shoot!'); sfx.click();
    } catch (e: any) { setMsg(e?.message || 'Error'); } finally { setBusy(false); }
  };
  const shoot = async (zone: number) => {
    if (!roundId || busy) return;
    setBusy(true); setFlash(null); setBall(null); setKeeper(1); sfx.spin();
    try {
      const r = await casinoChainPick('penalty', roundId, zone);
      setFlying(true); setBall(zone); setKeeper(r.traps[0]);
      await sleep(900); setFlying(false);
      if (r.safe) {
        setFlash('goal'); setKicks((k) => [...k, 'goal']); setTotal(r.total ?? total); sfx.win(false);
        if (r.finished) { if (r.balance !== undefined) onSetBalance(r.balance); setRoundId(null); win(r.payout ?? 0); setMsg('PERFECT SHOOTOUT!'); }
        else setMsg('GOAL! Shoot again or cash out');
      } else {
        setFlash('save'); setKicks((k) => [...k, 'save']); setTotal(1); setRoundId(null); sfx.stop(); setMsg('SAVED by the keeper!');
        if (r.balance !== undefined) onSetBalance(r.balance);
      }
    } catch (e: any) { setMsg(e?.message || 'Error'); } finally { setBusy(false); }
  };
  const cashout = async () => {
    if (!roundId || busy || total <= 1) return;
    setBusy(true);
    try { const r = await casinoChainCashout('penalty', roundId); onSetBalance(r.balance); setRoundId(null); win(r.payout); setMsg(`Cashed out at ${r.multiplier.toFixed(2)}x`); }
    catch (e: any) { setMsg(e?.message || 'Error'); } finally { setBusy(false); }
  };

  const ballLeft = flying || ball !== null ? ZX[ball ?? 1] : 50;
  return (
    <div className="max-w-2xl mx-auto p-3 sm:p-6 text-white">
      {burst > 0 && <CoinBurst key={burst} />}
      {bigWin && <BigWin tier={bigWin.tier} amount={bigWin.amount} format={(v) => `${v.toFixed(2)} L`} onDone={() => setBigWin(null)} />}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onClose} disabled={playing} className="text-sm text-gray-300 hover:text-white disabled:opacity-40">← Casino</button>
        <div className="font-extrabold text-xl text-brand-yellow tracking-wide">PENALTY SHOOTOUT</div>
        <button onClick={() => { setSound(!snd); setSnd(!snd); }} className="text-sm px-2 py-1 rounded bg-white/10">{snd ? '🔊' : '🔇'}</button>
      </div>

      <div className={`relative rounded-2xl overflow-hidden border-2 border-white/20 ${flash === 'save' ? 'cabinet-shake' : ''}`} style={{ height: 330, background: 'linear-gradient(#0b1b3a 0 38%, #14532d 38% 100%)' }}>
        {/* stadium lights + crowd */}
        <div className="absolute inset-x-0 top-0 h-[38%] opacity-70" style={{ background: 'radial-gradient(circle at 15% 20%, rgba(255,255,255,.6), transparent 14%), radial-gradient(circle at 85% 20%, rgba(255,255,255,.6), transparent 14%), repeating-linear-gradient(90deg, rgba(255,255,255,.06) 0 6px, transparent 6px 14px)' }} />
        {/* pitch stripes */}
        <div className="absolute inset-x-0 bottom-0 h-[62%]" style={{ background: 'repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 40px, transparent 40px 80px)' }} />
        {/* goal */}
        <div className="absolute left-1/2 -translate-x-1/2 top-[14%] w-[86%] h-[44%] border-[6px] border-b-0 border-white rounded-t-md shadow-[0_0_20px_rgba(255,255,255,.35)]"
          style={{ background: 'repeating-linear-gradient(45deg, rgba(255,255,255,.12) 0 2px, transparent 2px 12px), repeating-linear-gradient(-45deg, rgba(255,255,255,.12) 0 2px, transparent 2px 12px), rgba(0,0,0,.25)' }}>
          {/* keeper */}
          <div className="absolute bottom-0 text-5xl select-none" style={{ left: `${ZX[keeper]}%`, transform: `translateX(-50%) rotate(${keeper === 0 ? -50 : keeper === 2 ? 50 : 0}deg)`, transition: 'left .45s cubic-bezier(.2,.9,.3,1.1), transform .45s' }}>🧤</div>
          {/* shot targets */}
          {playing && !busy && ZX.map((x, i) => (
            <button key={i} onClick={() => shoot(i)} aria-label={`Shoot ${ZONES[i]}`} className="absolute top-2 bottom-2 w-[30%] rounded-lg border-2 border-dashed border-yellow-300/70 bg-yellow-300/10 hover:bg-yellow-300/30 animate-pulse flex items-end justify-center pb-1 text-[10px] font-bold text-yellow-200" style={{ left: `${x}%`, transform: 'translateX(-50%)' }}>{ZONES[i]}</button>
          ))}
        </div>
        {/* ball */}
        <div className="absolute text-4xl select-none" style={{ left: `${ballLeft}%`, bottom: flying || ball !== null ? '46%' : '8%', transform: `translateX(-50%) scale(${flying ? 0.6 : ball !== null ? 0.7 : 1}) rotate(${flying ? 540 : 0}deg)`, transition: 'left .85s cubic-bezier(.3,.7,.3,1), bottom .85s cubic-bezier(.3,.7,.3,1), transform .85s' }}>⚽</div>
        {flash && <div key={kicks.length} className={`absolute inset-0 flex items-center justify-center pointer-events-none bigwin-card font-black ${flash === 'goal' ? 'text-yellow-300' : 'text-red-400'}`} style={{ fontSize: 'clamp(40px,12vw,84px)', textShadow: '0 4px 0 rgba(0,0,0,.6), 0 0 30px currentColor' }}>{flash === 'goal' ? 'GOAL!' : 'SAVED!'}</div>}
      </div>

      <div className="flex items-center justify-between mt-3 text-sm">
        <div className="flex gap-1.5">{Array.from({ length: 10 }).map((_, i) => <span key={i} className={`w-6 h-6 rounded-full text-[11px] font-black flex items-center justify-center border ${kicks[i] === 'goal' ? 'bg-green-500 border-green-200' : kicks[i] === 'save' ? 'bg-red-600 border-red-300' : 'bg-black/40 border-white/20 text-white/30'}`}>{kicks[i] === 'goal' ? '✓' : kicks[i] === 'save' ? '✕' : i + 1}</span>)}</div>
        <div className="text-right"><div className="text-2xl font-black text-brand-yellow tabular-nums">{total.toFixed(2)}x</div>{playing && <div className="text-[10px] text-gray-300">next goal → {(Math.floor(total * step * 100) / 100).toFixed(2)}x</div>}</div>
      </div>
      <div className="text-center font-bold min-h-[26px] mt-1">{winAmt > 0 && !playing ? <span className="text-brand-yellow win-pop inline-block text-lg">You won <CountUp value={winAmt} format={(v) => `${v.toFixed(2)} L`} /></span> : msg}</div>

      {playing ? (
        <button onClick={cashout} disabled={busy || total <= 1} className="mt-2 w-full py-3 rounded-xl font-black text-lg bg-gradient-to-b from-amber-300 to-orange-600 text-black disabled:opacity-40 shadow-lg">CASH OUT · {(locked.current * total).toFixed(2)} L</button>
      ) : (
        <>
          <div className="mt-2"><StakeInput value={stake} onChange={setStake} min={1} max={5000} presets={[10, 50, 100, 500, 1000]} unit="L" balance={userBalance} disabled={busy} /></div>
          <button onClick={start} disabled={busy || userBalance < stake} className="mt-3 w-full py-4 rounded-xl font-black text-xl bg-gradient-to-b from-green-400 to-green-700 text-white shadow-lg disabled:opacity-50">KICK OFF · {stake} L</button>
        </>
      )}
      <div className="text-[11px] text-gray-400 mt-2 text-center">Balance: <b className="tabular-nums text-white">{userBalance.toFixed(2)} L</b> · the keeper dives to a random side drawn by the server · 97% fair odds per kick</div>
    </div>
  );
};
export default Penalty;
