import StakeInput from './StakeInput';
import React, { useEffect, useRef, useState } from 'react';
import { casinoKenoPaytable, casinoKenoPlay } from '../../services/api';
import CoinBurst from './CoinBurst';
import CountUp from './CountUp';
import { sfx, setSound, soundOn } from './slotSound';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }
const STAKES = [10, 50, 100, 500, 1000];

// Keno: pick 1-8 of 40, the balls are drawn one by one, hits light up gold. Draw and payout come from the server.
const Keno: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [pool, setPool] = useState(40);
  const [maxPicks, setMaxPicks] = useState(8);
  const [pay, setPay] = useState<Record<string, Record<string, number>>>({});
  const [picks, setPicks] = useState<number[]>([]);
  const [shown, setShown] = useState<number[]>([]);
  const [stake, setStake] = useState(100);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('Pick 1 to 8 numbers');
  const [win, setWin] = useState(0);
  const [burst, setBurst] = useState(0);
  const [snd, setSnd] = useState(soundOn());
  const alive = useRef(true);
  useEffect(() => { casinoKenoPaytable().then((r) => { setPool(r.pool); setMaxPicks(r.maxPicks); setPay(r.paytable); }).catch(() => {}); return () => { alive.current = false; }; }, []);

  const toggle = (n: number) => {
    if (busy) return;
    setShown([]); setWin(0);
    setPicks((p) => (p.includes(n) ? p.filter((x) => x !== n) : p.length >= maxPicks ? p : [...p, n]));
    sfx.click();
  };
  const play = async () => {
    if (busy || picks.length === 0) return;
    if (userBalance < stake) { setMsg('Insufficient balance'); return; }
    setBusy(true); setShown([]); setWin(0); setMsg('Drawing the balls...');
    try {
      const r = await casinoKenoPlay(stake, picks);
      for (let i = 0; i < r.drawn.length; i += 1) {
        await new Promise((res) => setTimeout(res, 260));
        if (!alive.current) return;
        setShown(r.drawn.slice(0, i + 1)); sfx.stop();
      }
      onSetBalance(r.balance);
      if (r.payout > 0) { setWin(r.payout); sfx.win(r.multiplier >= 5); if (r.multiplier >= 3) setBurst((b) => b + 1); setMsg(`${r.hits} hits · ${r.multiplier}x`); }
      else setMsg(`${r.hits} hits. Try again!`);
    } catch (e: any) { setMsg(e?.message || 'Error'); } finally { if (alive.current) setBusy(false); }
  };
  const table = pay[String(picks.length)] || {};

  return (
    <div className="relative rounded-2xl overflow-hidden text-white p-4 sm:p-6 min-h-[620px]" style={{ background: 'radial-gradient(ellipse at 50% 0%, #064e3b 0%, #07120e 75%)' }}>
      {burst > 0 && <CoinBurst key={burst} />}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onClose} className="text-sm text-gray-200 hover:text-white font-semibold">‹ Lobby</button>
        <div className="font-extrabold text-xl text-brand-yellow tracking-wide">Keno</div>
        <button onClick={() => { setSound(!snd); setSnd(!snd); }} className="text-sm px-2 py-1 rounded bg-white/10">{snd ? '🔊' : '🔇'}</button>
      </div>
      <div className="grid grid-cols-8 gap-1.5 sm:gap-2 max-w-xl mx-auto">
        {Array.from({ length: pool }, (_, i) => i + 1).map((n) => {
          const picked = picks.includes(n); const drawn = shown.includes(n); const hit = picked && drawn;
          return (
            <button key={n} onClick={() => toggle(n)} className={`aspect-square rounded-full text-sm sm:text-base font-extrabold tabular-nums border-2 transition ${hit ? 'bg-gradient-to-b from-yellow-300 to-amber-500 text-black border-yellow-100 scale-110 shadow-[0_0_14px_rgba(250,204,21,0.9)]' : drawn ? 'bg-red-600 border-red-300 text-white' : picked ? 'bg-emerald-500 border-emerald-200 text-black' : 'bg-black/40 border-white/15 text-gray-200 hover:bg-white/10'}`}>{n}</button>
          );
        })}
      </div>
      <div className="h-14 flex flex-col items-center justify-center text-center mt-3">
        {win > 0 ? <div className="text-2xl font-extrabold text-brand-yellow win-pop">{msg} · You won <CountUp value={win} format={(v) => `${v.toFixed(2)} L`} /></div> : <div className="text-lg font-bold text-gray-100">{msg}</div>}
      </div>
      {picks.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5 text-[11px] mb-3">
          {Object.entries(table).map(([h, m]) => <span key={h} className="px-2 py-0.5 rounded bg-black/40 border border-white/10">{h} hits <b className="text-brand-yellow">{m}x</b></span>)}
        </div>
      )}
      <div className="mb-3"><StakeInput value={stake} onChange={setStake} min={1} max={5000} presets={STAKES} unit="L" balance={userBalance} disabled={busy} /></div>
      <div className="flex gap-2 max-w-sm mx-auto">
        <button onClick={() => { setPicks([]); setShown([]); setWin(0); setMsg('Pick 1 to 8 numbers'); }} disabled={busy} className="px-4 rounded-xl border border-white/20 text-gray-200 disabled:opacity-50">Clear</button>
        <button onClick={play} disabled={busy || picks.length === 0 || userBalance < stake} className="flex-1 py-3 rounded-xl font-extrabold text-lg bg-gradient-to-b from-green-500 to-green-700 text-white disabled:opacity-50 shadow-lg">{busy ? '...' : `LUAJ · ${stake} L`}</button>
      </div>
      <div className="text-[11px] text-gray-400 text-center mt-2">Balance: <b className="tabular-nums text-white">{userBalance.toFixed(2)} L</b> · RTP ~94% · fitimi maksimal 1000x</div>
    </div>
  );
};
export default Keno;
