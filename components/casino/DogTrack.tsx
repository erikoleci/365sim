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

interface Props { dogs: Dog[]; progress: number[]; running: boolean; finishOrder?: number[] | null; selected?: number | null; onSelect?: (id: number) => void; children?: React.ReactNode }

// The track picture is 2000x617 "design pixels". Dogs run in perspective from the traps (left) to the diagonal finish line
// (right) and a TV-style camera follows the leader.
const IW = 2000, IH = 617, ZOOM = 2.5, VIEW_W = IW / ZOOM, VIEW_H = VIEW_W * 0.5625;
const interp = (pts: number[][], x: number) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i += 1) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  return pts[pts.length - 1][1];
};
const FAR = [[300, 288], [1000, 318], [1550, 345], [1900, 405]];
const NEAR = [[130, 337], [600, 390], [1000, 437], [1500, 500], [1900, 565]];
const lane = (trap: number) => 1 - (Math.min(6, Math.max(1, trap)) - 0.5) / 6; // trap 1 = nearest lane
const headX = (f: number, p: number) => { const xs = 430 - 290 * f, xe = 1900 - 430 * f; return xs + (xe - xs) * Math.min(1, Math.max(0, p)); };
const place = (trap: number, p: number) => {
  const f = lane(trap); const hx = headX(f, p);
  const w = 100 + 105 * ((hx - 130) / 1770); // dogs grow as they run toward the camera
  const cx = hx - w * 0.38; const fy = interp(FAR, cx); const y = fy + f * (interp(NEAR, cx) - fy);
  return { x: cx, y, w };
};

const DogTrack: React.FC<Props> = ({ dogs, progress, running, finishOrder, selected, children }) => {
  const pos = dogs.map((d, i) => ({ d, i, ...place(d.trap, progress[i] || 0) }));
  const lead = pos.length ? Math.max(...pos.map((q) => q.x)) : 400;
  const avg = pos.length ? pos.reduce((a, q) => a + q.x, 0) / pos.length : 400;
  const focus = lead * 0.65 + avg * 0.35;
  const camX = Math.min(IW - VIEW_W, Math.max(0, focus - VIEW_W * 0.62));
  const midY = pos.length ? pos.reduce((a, q) => a + q.y, 0) / pos.length : 400;
  const camY = Math.min(IH - VIEW_H, Math.max(0, midY - VIEW_H * 0.55));
  const anyRun = running && progress.some((v) => v > 0 && v < 1);
  return (
    <div className="relative dog-hero rounded-2xl overflow-hidden border-2 border-amber-500/50 shadow-[0_0_30px_rgba(245,158,11,.25)] mb-3" style={{ aspectRatio: '16/9' }}>
      <div className="absolute top-0 left-0" style={{ width: `${ZOOM * 100}%`, aspectRatio: `${IW}/${IH}`, transform: `translate(${(-camX / IW) * 100}%, ${(-camY / IH) * 100}%)`, transition: running ? 'transform .28s linear' : 'transform 1.4s cubic-bezier(.4,0,.2,1)', willChange: 'transform' }}>
        <img src="/casino/dogs/track.png" alt="" draggable={false} className="absolute inset-0 w-full h-full select-none" />
        {[...pos].sort((a, b) => a.y - b.y).map((q) => {
          const done = (progress[q.i] || 0) >= 1; const mine = selected === q.d.id;
          return (
            <div key={q.d.id} className="absolute" style={{ left: `${(q.x / IW) * 100}%`, top: `${(q.y / IH) * 100}%`, width: `${(q.w / IW) * 100}%`, aspectRatio: '1.75', transform: 'translate(-50%,-100%)', zIndex: Math.round(q.y) }}>
              <Greyhound color={q.d.color} trap={q.d.trap} running={running && !done} delay={q.i * 0.05} />
              {mine && <div className="absolute left-1/2 -top-[34%] -translate-x-1/2 text-[10px] sm:text-xs font-black px-1.5 py-0.5 rounded bg-yellow-300 text-black whitespace-nowrap shadow">YOUR PICK ▼</div>}
              {finishOrder && <div className="absolute left-1/2 -top-[34%] -translate-x-1/2 text-[10px] sm:text-xs font-black px-1.5 py-0.5 rounded bg-black/80 text-white whitespace-nowrap">{['1st', '2nd', '3rd', '4th', '5th', '6th'][finishOrder.indexOf(q.d.id)]}</div>}
            </div>
          );
        })}
      </div>
      {anyRun && <div className="dog-speed absolute inset-0 pointer-events-none" />}
      <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 70px 10px rgba(0,0,0,.65)' }} />
      {anyRun && (
        <div className="absolute top-1.5 right-1.5 flex flex-col gap-0.5 pointer-events-none">
          {[...pos].sort((a, b) => b.x - a.x).map((q, r) => (
            <div key={q.d.id} className="flex items-center gap-1 bg-black/60 rounded px-1 text-[10px] font-black text-white"><span className="opacity-70 w-3">{r + 1}</span><span className="w-3.5 h-3.5 rounded-sm flex items-center justify-center" style={{ background: q.d.color, color: q.d.color === '#f1f5f9' || q.d.color === '#eab308' ? '#111' : '#fff' }}>{q.d.trap}</span></div>
          ))}
        </div>
      )}
      <div className="absolute bottom-1.5 left-1.5 text-[10px] font-black tracking-widest text-white/80 bg-red-600/80 rounded px-1.5 py-0.5 pointer-events-none">{running ? '● LIVE CAM' : 'TRACK CAM'}</div>
      {children && <div className="absolute bottom-2 inset-x-0 text-center font-extrabold text-base sm:text-lg pointer-events-none" style={{ textShadow: '0 2px 6px #000' }}>{children}</div>}
    </div>
  );
};
export default DogTrack;
