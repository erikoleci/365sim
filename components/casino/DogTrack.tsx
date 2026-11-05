import React from 'react';
import { Dog } from '../../services/api';
import './casino.css';

// A running greyhound: a real rendered sprite, galloped with CSS (bounce, pitch and stretch) with dust kicked up behind it.
export const Greyhound: React.FC<{ color: string; trap: number; coat?: string; running: boolean; delay?: number }> = ({ trap, running, delay = 0 }) => {
  const n = Math.min(6, Math.max(1, trap));
  return (
    <div className="relative w-full h-full" aria-hidden>
      <div className="absolute left-[8%] right-[6%] bottom-[2%] h-[10%] rounded-[50%] bg-black/45 blur-[2px]" />
      {running && <div className="dog-dust" style={{ animationDelay: `${delay}s` }} />}
      <div className="dog-gallop absolute inset-0" style={{ animationPlayState: running ? 'running' : 'paused', animationDelay: `${delay}s` }}>
        <img src={`/casino/dogs/dog${n}.png`} alt="" draggable={false} className="w-full h-full object-contain object-bottom select-none" />
      </div>
    </div>
  );
};

interface Props { dogs: Dog[]; progress: number[]; running: boolean; finishOrder?: number[] | null; selected?: number | null; onSelect?: (id: number) => void }

// Six-lane sand track: start boxes on the left, chequered finish on the right.
const DogTrack: React.FC<Props> = ({ dogs, progress, running, finishOrder, selected, onSelect }) => (
  <div className="relative rounded-2xl overflow-hidden border-2 border-amber-500/50 shadow-[0_0_30px_rgba(245,158,11,.25)]" style={{ background: 'linear-gradient(#7a5226, #b98443 55%, #8a5f2c)' }}>
    <div className="absolute inset-0 opacity-40 pointer-events-none" style={{ background: 'repeating-linear-gradient(90deg, rgba(0,0,0,.18) 0 2px, transparent 2px 9px), radial-gradient(circle at 30% 20%, rgba(255,255,255,.2), transparent 55%)' }} />
    <div className="absolute top-0 bottom-0 z-10 w-3" style={{ right: '6%', background: 'repeating-conic-gradient(#fff 0 25%, #111 0 50%) 0 0 / 12px 12px' }} aria-hidden />
    {dogs.map((d, i) => (
      <div key={d.id} onClick={() => onSelect?.(d.id)} className={`relative h-[54px] sm:h-[68px] border-b border-white/25 ${onSelect ? 'cursor-pointer' : ''} ${selected === d.id ? 'bg-white/20' : ''}`}>
        <div className="absolute left-0 top-0 bottom-0 w-9 bg-gradient-to-r from-black/70 to-transparent flex items-center pl-1.5">
          <span className="w-6 h-6 rounded-md text-[13px] font-black flex items-center justify-center border border-black/40" style={{ background: d.color, color: d.color === '#f1f5f9' || d.color === '#eab308' ? '#111' : '#fff' }}>{d.trap}</span>
        </div>
        <div className="absolute top-1/2 w-[88px] sm:w-[118px] h-[50px] sm:h-[64px]" style={{ left: `calc(${(progress[i] || 0) * 80}% + 34px)`, transform: 'translateY(-50%)' }}>
          <Greyhound color={d.color} trap={d.trap} running={running} delay={i * 0.04} />
        </div>
        {finishOrder && <div className="absolute right-[7%] top-1/2 -translate-y-1/2 mr-5 text-[11px] font-black px-1.5 rounded bg-black/70 text-white z-20">{['1st', '2nd', '3rd', '4th', '5th', '6th'][finishOrder.indexOf(d.id)]}</div>}
      </div>
    ))}
  </div>
);
export default DogTrack;
