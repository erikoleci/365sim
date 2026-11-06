import React, { useEffect, useRef } from 'react';
import { Dog } from '../../services/api';
import './casino.css';

// A running greyhound: a real rendered sprite, galloped with CSS (bounce, pitch and stretch) with dust kicked up behind it.
export const Greyhound: React.FC<{ color: string; trap: number; coat?: string; running: boolean; delay?: number }> = ({ trap, running, delay = 0 }) => {
  const n = Math.min(6, Math.max(1, trap));
  const state = running ? 'running' : 'paused';
  return (
    <div className="relative w-full h-full" aria-hidden>
      <div className="absolute left-[10%] right-[8%] bottom-[0%] h-[9%] rounded-[50%] bg-black/45 blur-[2px]" />
      {running && <div className="dog-dust" style={{ animationDelay: `${delay}s` }} />}
      {/* real greyhound run cycle: 20 frames in a 5x4 sprite sheet (see public/casino/dogs) */}
      <div className="dog-run absolute inset-0" style={{ backgroundImage: `url(/casino/dogs/run${n}.webp)`, animationPlayState: `${state}, ${state}`, animationDelay: `${-delay}s, ${-delay}s` }} />
    </div>
  );
};

/** Progress of one dog (0..1 on the track, then a short run-out past the line) after `s` seconds, finishing at `T` seconds. */
export const dogProgress = (s: number, T: number, wob: { a: number; f: number; p: number }) => {
  const x = s / T;
  if (x <= 1) return Math.max(0, x + Math.sin(x * Math.PI) * wob.a * Math.sin(wob.f * x * 6 + wob.p));
  return 1 + 0.18 * Math.tanh((x - 1) / 0.18); // slows down after the line
};

interface Props { dogs: Dog[]; progress: number[]; running: boolean; finishOrder?: number[] | null; selected?: number | null; onSelect?: (id: number) => void; children?: React.ReactNode }

// TV-style race view: a real track-side camera video (public/casino/dogs/track-s.mp4, 10 s, tracks to the right) plays while the
// race runs, the greyhounds are laid over it in lanes. The camera follows the leader: he sits at ~62% of the screen and the others
// are placed behind / ahead of him by their real progress. Geometry below is in the 1280x720 frame of the video.
const VW = 1280, VH = 720, SPAN = 2.4, SCALE_NEAR = 0.27, LINE_K = 1.11, FAR_K = 0.85, PROP_Y = 315; // LINE_K: the finish line moves like the ground of the video
const LANE_Y = [345, 392, 445, 505, 568, 628]; // feet of the lane: far (trap 6) -> near (trap 1); the camera is side-on, lanes are flat bands
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

const DogTrack: React.FC<Props> = ({ dogs, progress, running, finishOrder, selected, children }) => {
  const vid = useRef<HTMLVideoElement>(null);
  const lead = progress.length ? Math.max(...progress) : 0;
  const started = lead > 0;
  const was = useRef(false);
  useEffect(() => {
    const v = vid.current; if (!v) return;
    const active = running && started;
    if (active && !was.current) { try { v.currentTime = Math.min(8.5, lead * 7); } catch { /* not ready */ } void v.play().catch(() => {}); }
    if (!active) { v.pause(); if (!started) { try { v.currentTime = 0; } catch { /* not ready */ } } }
    was.current = active;
  }, [running, started, lead]);

  const fx = 0.3 + 0.32 * smooth(0, 0.3, lead); // where the leader stands on the screen
  const place = (trap: number, p: number) => {
    const k = Math.min(6, Math.max(1, trap)) - 1;
    const y = LANE_Y[5 - k];
    const x = fx + (p - lead) * SPAN - k * 0.012; // the traps are staggered a little
    const s = 0.55 + 0.45 * ((y - LANE_Y[0]) / (LANE_Y[5] - LANE_Y[0]));
    return { x, y, s, tilt: 0 };
  };
  const pos = dogs.map((d, i) => ({ d, i, ...place(d.trap, progress[i] || 0) }));
  const xFinish = fx + (1 - lead) * LINE_K;
  const xStartProp = fx - lead * FAR_K;            // start traps stand behind the far lane and scroll away with the far ground
  const xFinishProp = fx + (1 - lead) * FAR_K;     // the FINISH sign + chequered post
  const anyRun = running && started;
  return (
    <div className="relative dog-hero rounded-2xl overflow-hidden border-2 border-amber-500/50 shadow-[0_0_30px_rgba(245,158,11,.25)] mb-3" style={{ aspectRatio: '16/9' }}>
      <video ref={vid} className="absolute inset-0 w-full h-full object-cover" muted playsInline preload="auto" poster="/casino/dogs/track-s-poster.jpg" aria-hidden>
        <source src="/casino/dogs/track-s.webm" type="video/webm" />
        <source src="/casino/dogs/track-s.mp4" type="video/mp4" />
      </video>
      {xStartProp > -0.4 && <img src="/casino/dogs/start.webp" alt="" draggable={false} className="absolute pointer-events-none select-none" style={{ left: `${xStartProp * 100}%`, top: `${PROP_Y / VH * 100}%`, width: '40%', transform: 'translate(-50%,-100%)', zIndex: 1 }} />}
      {xFinishProp < 1.2 && xFinishProp > -0.3 && <img src="/casino/dogs/finish.webp" alt="" draggable={false} className="absolute pointer-events-none select-none" style={{ left: `${xFinishProp * 100}%`, top: `${PROP_Y / VH * 100}%`, width: '24%', transform: 'translate(-50%,-100%)', zIndex: 1 }} />}
      {xFinish < 1.25 && xFinish > -0.3 && (() => {
        // chequered line straight across the lanes, a little wider at the near (bottom) end
        const L = xFinish - 0.05, W = 0.1, top = 296, bottom = 640;
        return <div className="absolute pointer-events-none" style={{ left: `${L * 100}%`, width: `${W * 100}%`, top: `${top / VH * 100}%`, height: `${(bottom - top) / VH * 100}%`, clipPath: 'polygon(42% 0, 58% 0, 68% 100%, 32% 100%)', background: 'repeating-conic-gradient(#f5f5f5 0 25%, #1a1a1a 0 50%) 0 0 / 12px 12px', opacity: 0.9 }} />;
      })()}
      {[...pos].sort((a, b) => a.y - b.y).map((q) => {
        if (q.x < -0.25 || q.x > 1.15) return null;
        const w = SCALE_NEAR * q.s;
        return (
          <div key={q.d.id} className="absolute" style={{ left: `${q.x * 100}%`, top: `${(q.y / VH) * 100}%`, width: `${w * 100}%`, aspectRatio: '1.923', transform: `translate(-50%,-92%) rotate(${q.tilt}deg)`, transformOrigin: '50% 100%', zIndex: Math.round(q.y) }}>
            <Greyhound color={q.d.color} trap={q.d.trap} running={running} delay={q.i * 0.17} />
            {selected === q.d.id && <div className="absolute left-1/2 -top-[26%] -translate-x-1/2 text-[10px] sm:text-xs font-black px-1.5 py-0.5 rounded bg-yellow-300 text-black whitespace-nowrap shadow" style={{ transform: `rotate(${-q.tilt}deg)` }}>YOUR PICK ▼</div>}
          </div>
        );
      })}
      <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 70px 10px rgba(0,0,0,.55)' }} />
      {(anyRun || finishOrder) && (
        <div className="absolute top-1.5 right-1.5 flex flex-col gap-0.5 pointer-events-none">
          {(finishOrder ? finishOrder.map((id) => pos.find((q) => q.d.id === id)).filter(Boolean) as typeof pos : [...pos].sort((a, b) => (progress[b.i] || 0) - (progress[a.i] || 0))).map((q, r) => (
            <div key={q.d.id} className="flex items-center gap-1 bg-black/65 rounded px-1 text-[10px] font-black text-white"><span className={`${finishOrder ? 'w-5' : 'w-3'} opacity-80`}>{finishOrder ? ['1st', '2nd', '3rd', '4th', '5th', '6th'][r] : r + 1}</span><span className="w-3.5 h-3.5 rounded-sm flex items-center justify-center" style={{ background: q.d.color, color: q.d.color === '#f1f5f9' || q.d.color === '#eab308' ? '#111' : '#fff' }}>{q.d.trap}</span></div>
          ))}
        </div>
      )}
      <div className="absolute bottom-1.5 left-1.5 text-[10px] font-black tracking-widest text-white/80 bg-red-600/80 rounded px-1.5 py-0.5 pointer-events-none">{running ? '● LIVE CAM' : 'TRACK CAM'}</div>
      {children && <div className="absolute bottom-2 inset-x-0 text-center font-extrabold text-base sm:text-lg pointer-events-none" style={{ textShadow: '0 2px 6px #000' }}>{children}</div>}
    </div>
  );
};
export default DogTrack;
