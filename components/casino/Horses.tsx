import React, { useEffect, useRef, useState } from 'react';
import StakeInput from './StakeInput';
import CoinBurst from './CoinBurst';
import CountUp from './CountUp';
import BigWin, { winTier } from './BigWin';
import { casinoHorsesInfo, casinoHorsesRace, Horse } from '../../services/api';
import { sfx, setSound, soundOn } from './slotSound';
import './casino.css';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

// HORSE RACE: back a horse; the server draws the whole finishing order, the track plays it back with a photo finish.
const Horses: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [horses, setHorses] = useState<Horse[]>([]);
  const [pick, setPick] = useState<number | null>(null);
  const [stake, setStake] = useState(100);
  const [progress, setProgress] = useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [order, setOrder] = useState<number[] | null>(null);
  const [racing, setRacing] = useState(false);
  const [msg, setMsg] = useState('Back a horse and start the race');
  const [winAmt, setWinAmt] = useState(0);
  const [burst, setBurst] = useState(0);
  const [bigWin, setBigWin] = useState<{ tier: 1 | 2 | 3; amount: number } | null>(null);
  const [snd, setSnd] = useState(soundOn());
  const alive = useRef(true); const raf = useRef(0);
  useEffect(() => { casinoHorsesInfo().then((r) => setHorses(r.horses)).catch(() => {}); return () => { alive.current = false; cancelAnimationFrame(raf.current); }; }, []);

  const run = (ord: number[]) => new Promise<void>((resolve) => {
    // finish time by place (winner first), with a little wobble in the middle of the race
    const finish = ord.map((_, place) => 6.2 + place * 0.45);
    const t = Array(6).fill(0); ord.forEach((id, place) => { t[id] = finish[place]; });
    const wob = Array.from({ length: 6 }, () => ({ a: 0.04 + Math.random() * 0.05, f: 2 + Math.random() * 3, p: Math.random() * 6 }));
    const t0 = performance.now();
    const tick = () => {
      if (!alive.current) return resolve();
      const s = (performance.now() - t0) / 1000;
      const prog = t.map((T, i) => { const x = Math.min(1, s / T); return Math.min(1, x + Math.sin(x * Math.PI) * wob[i].a * Math.sin(wob[i].f * x * 6 + wob[i].p)); });
      setProgress(prog);
      if (s >= finish[5]) { setProgress(t.map(() => 1)); resolve(); return; }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  });

  const race = async () => {
    if (racing || pick === null) { if (pick === null) setMsg('Pick a horse first!'); return; }
    if (userBalance < stake) { setMsg('Insufficient balance'); return; }
    setRacing(true); setOrder(null); setWinAmt(0); setProgress([0, 0, 0, 0, 0, 0]); setMsg('And they\'re off!'); sfx.spin();
    try {
      const r = await casinoHorsesRace(stake, pick);
      await run(r.order);
      if (!alive.current) return;
      setOrder(r.order); onSetBalance(r.balance);
      const place = r.order.indexOf(pick);
      if (r.payout > 0) { setWinAmt(r.payout); setBurst((b) => b + 1); sfx.win(true); setMsg(`${horses[pick].name} wins!`); const t = winTier(r.payout, stake); if (t > 0) setBigWin({ tier: t as 1 | 2 | 3, amount: r.payout }); }
      else { setMsg(`${horses[pick].name} finished ${ORDINAL[place]}`); sfx.stop(); }
    } catch (e: any) { setMsg(e?.message || 'Error'); } finally { if (alive.current) setRacing(false); }
  };

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-6 text-white">
      {burst > 0 && <CoinBurst key={burst} />}
      {bigWin && <BigWin tier={bigWin.tier} amount={bigWin.amount} format={(v) => `${v.toFixed(2)} L`} onDone={() => setBigWin(null)} />}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onClose} disabled={racing} className="text-sm text-gray-300 hover:text-white disabled:opacity-40">← Casino</button>
        <div className="font-extrabold text-xl text-brand-yellow tracking-wide">HORSE RACE</div>
        <button onClick={() => { setSound(!snd); setSnd(!snd); }} className="text-sm px-2 py-1 rounded bg-white/10">{snd ? '🔊' : '🔇'}</button>
      </div>

      <div className="rounded-2xl overflow-hidden border-2 border-amber-700/60 relative" style={{ background: 'linear-gradient(#14532d, #166534)' }}>
        <div className="absolute top-0 bottom-0 right-[7%] w-1.5 z-10" style={{ background: 'repeating-linear-gradient(0deg, #fff 0 8px, #111 8px 16px)' }} aria-hidden />
        {horses.map((h, i) => (
          <div key={h.id} className={`relative h-12 border-b border-white/10 ${pick === h.id ? 'bg-white/10' : ''}`} style={{ background: i % 2 ? 'rgba(0,0,0,.12)' : undefined }}>
            <div className="absolute left-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-[11px] font-black flex items-center justify-center text-black" style={{ background: h.color }}>{h.id + 1}</div>
            <div className="absolute top-1/2 -translate-y-1/2 text-3xl select-none" style={{ left: `calc(${progress[i] * 82}% + 28px)`, transform: 'translateY(-50%) scaleX(-1)', filter: `drop-shadow(0 3px 2px rgba(0,0,0,.5)) drop-shadow(0 0 6px ${h.color})` }}>🏇</div>
            {order && <div className="absolute right-1 top-1/2 -translate-y-1/2 text-[11px] font-black px-1.5 rounded bg-black/60">{ORDINAL[order.indexOf(h.id)]}</div>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
        {horses.map((h) => (
          <button key={h.id} disabled={racing} onClick={() => setPick(h.id)} className={`rounded-xl p-2 text-left border-2 transition ${pick === h.id ? 'border-yellow-300 bg-yellow-300/15 scale-[1.02]' : 'border-white/10 bg-black/40 hover:bg-black/60'}`}>
            <div className="flex items-center gap-2"><span className="w-5 h-5 rounded-full text-[11px] font-black flex items-center justify-center text-black" style={{ background: h.color }}>{h.id + 1}</span><span className="text-sm font-bold truncate">{h.name}</span></div>
            <div className="text-lg font-black text-brand-yellow tabular-nums mt-0.5">{h.odds.toFixed(2)}x</div>
          </button>
        ))}
      </div>

      <div className="text-center font-bold mt-3 min-h-[28px]">{winAmt > 0 ? <span className="text-brand-yellow win-pop inline-block text-lg">You won <CountUp value={winAmt} format={(v) => `${v.toFixed(2)} L`} /></span> : msg}</div>
      <div className="mt-2"><StakeInput value={stake} onChange={setStake} min={1} max={5000} presets={[10, 50, 100, 500, 1000]} unit="L" balance={userBalance} disabled={racing} /></div>
      <button onClick={race} disabled={racing || userBalance < stake} className="mt-3 w-full py-4 rounded-xl font-black text-xl bg-gradient-to-b from-green-400 to-green-700 text-white shadow-lg disabled:opacity-50">{racing ? 'RACING…' : `START RACE · ${stake} L`}</button>
      <div className="text-[11px] text-gray-400 mt-2 text-center">Balance: <b className="tabular-nums text-white">{userBalance.toFixed(2)} L</b> · the finishing order is drawn by the server · RTP 95%</div>
    </div>
  );
};
export default Horses;
