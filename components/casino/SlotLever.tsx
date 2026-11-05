import React, { useRef, useState } from 'react';
import { sfx } from './slotSound';

// A 3D chrome pull-lever for slot machines. Drag the red ball down (or just tap it) to trigger the spin.
// The arm foreshortens and the ball swells as it travels towards the player, which sells the perspective.
const TRAVEL = 96;      // px of ball travel
const TRIGGER = 0.6;    // fraction of travel needed to count as a pull

const SlotLever: React.FC<{ onPull: () => void; disabled?: boolean; className?: string }> = ({ onPull, disabled, className = '' }) => {
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ y: number; moved: boolean } | null>(null);
  const timer = useRef<number | null>(null);

  const release = (fire: boolean) => {
    setDragging(false);
    start.current = null;
    if (fire) { sfx.click(); onPull(); }
    setDy(0);
  };

  const autoPull = () => {
    if (disabled) return;
    setDragging(false);
    setDy(TRAVEL);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => release(true), 260);
  };

  const onDown = (e: React.PointerEvent) => {
    if (disabled) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { y: e.clientY, moved: false };
    setDragging(true);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const d = Math.max(0, Math.min(TRAVEL, e.clientY - start.current.y));
    if (d > 4) start.current.moved = true;
    setDy(d);
  };
  const onUp = () => {
    if (!start.current) return;
    if (!start.current.moved) { autoPull(); start.current = null; return; }
    release(dy >= TRAVEL * TRIGGER);
  };

  const t = dy / TRAVEL;
  const armH = 118 - t * 70;               // arm foreshortens
  const ballScale = 1 + t * 0.28;          // ball comes toward the camera
  return (
    <div className={`select-none touch-none ${className}`} style={{ width: 56, height: 250 }} aria-label="Pull the lever to spin" role="button" tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) { e.preventDefault(); autoPull(); } }}>
      <div className="relative mx-auto" style={{ width: 56, height: 250, perspective: 420 }}>
        {/* housing */}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-12 h-20 rounded-xl border border-black/70 shadow-[inset_0_2px_6px_rgba(255,255,255,0.35),0_8px_18px_rgba(0,0,0,0.6)]" style={{ background: 'linear-gradient(90deg,#3b3f46,#c9ced6 40%,#8b919b 60%,#2b2e34)' }} />
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[62px] w-9 h-5 rounded-full border border-black/60" style={{ background: 'radial-gradient(circle at 35% 30%,#f5f5f5,#6b7280 70%,#1f2937)' }} />
        {/* slot track */}
        <div className="absolute left-1/2 -translate-x-1/2 top-0 w-2 rounded-full bg-black/70 shadow-[inset_0_0_4px_#000]" style={{ height: 190, top: 10 }} />
        {/* arm + ball */}
        <div className="absolute left-1/2 -translate-x-1/2 origin-bottom" style={{ bottom: 70, height: armH, width: 10, transformStyle: 'preserve-3d', transform: `rotateX(${-t * 14}deg)`, transition: dragging ? 'none' : 'height .38s cubic-bezier(.3,1.6,.5,1), transform .38s cubic-bezier(.3,1.6,.5,1)' }}>
          <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(90deg,#6b7280,#f8fafc 45%,#9ca3af 60%,#374151)', boxShadow: '0 0 8px rgba(0,0,0,.6)' }} />
          <div
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => release(false)}
            className={`absolute left-1/2 rounded-full ${disabled ? 'opacity-60' : 'cursor-grab active:cursor-grabbing'}`}
            style={{ top: -26, width: 40, height: 40, marginLeft: -20, transform: `scale(${ballScale})`, transition: dragging ? 'none' : 'transform .38s cubic-bezier(.3,1.6,.5,1)', background: 'radial-gradient(circle at 32% 28%,#fff 0 7%,#fecaca 8%,#ef4444 38%,#991b1b 75%,#450a0a)', boxShadow: '0 8px 14px rgba(0,0,0,.65), inset -4px -6px 10px rgba(0,0,0,.45), 0 0 18px rgba(239,68,68,.55)' }}
          />
        </div>
        {!disabled && dy === 0 && <div className="absolute left-0 right-0 -bottom-5 text-center text-[9px] tracking-widest font-bold text-yellow-300/90 animate-pulse">PULL</div>}
      </div>
    </div>
  );
};
export default SlotLever;
