import React from 'react';
import { Dog } from '../../services/api';
import './casino.css';

const COATS = ['#c58b4e', '#202328', '#7a5230', '#d9d3c7', '#6b7480', '#b07a46'];

// A running greyhound (side view) with a numbered racing jacket. Legs swing while `running`.
export const Greyhound: React.FC<{ color: string; trap: number; coat: string; running: boolean; delay?: number }> = ({ color, trap, coat, running, delay = 0 }) => {
  const dark = 'rgba(0,0,0,.35)';
  const leg = (cls: string, x: number, y: number, d = 0) => (
    <g className={`dog-leg ${cls}`} style={{ transformOrigin: `${x}px ${y}px`, animationPlayState: running ? 'running' : 'paused', animationDelay: `${delay + d}s` }}>
      <path d={`M${x},${y} L${x - 3},${y + 13} L${x + 3},${y + 25}`} stroke={coat} strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d={`M${x + 3},${y + 25} l5,1`} stroke="#111" strokeWidth="3" strokeLinecap="round" />
    </g>
  );
  return (
    <svg viewBox="-8 -4 140 66" width="100%" height="100%" style={{ overflow: 'visible' }} aria-hidden>
      <ellipse cx="60" cy="58" rx="46" ry="3.5" fill="rgba(0,0,0,.28)" />
      {leg('dog-leg-b', 26, 30, 0.06)}{leg('dog-leg-a', 86, 31, 0.06)}
      <path d="M14,26 Q2,22 -5,10" stroke={coat} strokeWidth="3.4" strokeLinecap="round" fill="none" />
      <g className="dog-body" style={{ animationPlayState: running ? 'running' : 'paused', animationDelay: `${delay}s` }}>
        <path d="M13,24 C24,12 54,10 76,16 C86,18 94,21 99,25 C93,33 80,37 62,37 C45,37 28,35 13,30 Z" fill={coat} />
        <path d="M13,24 C24,12 54,10 76,16 C86,18 94,21 99,25 C60,18 30,22 13,24 Z" fill="rgba(255,255,255,.12)" />
        <path d="M93,22 C98,17 103,13 108,11 L116,16 C112,20 106,22 99,26 Z" fill={coat} />
        <path d="M106,12 C111,9 120,12 128,19 C124,22 117,22 112,21 Z" fill={coat} />
        <ellipse cx="127.5" cy="19.5" rx="2.6" ry="2" fill="#0a0a0a" />
        <circle cx="113" cy="14.5" r="1.8" fill="#fff" /><circle cx="113.6" cy="14.6" r="1" fill="#000" />
        <path d="M108,9 L103,2 L113,8 Z" fill={dark} />
        {/* racing jacket */}
        <path d="M42,15 C52,13 66,14 74,17 L72,35 C62,36 52,36 41,34 Z" fill={color} stroke="rgba(0,0,0,.4)" strokeWidth=".8" />
        <text x="58" y="30" textAnchor="middle" fontSize="15" fontWeight="900" fill={color === '#f1f5f9' || color === '#eab308' ? '#111' : '#fff'} fontFamily="Arial, sans-serif">{trap}</text>
        {/* muzzle */}
        <path d="M118,18 L128,21" stroke="#111" strokeWidth="1.2" /><path d="M118,22 L127,23" stroke="#111" strokeWidth="1.2" />
      </g>
      {leg('dog-leg-a', 28, 31)}{leg('dog-leg-b', 88, 32)}
    </svg>
  );
};

interface Props { dogs: Dog[]; progress: number[]; running: boolean; finishOrder?: number[] | null; selected?: number | null; onSelect?: (id: number) => void }

// Six-lane sand track: start boxes on the left, chequered finish on the right.
const DogTrack: React.FC<Props> = ({ dogs, progress, running, finishOrder, selected, onSelect }) => (
  <div className="relative rounded-2xl overflow-hidden border-2 border-amber-500/50 shadow-[0_0_30px_rgba(245,158,11,.25)]" style={{ background: 'linear-gradient(#92662f, #b98443)' }}>
    <div className="absolute inset-0 opacity-40 pointer-events-none" style={{ background: 'repeating-linear-gradient(90deg, rgba(0,0,0,.18) 0 2px, transparent 2px 9px), radial-gradient(circle at 30% 20%, rgba(255,255,255,.2), transparent 55%)' }} />
    <div className="absolute top-0 bottom-0 z-10 w-3" style={{ right: '6%', background: 'repeating-conic-gradient(#fff 0 25%, #111 0 50%) 0 0 / 12px 12px' }} aria-hidden />
    {dogs.map((d, i) => (
      <div key={d.id} onClick={() => onSelect?.(d.id)} className={`relative h-[46px] sm:h-14 border-b border-white/25 ${onSelect ? 'cursor-pointer' : ''} ${selected === d.id ? 'bg-white/20' : ''}`}>
        <div className="absolute left-0 top-0 bottom-0 w-9 bg-gradient-to-r from-black/70 to-transparent flex items-center pl-1.5">
          <span className="w-6 h-6 rounded-md text-[13px] font-black flex items-center justify-center border border-black/40" style={{ background: d.color, color: d.color === '#f1f5f9' || d.color === '#eab308' ? '#111' : '#fff' }}>{d.trap}</span>
        </div>
        <div className="absolute top-1/2 w-[74px] sm:w-[92px] h-[40px] sm:h-[48px]" style={{ left: `calc(${(progress[i] || 0) * 80}% + 34px)`, transform: 'translateY(-50%)' }}>
          <Greyhound color={d.color} trap={d.trap} coat={COATS[i % COATS.length]} running={running} delay={i * 0.04} />
        </div>
        {finishOrder && <div className="absolute right-[7%] top-1/2 -translate-y-1/2 mr-5 text-[11px] font-black px-1.5 rounded bg-black/70 text-white z-20">{['1st', '2nd', '3rd', '4th', '5th', '6th'][finishOrder.indexOf(d.id)]}</div>}
      </div>
    ))}
  </div>
);
export default DogTrack;
