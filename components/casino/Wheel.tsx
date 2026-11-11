import StakeInput from './StakeInput';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { casinoWheelSegments, casinoWheelSpin } from '../../services/api';
import CoinBurst from './CoinBurst';
import CountUp from './CountUp';
import { sfx, setSound, soundOn } from './slotSound';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }

const COLORS: Record<number, [string, string]> = {
  0: ['#1f2937', '#0b1220'], 0.5: ['#475569', '#1e293b'], 1: ['#0e7490', '#164e63'], 1.5: ['#15803d', '#14532d'],
  2: ['#7e22ce', '#581c87'], 3: ['#c2410c', '#7c2d12'], 4: ['#be185d', '#831843'], 8: ['#ca8a04', '#854d0e'],
};
const STAKES = [10, 50, 100, 500, 1000];
const R = 150;

// A big painted wheel (SVG) that spins down onto the segment the server drew, with a pointer, hub and lights.
const Wheel: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [segs, setSegs] = useState<number[]>([]);
  const [stake, setStake] = useState(100);
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [msg, setMsg] = useState('Choose your stake and spin');
  const [win, setWin] = useState(0);
  const [burst, setBurst] = useState(0);
  const [snd, setSnd] = useState(soundOn());
  const alive = useRef(true);
  useEffect(() => { casinoWheelSegments().then((r) => setSegs(r.segments)).catch(() => {}); return () => { alive.current = false; }; }, []);

  const n = segs.length || 24;
  const step = 360 / n;
  const paths = useMemo(() => segs.map((m, i) => {
    const a0 = ((i * step - 90) * Math.PI) / 180; const a1 = (((i + 1) * step - 90) * Math.PI) / 180;
    const x0 = R * Math.cos(a0); const y0 = R * Math.sin(a0); const x1 = R * Math.cos(a1); const y1 = R * Math.sin(a1);
    const mid = (((i + 0.5) * step - 90) * Math.PI) / 180;
    return { m, d: `M0 0 L${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1} Z`, tx: 112 * Math.cos(mid), ty: 112 * Math.sin(mid), rot: (i + 0.5) * step };
  }), [segs, step]);

  const spin = async () => {
    if (spinning) return;
    if (userBalance < stake) { setMsg('Insufficient balance'); return; }
    setSpinning(true); setWin(0); setMsg('The wheel is spinning...'); sfx.spin();
    try {
      const r = await casinoWheelSpin(stake);
      // land the centre of segment `index` under the pointer (top), after several full turns
      const target = 360 * 6 + (360 - (r.index + 0.5) * step);
      setAngle((a) => a - (a % 360) + target);
      await new Promise((res) => setTimeout(res, 5200));
      if (!alive.current) return;
      sfx.stop();
      onSetBalance(r.balance);
      if (r.payout > 0) { setWin(r.payout); sfx.win(r.multiplier >= 3); if (r.multiplier >= 2) setBurst((b) => b + 1); setMsg(`${r.multiplier}x`); } else setMsg('Nothing this time. Try again!');
    } catch (e: any) { setMsg(e?.message || 'Error'); } finally { if (alive.current) setSpinning(false); }
  };

  return (
    <div className="relative rounded-2xl overflow-hidden text-white p-4 sm:p-6 min-h-[620px] flex flex-col items-center" style={{ background: 'radial-gradient(ellipse at 50% 0%, #3b0764 0%, #0b0b18 70%)' }}>
      {burst > 0 && <CoinBurst key={burst} />}
      <div className="w-full flex items-center justify-between">
        <button onClick={onClose} className="text-sm text-gray-200 hover:text-white font-semibold">‹ Lobby</button>
        <div className="font-extrabold text-xl tracking-wide text-brand-yellow">Wheel of Fortune</div>
        <button onClick={() => { setSound(!snd); setSnd(!snd); }} className="text-sm px-2 py-1 rounded bg-white/10">{snd ? '🔊' : '🔇'}</button>
      </div>
      <div className="relative mt-4 w-full max-w-[380px] aspect-square">
        <div className="absolute left-1/2 -top-1 z-20 -translate-x-1/2 w-0 h-0 border-l-[14px] border-r-[14px] border-t-[28px] border-l-transparent border-r-transparent border-t-yellow-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />
        <svg viewBox="-170 -170 340 340" className="w-full h-full">
          <defs>
            <radialGradient id="hub"><stop offset="0" stopColor="#fde68a" /><stop offset="1" stopColor="#b45309" /></radialGradient>
            {Object.entries(COLORS).map(([k, [a, b]]) => (<radialGradient key={k} id={`s${String(k).replace('.', '_')}`} cx="0" cy="0" r={R} gradientUnits="userSpaceOnUse"><stop offset="0.15" stopColor={b} /><stop offset="1" stopColor={a} /></radialGradient>))}
          </defs>
          <circle r="166" fill="#111" stroke="#facc15" strokeWidth="5" />
          {Array.from({ length: 24 }, (_, i) => { const a = (i * 15 * Math.PI) / 180; return <circle key={i} cx={158 * Math.cos(a)} cy={158 * Math.sin(a)} r="3" fill={spinning && i % 2 ? '#fff7b0' : '#fde047'} />; })}
          <g style={{ transform: `rotate(${angle}deg)`, transition: spinning ? 'transform 5.1s cubic-bezier(0.12, 0.62, 0.12, 1)' : 'none' }}>
            {paths.map((p, i) => (
              <g key={i}>
                <path d={p.d} fill={`url(#s${String(p.m).replace('.', '_')})`} stroke="#facc15" strokeWidth="1.2" />
                <text x={p.tx} y={p.ty} transform={`rotate(${p.rot} ${p.tx} ${p.ty})`} textAnchor="middle" dominantBaseline="middle" fill={p.m === 0 ? '#6b7280' : '#fff'} fontSize={p.m >= 3 ? 17 : 14} fontWeight="800">{p.m === 0 ? '✕' : `${p.m}x`}</text>
              </g>
            ))}
          </g>
          <circle r="26" fill="url(#hub)" stroke="#fff7b0" strokeWidth="3" />
        </svg>
      </div>
      <div className="h-14 flex flex-col items-center justify-center text-center">
        {win > 0 ? <div className="text-2xl font-extrabold text-brand-yellow win-pop">{msg} · You won <CountUp value={win} format={(v) => `${v.toFixed(2)} L`} /></div> : <div className="text-lg font-bold text-gray-100">{msg}</div>}
      </div>
      <div className="mb-3"><StakeInput value={stake} onChange={setStake} min={1} max={5000} presets={STAKES} unit="L" balance={userBalance} disabled={spinning} /></div>
      <button onClick={spin} disabled={spinning || userBalance < stake} className="w-full max-w-sm py-3 rounded-xl font-extrabold text-lg bg-gradient-to-b from-green-500 to-green-700 hover:from-green-400 text-white disabled:opacity-50 shadow-lg">{spinning ? '...' : `SPIN · ${stake} L`}</button>
      <div className="text-[11px] text-gray-400 mt-2">Balance: <b className="tabular-nums text-white">{userBalance.toFixed(2)} L</b> · every segment has the same chance</div>
    </div>
  );
};
export default Wheel;
