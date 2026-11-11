import React, { useEffect, useRef, useState } from 'react';
import StakeInput from './StakeInput';
import CoinBurst from './CoinBurst';
import CountUp from './CountUp';
import BigWin, { winTier } from './BigWin';
import { casinoCupsPlay } from '../../services/api';
import { sfx, setSound, soundOn } from './slotSound';
import './casino.css';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SLOT_X = [16, 50, 84]; // % positions of the three table slots

// THREE CUPS: pick the cup you trust, watch the shuffle, see if the ball is under it. 2.85x.
const Cups: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [stake, setStake] = useState(100);
  const [pick, setPick] = useState<number | null>(null);
  const [slotOf, setSlotOf] = useState([0, 1, 2]);   // cup i sits in slot slotOf[i]
  const [lifted, setLifted] = useState<number | null>(null); // cup index lifted
  const [ballCup, setBallCup] = useState<number | null>(null);
  const [showBall, setShowBall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('Pick a cup, then watch the shuffle');
  const [winAmt, setWinAmt] = useState(0);
  const [burst, setBurst] = useState(0);
  const [bigWin, setBigWin] = useState<{ tier: 1 | 2 | 3; amount: number } | null>(null);
  const [snd, setSnd] = useState(soundOn());
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const play = async () => {
    if (busy) return;
    if (pick === null) { setMsg('Pick a cup first!'); return; }
    if (userBalance < stake) { setMsg('Insufficient balance'); return; }
    setBusy(true); setWinAmt(0); setLifted(null); setSlotOf([0, 1, 2]); setShowBall(false); setBallCup(null);
    try {
      const r = await casinoCupsPlay(stake, pick);
      // cups are identified by their starting slot; the ball starts under cup r.start
      setBallCup(r.start); setLifted(r.start); setShowBall(true); setMsg('Watch the ball…'); sfx.click(); await sleep(1000);
      setLifted(null); await sleep(450); setShowBall(false); setMsg('Shuffling…'); sfx.spin();
      const pos = [0, 1, 2]; // pos[cup] = slot
      for (const [a, b] of r.swaps) {
        if (!alive.current) return;
        const ca = pos.indexOf(a); const cb = pos.indexOf(b);
        pos[ca] = b; pos[cb] = a; setSlotOf([...pos]); await sleep(300);
      }
      // the ball ends in slot r.final: find the cup that sits there
      const winnerCup = pos.indexOf(r.final);
      setBallCup(winnerCup);
      setMsg('Where is the ball?'); await sleep(500);
      // the player's pick is a SLOT (what they clicked before the shuffle) -> lift that slot's cup
      const pickedCup = pos.indexOf(pick);
      setLifted(pickedCup); sfx.click(); await sleep(900);
      if (!r.won) { setLifted(winnerCup); await sleep(600); }
      if (!alive.current) return;
      onSetBalance(r.balance);
      if (r.won) { setWinAmt(r.payout); setBurst((b) => b + 1); sfx.win(true); setMsg('You found it!'); const t = winTier(r.payout, stake); if (t > 0) setBigWin({ tier: t as 1 | 2 | 3, amount: r.payout }); }
      else { setMsg('Not this one!'); sfx.stop(); }
    } catch (e: any) { setMsg(e?.message || 'Error'); } finally { if (alive.current) setBusy(false); }
  };

  return (
    <div className="max-w-xl mx-auto p-3 sm:p-6 text-white">
      {burst > 0 && <CoinBurst key={burst} />}
      {bigWin && <BigWin tier={bigWin.tier} amount={bigWin.amount} format={(v) => `${v.toFixed(2)} L`} onDone={() => setBigWin(null)} />}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onClose} disabled={busy} className="text-sm text-gray-300 hover:text-white disabled:opacity-40">← Casino</button>
        <div className="font-extrabold text-xl text-brand-yellow tracking-wide">THREE CUPS</div>
        <button onClick={() => { setSound(!snd); setSnd(!snd); }} className="text-sm px-2 py-1 rounded bg-white/10">{snd ? '🔊' : '🔇'}</button>
      </div>

      <div className="relative rounded-2xl overflow-hidden border-2 border-amber-700/70 cabinet-glow" style={{ height: 260, background: 'radial-gradient(circle at 50% 0%, #7c2d12, #1c0a05 80%)' }}>
        <div className="absolute inset-x-4 bottom-6 h-3 rounded-full bg-black/40 blur-sm" />
        {[0, 1, 2].map((cup) => (
          <div key={cup} className="absolute bottom-10" style={{ left: `${SLOT_X[slotOf[cup]]}%`, transform: 'translateX(-50%)', transition: 'left .28s cubic-bezier(.4,0,.2,1)', width: 84 }}>
            {/* ball sits on the table under its cup */}
            {ballCup === cup && showBall !== undefined && (lifted === cup || showBall) && <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-7 h-7 rounded-full" style={{ background: 'radial-gradient(circle at 32% 28%, #fff, #fde047 40%, #b45309)', boxShadow: '0 3px 6px rgba(0,0,0,.6), 0 0 14px rgba(250,204,21,.8)' }} />}
            <button disabled={busy} onClick={() => setPick(slotOf[cup])} aria-label={`Cup ${slotOf[cup] + 1}`} className="relative block mx-auto transition-transform duration-300"
              style={{ width: 84, height: 100, transform: `translateY(${lifted === cup ? -62 : 0}px)`, clipPath: 'polygon(14% 0, 86% 0, 100% 100%, 0 100%)', background: 'linear-gradient(90deg, #7f1d1d, #ef4444 45%, #b91c1c 70%, #450a0a)', filter: pick === slotOf[cup] ? 'drop-shadow(0 0 10px #fde047)' : undefined, outline: 'none' }}>
              <span className="absolute top-2 inset-x-3 h-2 rounded-full bg-white/25" />
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-yellow-200 font-black text-lg">{pick === slotOf[cup] ? '★' : ''}</span>
            </button>
          </div>
        ))}
        <div className="absolute top-3 inset-x-0 text-center text-sm font-bold text-amber-100/90">{winAmt > 0 ? <span className="text-brand-yellow win-pop inline-block text-lg">You won <CountUp value={winAmt} format={(v) => `${v.toFixed(2)} L`} /></span> : msg}</div>
      </div>

      <div className="mt-3"><StakeInput value={stake} onChange={setStake} min={1} max={5000} presets={[10, 50, 100, 500, 1000]} unit="L" balance={userBalance} disabled={busy} /></div>
      <button onClick={play} disabled={busy || userBalance < stake} className="mt-3 w-full py-4 rounded-xl font-black text-xl bg-gradient-to-b from-green-400 to-green-700 text-white shadow-lg disabled:opacity-50">{busy ? '…' : `SHUFFLE · ${stake} L`}</button>
      <div className="text-[11px] text-gray-400 mt-2 text-center">Balance: <b className="tabular-nums text-white">{userBalance.toFixed(2)} L</b> · pays 2.85x · your cup is locked in before the server shuffles</div>
    </div>
  );
};
export default Cups;
