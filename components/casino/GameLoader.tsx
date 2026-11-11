import React, { useEffect, useState } from 'react';
import './lobby/lobby.css';

// "Loading the game" screen: the cover, the name and a bar that fills in `ms`, then calls onDone (the game opens full page).
const GameLoader: React.FC<{ name: string; img?: string; art?: React.ReactNode; ms?: number; onDone: () => void }> = ({ name, img, art, ms = 3000, onDone }) => {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const tick = window.setInterval(() => setPct(Math.min(100, Math.round(((Date.now() - t0) / ms) * 100))), 60);
    const done = window.setTimeout(onDone, ms);
    return () => { window.clearInterval(tick); window.clearTimeout(done); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="fixed inset-0 z-[95] flex flex-col items-center justify-center text-white px-6 overflow-hidden" role="status" aria-live="polite" style={{ background: '#05080c' }}>
      {img && <div className="absolute inset-0 opacity-60" style={{ backgroundImage: `url(${img})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(48px) saturate(1.5) brightness(.5)', transform: 'scale(1.2)' }} />}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(60% 50% at 50% 45%, transparent, rgba(5,8,12,.85))' }} />
      <div className="relative w-44 sm:w-56 aspect-[4/5] rounded-3xl overflow-hidden mb-7 lb-rise" style={{ border: '2px solid rgba(243,207,106,.7)', boxShadow: '0 30px 70px rgba(0,0,0,.8), 0 0 70px rgba(243,207,106,.25)' }}>
        {img ? <img src={img} alt={name} draggable={false} className="absolute inset-0 w-full h-full object-cover" /> : art}
      </div>
      <div className="relative lb-serif lb-foil text-2xl sm:text-3xl font-black mb-1 text-center">{name}</div>
      <div className="relative text-[11px] tracking-[.25em] text-slate-400 mb-5">LOADING GAME</div>
      <div className="relative w-full max-w-xs h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.1)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, transition: 'width 80ms linear', background: 'linear-gradient(90deg,#b8862b,#f3cf6a,#fff0b0)', boxShadow: '0 0 14px rgba(243,207,106,.8)' }} />
      </div>
      <div className="relative mt-2 text-xs tabular-nums text-slate-300">{pct}%</div>
    </div>
  );
};
export default GameLoader;
