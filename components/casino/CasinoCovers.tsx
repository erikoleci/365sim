import React from 'react';
import SymbolIcon from './SymbolIcon';

// Cover pictures for the games that have no photo: drawn here as SVG / vector pictures, in the same gold-on-dark style.
const Title: React.FC<{ a: string; b?: string; color?: string }> = ({ a, b, color = '#facc15' }) => (
  <div className="absolute inset-x-0 bottom-0 px-3 pb-4 pt-16 text-center bg-gradient-to-t from-black/90 via-black/50 to-transparent">
    <div className="font-black italic leading-none text-2xl sm:text-[28px]" style={{ color, WebkitTextStroke: '1px rgba(0,0,0,0.5)', textShadow: '0 3px 0 rgba(0,0,0,0.55), 0 0 18px rgba(250,204,21,0.45)' }}>{a}</div>
    {b && <div className="mt-1 text-[13px] font-semibold text-gray-100">{b}</div>}
  </div>
);
const Badge: React.FC<{ text: string; cls: string }> = ({ text, cls }) => (<div className={`absolute top-3 left-0 z-10 px-3 py-0.5 text-xs font-black text-white rounded-r ${cls}`}>{text}</div>);
const Frame: React.FC<{ bg: string; children: React.ReactNode }> = ({ bg, children }) => (
  <div className="absolute inset-0 overflow-hidden" style={{ background: bg }}>
    <div className="absolute inset-0 opacity-40" style={{ background: 'radial-gradient(circle at 20% 15%, rgba(255,255,255,0.35) 0, transparent 35%), radial-gradient(circle at 85% 30%, rgba(255,215,0,0.25) 0, transparent 30%)' }} />
    {children}
    <div className="absolute inset-0 rounded-[inherit] pointer-events-none" style={{ boxShadow: 'inset 0 0 0 2px rgba(250,204,21,0.55), inset 0 0 30px rgba(0,0,0,0.6)' }} />
  </div>
);

export const WheelCover = () => {
  const cols = ['#1f2937', '#be185d', '#1f2937', '#7e22ce', '#1f2937', '#c2410c', '#1f2937', '#ca8a04', '#1f2937', '#15803d', '#1f2937', '#0e7490'];
  return (
    <Frame bg="radial-gradient(ellipse at 50% 30%, #6b21a8 0%, #1e0a3c 70%)">
      <Badge text="NEW" cls="bg-emerald-600" />
      <svg viewBox="-100 -100 200 200" className="absolute left-1/2 top-[6%] w-[80%] -translate-x-1/2 drop-shadow-[0_8px_16px_rgba(0,0,0,0.7)]">
        <circle r="96" fill="#111" stroke="#facc15" strokeWidth="5" />
        {cols.map((c, i) => { const a0 = (i * 30 - 90) * Math.PI / 180; const a1 = ((i + 1) * 30 - 90) * Math.PI / 180; return <path key={i} d={`M0 0 L${88 * Math.cos(a0)} ${88 * Math.sin(a0)} A88 88 0 0 1 ${88 * Math.cos(a1)} ${88 * Math.sin(a1)} Z`} fill={c} stroke="#facc15" strokeWidth="1" />; })}
        {Array.from({ length: 24 }, (_, i) => <circle key={i} cx={93 * Math.cos(i * Math.PI / 12)} cy={93 * Math.sin(i * Math.PI / 12)} r="2" fill="#fde047" />)}
        <circle r="16" fill="#fde68a" stroke="#fff7b0" strokeWidth="3" />
        <path d="M-9 -104 L9 -104 L0 -84 Z" fill="#fde047" stroke="#7c2d12" strokeWidth="1.5" />
      </svg>
      <Title a="WHEEL OF FORTUNE" b="Spin and win up to 8x" />
    </Frame>
  );
};
export const KenoCover = () => (
  <Frame bg="radial-gradient(ellipse at 50% 20%, #047857 0%, #052e1f 75%)">
    <Badge text="NEW" cls="bg-emerald-600" />
    <div className="absolute left-1/2 top-[8%] w-[70%] -translate-x-1/2 grid grid-cols-5 gap-1.5">
      {[7, 12, 19, 23, 31, 4, 15, 28, 36, 40].map((n, i) => (
        <div key={n} className={`aspect-square rounded-full flex items-center justify-center text-sm font-black border-2 ${i % 3 === 0 ? 'bg-gradient-to-b from-yellow-200 to-amber-500 text-black border-yellow-50 shadow-[0_0_14px_rgba(250,204,21,0.9)]' : i % 3 === 1 ? 'bg-red-600 border-red-300 text-white' : 'bg-emerald-400 border-emerald-100 text-black'}`}>{n}</div>
      ))}
    </div>
    <Title a="KENO" b="Pick your numbers, win up to 1000x" />
  </Frame>
);
export const ScratchCover = () => (
  <Frame bg="radial-gradient(ellipse at 50% 20%, #c2410c 0%, #2a0d04 75%)">
    <Badge text="NEW" cls="bg-emerald-600" />
    <div className="absolute left-1/2 top-[7%] w-[56%] -translate-x-1/2 rounded-2xl p-2 border-4 border-yellow-500/80 rotate-[-4deg] shadow-2xl" style={{ background: 'linear-gradient(145deg, #fde68a, #f59e0b 55%, #b45309)' }}>
      <div className="grid grid-cols-3 gap-1.5">
        {['50x', '?', '5x', '?', '50x', '?', '2x', '?', '50x'].map((t, i) => (
          <div key={i} className={`aspect-square rounded-lg flex items-center justify-center font-black text-lg ${t === '?' ? 'text-slate-500' : 'bg-white text-red-700'}`} style={t === '?' ? { background: 'repeating-linear-gradient(135deg,#cbd5e1 0 5px,#94a3b8 5px 10px)' } : undefined}>{t}</div>
        ))}
      </div>
    </div>
    <Title a="SCRATCH & WIN" b="Cards with prizes up to 50x" />
  </Frame>
);
export const TumbleCover = () => (
  <Frame bg="radial-gradient(ellipse at 50% 20%, #be185d 0%, #3b0764 60%, #12041a 100%)">
    <Badge text="NEW · SHEMBJE" cls="bg-pink-600" />
    <div className="absolute left-1/2 top-[6%] w-[62%] -translate-x-1/2 grid grid-cols-4 gap-1">
      {['🍬', '🍭', '🍩', '🧁', '🍦', '🎂', '🍫', '🎁', '🍩', '🧁', '🍭', '🍬'].map((s, i) => (
        <div key={i} className="aspect-square rounded-lg bg-white/15 p-1" style={{ transform: `translateY(${(i % 4) * 3}px)` }}><SymbolIcon symbol={s} className="w-full h-full" /></div>
      ))}
    </div>
    <Title a="SUGAR CASCADE" b="8+ symbols pay anywhere · multipliers" color="#f9a8d4" />
  </Frame>
);
