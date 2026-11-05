import React, { useEffect, useState } from 'react';

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
    <div className="fixed inset-0 z-[95] flex flex-col items-center justify-center bg-[#07070c] text-white px-6" role="status" aria-live="polite">
      <div className="relative w-44 sm:w-56 aspect-[4/5] rounded-2xl overflow-hidden border border-yellow-500/60 shadow-[0_0_40px_rgba(250,204,21,0.25)] mb-6">
        {img ? <img src={img} alt={name} draggable={false} className="absolute inset-0 w-full h-full object-cover" /> : art}
      </div>
      <div className="text-xl sm:text-2xl font-extrabold tracking-wide mb-1">{name}</div>
      <div className="text-xs text-gray-400 mb-4">Duke ngarkuar lojën…</div>
      <div className="w-full max-w-xs h-2.5 rounded-full bg-white/10 overflow-hidden border border-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 shadow-[0_0_12px_rgba(250,204,21,0.7)]" style={{ width: `${pct}%`, transition: 'width 80ms linear' }} />
      </div>
      <div className="mt-2 text-xs tabular-nums text-gray-300">{pct}%</div>
    </div>
  );
};
export default GameLoader;
