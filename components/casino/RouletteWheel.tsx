import React, { useEffect, useRef } from 'react';
import { WHEEL_ORDER, SLOT_DEG, pocketColor, pocketIndex, pocketCenterDeg, polar, landingBallAngle, easeOutCubic } from '../../utils/rouletteWheel';

// A European roulette wheel drawn in SVG. The wheel turns, the ball runs against it on the track,
// slows down and drops into the pocket of the result. Everything that moves is updated straight on
// the SVG elements from one requestAnimationFrame loop (no React re-render per frame), so it stays
// smooth on a phone.
//   idle     : the wheel turns slowly; the ball rests in the last result's pocket (none before the first spin)
//   spinning : wheel up to speed, ball circling fast on the outer track (waiting for the result)
//   landing  : the ball slows down over LANDING_SECONDS and settles in the pocket of `result`
export type WheelPhase = 'idle' | 'spinning' | 'landing';

interface Props {
  phase: WheelPhase;
  result: number | null;
  onLanded?: () => void;
  size?: number;
}

const C = 150;                // centre of the 300x300 drawing
const R_BOWL = 148, R_TRACK_IN = 124, R_POCKET_OUT = 106, R_POCKET_IN = 76, R_NUM = 91, R_HUB = 52;
const R_ORBIT = 116;          // ball on the track
const R_REST = 98;            // ball in a pocket
const IDLE_SPEED = 9;         // wheel degrees per second
const SPIN_SPEED = 32;
const BALL_SPEED = 520;       // ball degrees per second (against the wheel) while waiting
const LANDING_SECONDS = 4.6;

const FILL = { green: '#0f7a3a', red: '#b3202a', black: '#15161a' } as const;

const wedge = (r1: number, r2: number, a0: number, a1: number) => {
  const p1 = polar(C, C, r2, a0), p2 = polar(C, C, r2, a1), p3 = polar(C, C, r1, a1), p4 = polar(C, C, r1, a0);
  return `M${p1.x} ${p1.y} A${r2} ${r2} 0 0 1 ${p2.x} ${p2.y} L${p3.x} ${p3.y} A${r1} ${r1} 0 0 0 ${p4.x} ${p4.y} Z`;
};

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const RouletteWheel: React.FC<Props> = ({ phase, result, onLanded, size = 300 }) => {
  const wheelRef = useRef<SVGGElement>(null);
  const ballRef = useRef<SVGGElement>(null);
  const onLandedRef = useRef(onLanded);
  onLandedRef.current = onLanded;

  // Animation state lives in a ref: it changes 60 times a second and React must not see it.
  const st = useRef({
    phase: 'idle' as WheelPhase, theta: 0, w: IDLE_SPEED, ball: 0, r: R_ORBIT, shown: false,
    lastIndex: null as number | null, landFrom: 0, landTo: 0, landStart: 0, landMs: LANDING_SECONDS * 1000, landIndex: 0, landing: false,
  });

  useEffect(() => {
    const s = st.current;
    if (phase === 'spinning') {
      if (!s.shown) { s.ball = s.theta; s.r = R_ORBIT; }
      s.shown = true; s.landing = false; s.phase = 'spinning';
    } else if (phase === 'landing' && result != null && pocketIndex(result) >= 0) {
      const seconds = reducedMotion() ? 1.2 : LANDING_SECONDS;
      s.landMs = seconds * 1000;
      s.landIndex = pocketIndex(result);
      s.landFrom = s.ball;
      // where the wheel will be when the ball has settled (it keeps turning at its spin speed)
      s.landTo = landingBallAngle(s.ball, s.theta + SPIN_SPEED * seconds, s.landIndex, BALL_SPEED * seconds / 3);
      s.landStart = performance.now();
      s.landing = true; s.phase = 'landing'; s.shown = true;
    } else if (phase === 'idle') {
      s.phase = 'idle'; s.landing = false;
      if (s.lastIndex == null) s.shown = false;
    }
  }, [phase, result]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const s = st.current;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const targetW = s.phase === 'idle' ? IDLE_SPEED : SPIN_SPEED;
      s.w += (targetW - s.w) * Math.min(1, dt * 4);
      s.theta += s.w * dt;

      if (s.phase === 'spinning') {
        s.ball -= BALL_SPEED * dt;
        s.r += (R_ORBIT - s.r) * Math.min(1, dt * 6);
      } else if (s.phase === 'landing' && s.landing) {
        const u = Math.min(1, (now - s.landStart) / s.landMs);
        s.ball = s.landFrom + (s.landTo - s.landFrom) * easeOutCubic(u);
        // the ball stays on the track, then drops towards the pockets with a few small bounces
        const drop = u < 0.55 ? 0 : easeOutCubic((u - 0.55) / 0.45);
        // small hops once it has dropped in, dying out as the ball settles
        const bounce = u > 0.8 ? Math.abs(Math.sin((u - 0.8) * 75)) * 5 * Math.pow((1 - u) / 0.2, 2) : 0;
        s.r = R_ORBIT + (R_REST - R_ORBIT) * drop + bounce;
        if (u >= 1) {
          s.landing = false; s.phase = 'idle'; s.lastIndex = s.landIndex;
          onLandedRef.current?.();
        }
      } else if (s.shown && s.lastIndex != null) {
        // resting: the ball turns with the wheel, locked in its pocket
        s.ball = s.theta + pocketCenterDeg(s.lastIndex);
        s.r += (R_REST - s.r) * Math.min(1, dt * 8);
      }

      wheelRef.current?.setAttribute('transform', `rotate(${s.theta % 360} ${C} ${C})`);
      const ball = ballRef.current;
      if (ball) {
        if (!s.shown) ball.setAttribute('opacity', '0');
        else {
          const p = polar(C, C, s.r, s.ball);
          ball.setAttribute('opacity', '1');
          ball.setAttribute('transform', `translate(${p.x} ${p.y})`);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg viewBox="0 0 300 300" width={size} height={size} role="img" aria-label="Roulette wheel" style={{ maxWidth: '100%', height: 'auto' }}>
      <defs>
        <radialGradient id="rw-bowl" cx="50%" cy="50%" r="50%">
          <stop offset="0.80" stopColor="#5a3418" /><stop offset="0.93" stopColor="#8a5a2b" /><stop offset="1" stopColor="#2c1808" />
        </radialGradient>
        <radialGradient id="rw-track" cx="50%" cy="50%" r="50%">
          <stop offset="0.80" stopColor="#101010" /><stop offset="1" stopColor="#2a2a2a" />
        </radialGradient>
        <radialGradient id="rw-hub" cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#f6e08a" /><stop offset="0.6" stopColor="#d4af37" /><stop offset="1" stopColor="#7a5a10" />
        </radialGradient>
        <radialGradient id="rw-ball" cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#bfc3c8" />
        </radialGradient>
        <filter id="rw-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="1.5" dy="2" stdDeviation="1.6" floodOpacity="0.55" /></filter>
      </defs>

      {/* wooden bowl and the track the ball runs on (do not turn) */}
      <circle cx={C} cy={C} r={R_BOWL} fill="url(#rw-bowl)" />
      <circle cx={C} cy={C} r={R_TRACK_IN + 8} fill="none" stroke="#d4af37" strokeWidth="1.5" opacity="0.8" />
      <circle cx={C} cy={C} r={R_TRACK_IN} fill="url(#rw-track)" />

      {/* the wheel itself */}
      <g ref={wheelRef}>
        {WHEEL_ORDER.map((n, i) => {
          const a0 = i * SLOT_DEG, a1 = (i + 1) * SLOT_DEG;
          const t = polar(C, C, R_NUM, (a0 + a1) / 2);
          return (
            <g key={n}>
              <path d={wedge(R_POCKET_IN, R_POCKET_OUT, a0, a1)} fill={FILL[pocketColor(n)]} stroke="#d4af37" strokeWidth="0.7" />
              <text x={t.x} y={t.y} fill="#fff" fontSize="8.5" fontWeight="700" textAnchor="middle" dominantBaseline="central"
                transform={`rotate(${(a0 + a1) / 2} ${t.x} ${t.y})`} style={{ fontFamily: 'Arial, sans-serif' }}>{n}</text>
            </g>
          );
        })}
        <circle cx={C} cy={C} r={R_POCKET_IN} fill="#1c1c1f" stroke="#d4af37" strokeWidth="1.2" />
        <circle cx={C} cy={C} r={R_POCKET_IN - 14} fill="none" stroke="#d4af37" strokeWidth="0.8" opacity="0.6" />
        {[0, 90, 180, 270].map((a) => {
          const p = polar(C, C, R_POCKET_IN - 4, a), q = polar(C, C, R_HUB, a);
          return <line key={a} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#d4af37" strokeWidth="3" strokeLinecap="round" />;
        })}
        <circle cx={C} cy={C} r={R_HUB * 0.62} fill="url(#rw-hub)" />
        <circle cx={C} cy={C} r={7} fill="#f6e08a" stroke="#7a5a10" strokeWidth="1" />
      </g>

      {/* the ball (moves independently of the wheel) */}
      <g ref={ballRef} opacity="0">
        <circle r="5.2" fill="url(#rw-ball)" filter="url(#rw-shadow)" />
      </g>
    </svg>
  );
};

export default React.memo(RouletteWheel);
