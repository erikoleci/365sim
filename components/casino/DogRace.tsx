import React, { useEffect, useRef, useState } from 'react';
import StakeInput from './StakeInput';
import CoinBurst from './CoinBurst';
import CountUp from './CountUp';
import BigWin, { winTier } from './BigWin';
import DogTrack, { dogProgress } from './DogTrack';
import { casinoDogsInfo, casinoDogsRace, Dog } from '../../services/api';
import { sfx, setSound, soundOn } from './slotSound';
import { raceSfx } from './raceAudio';
import './casino.css';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

// DOG RACE: back a greyhound, the server draws the finishing order, the track plays it back.
const DogRace: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [dogs, setDogs] = useState<Dog[]>([]);
  const [pick, setPick] = useState<number | null>(null);
  const [stake, setStake] = useState(100);
  const [progress, setProgress] = useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [order, setOrder] = useState<number[] | null>(null);
  const [racing, setRacing] = useState(false);
  const [msg, setMsg] = useState('Pick a greyhound and start the race');
  const [winAmt, setWinAmt] = useState(0);
  const [burst, setBurst] = useState(0);
  const [bigWin, setBigWin] = useState<{ tier: 1 | 2 | 3; amount: number } | null>(null);
  const [snd, setSnd] = useState(soundOn());
  const alive = useRef(true); const raf = useRef(0);
  useEffect(() => { alive.current = true; casinoDogsInfo().then((r) => setDogs(r.dogs)).catch(() => {}); return () => { alive.current = false; cancelAnimationFrame(raf.current); raceSfx.stopAll(); }; }, []);

  const run = (ord: number[]) => new Promise<void>((resolve) => {
    const finish = ord.map((_, place) => 7 + place * 0.4);
    const t = Array(6).fill(0); ord.forEach((id, place) => { t[id] = finish[place]; });
    const wob = Array.from({ length: 6 }, (_, i) => ({ a: 0.035 + ((i * 29) % 5) * 0.01, f: 2 + (i % 3), p: i * 1.7 }));
    const t0 = performance.now();
    const tick = () => {
      if (!alive.current) return resolve();
      const s = (performance.now() - t0) / 1000;
      setProgress(t.map((T, i) => dogProgress(s, T, wob[i])));
      raceSfx.setCrowd(Math.min(1, s / 6));
      if (s >= finish[5]) { setProgress(t.map((T, i) => dogProgress(finish[5], T, wob[i]))); resolve(); return; }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  });

  const race = async () => {
    if (racing) return;
    if (pick === null) { setMsg('Pick a greyhound first!'); return; }
    if (userBalance < stake) { setMsg('Insufficient balance'); return; }
    setRacing(true); setOrder(null); setWinAmt(0); setProgress([0, 0, 0, 0, 0, 0]); setMsg('The hare is running… and they\'re off!'); raceSfx.startCrowd(); raceSfx.gates(); window.setTimeout(() => raceSfx.startGallop(() => 0.8), 700);
    try {
      const r = await casinoDogsRace(stake, pick);
      await run(r.order);
      raceSfx.stopGallop(); raceSfx.finish(r.payout > 0); window.setTimeout(() => raceSfx.stopCrowd(), 3500);
      if (!alive.current) return;
      setOrder(r.order); onSetBalance(r.balance);
      if (r.payout > 0) { setWinAmt(r.payout); setBurst((b) => b + 1); sfx.win(true); setMsg(`${dogs[pick].name} wins!`); const t = winTier(r.payout, stake); if (t > 0) setBigWin({ tier: t as 1 | 2 | 3, amount: r.payout }); }
      else { setMsg(`${dogs[pick].name} finished ${ORD[r.order.indexOf(pick)]}`); sfx.stop(); }
    } catch (e: any) { setMsg(e?.message || 'Error'); } finally { if (alive.current) setRacing(false); }
  };

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-6 text-white">
      {burst > 0 && <CoinBurst key={burst} />}
      {bigWin && <BigWin tier={bigWin.tier} amount={bigWin.amount} format={(v) => `${v.toFixed(2)} L`} onDone={() => setBigWin(null)} />}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onClose} disabled={racing} className="text-sm text-gray-300 hover:text-white disabled:opacity-40">← Casino</button>
        <div className="font-extrabold text-xl text-brand-yellow tracking-wide">DOG RACE</div>
        <button onClick={() => { setSound(!snd); setSnd(!snd); }} className="text-sm px-2 py-1 rounded bg-white/10">{snd ? '🔊' : '🔇'}</button>
      </div>

      <DogTrack dogs={dogs} progress={progress} running={racing} finishOrder={order} selected={pick}>
        {winAmt > 0 ? <span className="text-brand-yellow win-pop inline-block">You won <CountUp value={winAmt} format={(v) => `${v.toFixed(2)} L`} /></span> : msg}
      </DogTrack>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
        {dogs.map((d) => (
          <button key={d.id} disabled={racing} onClick={() => setPick(d.id)} className={`rounded-xl p-2 text-left border-2 transition ${pick === d.id ? 'border-yellow-300 bg-yellow-300/15 scale-[1.02]' : 'border-white/10 bg-black/40 hover:bg-black/60'}`}>
            <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-md text-[12px] font-black flex items-center justify-center" style={{ background: d.color, color: d.color === '#f1f5f9' || d.color === '#eab308' ? '#111' : '#fff' }}>{d.trap}</span><span className="text-sm font-bold truncate">{d.name}</span></div>
            <div className="text-lg font-black text-brand-yellow tabular-nums mt-0.5">{d.odds.toFixed(2)}x</div>
          </button>
        ))}
      </div>
      <div className="mt-3"><StakeInput value={stake} onChange={setStake} min={1} max={5000} presets={[10, 50, 100, 500, 1000]} unit="L" balance={userBalance} disabled={racing} /></div>
      <button onClick={race} disabled={racing || userBalance < stake} className="mt-3 w-full py-4 rounded-xl font-black text-xl bg-gradient-to-b from-green-400 to-green-700 text-white shadow-lg disabled:opacity-50">{racing ? 'RACING…' : `START RACE · ${stake} L`}</button>
      <div className="text-[11px] text-gray-400 mt-2 text-center">Balance: <b className="tabular-nums text-white">{userBalance.toFixed(2)} L</b> · the finishing order is drawn by the server · RTP 95% · credit only</div>
    </div>
  );
};
export default DogRace;
