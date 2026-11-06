import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Dog } from '../../services/api';
import { makeProgressStore, type ProgressStore } from './raceProgress';
import './casino.css';

// A running greyhound: a real rendered sprite, galloped with CSS (bounce, pitch and stretch) with dust kicked up behind it.
export const Greyhound: React.FC<{ color: string; trap: number; coat?: string; running: boolean; delay?: number }> = React.memo(({ trap, running, delay = 0 }) => {
  const n = Math.min(6, Math.max(1, trap));
  const state = running ? 'running' : 'paused';
  return (
    <div className="relative w-full h-full" aria-hidden>
      <div className="absolute left-[10%] right-[8%] bottom-[0%] h-[9%] rounded-[50%] bg-black/45 blur-[2px]" />
      {running && <div className="dog-dust" style={{ animationDelay: `${delay}s` }} />}
      {/* real greyhound run cycle: 20 frames in a 5x4 sprite sheet (see public/casino/dogs) */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="dog-run-y" style={{ animationPlayState: state, animationDelay: `${-delay}s` }}>
          <div className="dog-run-x" style={{ backgroundImage: `url(/casino/dogs/run${n}.webp)`, animationPlayState: state, animationDelay: `${-delay}s` }} />
        </div>
      </div>
    </div>
  );
});

/** Progress of one dog (0..1 on the track, then a short run-out past the line) after `s` seconds, finishing at `T` seconds. */
export const RUN_OUT = 1.8; // seconds the dogs keep running after the last one is due, so every dog is clearly past the line
export const dogProgress = (s: number, T: number, wob: { a: number; f: number; p: number }) => {
  const x = s / T;
  if (x <= 1) return Math.max(0, x + Math.sin(x * Math.PI) * wob.a * Math.sin(wob.f * x * 6 + wob.p));
  return 1 + 0.36 * Math.tanh((x - 1) / 0.36); // eases off after the line
};

export { makeProgressStore };
const NO_STORE = makeProgressStore();

interface Props { dogs: Dog[]; progress?: number[]; store?: ProgressStore; running: boolean; finishOrder?: number[] | null; selected?: number | null; onSelect?: (id: number) => void; children?: React.ReactNode }

// TV-style race view: a real track-side camera video (public/casino/dogs/track-s.mp4, 10 s, tracks to the right) plays while the
// race runs, the greyhounds are laid over it in lanes. The camera follows the leader: he sits at ~62% of the screen and the others
// are placed behind / ahead of him by their real progress. Geometry below is in the 1280x720 frame of the video.
const VH = 720, SPAN = 1.5, SCALE_NEAR = 0.27, LINE_K = SPAN; // dogs and the finish line share ONE scale, so a dog crosses the line exactly when its progress passes 1
const LANE_Y = [345, 392, 445, 505, 568, 628]; // feet of the lane: far (trap 6) -> near (trap 1); the camera is side-on, lanes are flat bands
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

const DogTrack: React.FC<Props> = ({ dogs, progress: progressProp, store, running, finishOrder, selected, children }) => {
  const st = store ?? NO_STORE;
  const fromStore = useSyncExternalStore(st.subscribe, st.get);
  const progress = progressProp ?? fromStore;
  const vid = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Positions are written as transforms in pixels (cheap, GPU): left/top/width changes would re-layout the page every frame.
  const [W, setW] = useState(720);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    setW(el.clientWidth || 720);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 720));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const H = (W * 9) / 16;
  const lead = progress.length ? Math.max(...progress) : 0;
  const started = lead > 0;
  const was = useRef(false);
  useEffect(() => {
    const v = vid.current; if (!v) return;
    const active = running && started; // loops, so the picture never freezes mid-race
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
  const anyRun = running && started;
  return (
    <div ref={box} className="relative dog-hero rounded-2xl overflow-hidden border-2 border-amber-500/50 shadow-[0_0_30px_rgba(245,158,11,.25)] mb-3" style={{ aspectRatio: '16/9', contain: 'layout paint style' }}>
      <video ref={vid} className="absolute inset-0 w-full h-full object-cover" muted loop playsInline preload="auto" poster="/casino/dogs/track-s-poster.jpg" aria-hidden>
        <source src="/casino/dogs/track-s.webm" type="video/webm" />
        <source src="/casino/dogs/track-s.mp4" type="video/mp4" />
      </video>
      {xFinish < 1.25 && xFinish > -0.3 && (() => {
        // chequered line straight across the lanes, a little wider at the near (bottom) end
        const w = 0.1 * W, top = (296 / VH) * H, h = ((640 - 296) / VH) * H;
        return <div className="absolute left-0 top-0 pointer-events-none" style={{ width: w, height: h, transform: `translate3d(${xFinish * W - w / 2}px, ${top}px, 0)`, willChange: 'transform', clipPath: 'polygon(42% 0, 58% 0, 68% 100%, 32% 100%)', background: 'repeating-conic-gradient(#f5f5f5 0 25%, #1a1a1a 0 50%) 0 0 / 12px 12px', opacity: 0.9 }} />;
      })()}
      {[...pos].sort((a, b) => a.y - b.y).map((q) => {
        if (q.x < -0.25 || q.x > 1.15) return null;
        const w = SCALE_NEAR * q.s * W, h = w / 1.923;
        return (
          <div key={q.d.id} className="absolute left-0 top-0" style={{ width: w, height: h, transform: `translate3d(${q.x * W - w / 2}px, ${(q.y / VH) * H - h * 0.92}px, 0)`, willChange: 'transform', zIndex: Math.round(q.y) }}>
            <Greyhound color={q.d.color} trap={q.d.trap} running={running} delay={q.i * 0.17} />
            {selected === q.d.id && <div className="absolute left-1/2 -top-[26%] -translate-x-1/2 text-[10px] sm:text-xs font-black px-1.5 py-0.5 rounded bg-yellow-300 text-black whitespace-nowrap shadow">YOUR PICK ▼</div>}
          </div>
        );
      })}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,.55) 100%)' }} />
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
