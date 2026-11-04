import React, { useEffect, useRef, useState } from 'react';
import LivePitch from './LivePitch';
import { Match, MatchStatus } from '../types';
import type { LiveStatistics } from '../services/api';
import { useI18n } from '../i18n';

// The live pitch dressed as a stadium (stands full of fans, the pitch tilted in perspective, floodlight glow) and,
// once you scroll past it, a small floating copy that stays on screen above the markets -- like the provider's
// page -- so the match keeps playing in a corner while you pick bets. Tap the floating pitch to jump back up,
// the cross hides it until you scroll back to the top.

// Fans: rows of dots (home end warm, away end cool), darker towards the pitch.
const CROWD_HOME = 'radial-gradient(circle, rgba(255,170,60,0.95) 0 1.1px, transparent 1.7px) 0 0 / 6px 6px, radial-gradient(circle, rgba(255,120,40,0.7) 0 1px, transparent 1.6px) 3px 3px / 6px 6px, linear-gradient(#2b1a08, #5a3510)';
const CROWD_AWAY = 'radial-gradient(circle, rgba(215,220,230,0.9) 0 1.1px, transparent 1.7px) 0 0 / 6px 6px, radial-gradient(circle, rgba(150,160,175,0.7) 0 1px, transparent 1.6px) 3px 3px / 6px 6px, linear-gradient(#1b1f26, #3b424d)';

const Stadium: React.FC<{ children: React.ReactNode; tilt?: number }> = ({ children, tilt = 24 }) => (
  <div className="relative w-full mx-auto max-w-[640px] rounded-xl overflow-hidden ring-1 ring-black/50 shadow-[0_16px_36px_-14px_rgba(0,0,0,0.85)] bg-[#07110b]" style={{ perspective: '820px' }}>
    {/* stands */}
    <div className="absolute inset-x-0 top-0 h-[46%] flex">
      <div className="w-1/2" style={{ background: CROWD_HOME }} />
      <div className="w-1/2" style={{ background: CROWD_AWAY }} />
    </div>
    <div className="absolute inset-x-0 top-0 h-[46%]" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.05), rgba(3,10,6,0.92))' }} />
    {/* floodlights */}
    <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(60% 40% at 50% 30%, rgba(255,255,255,0.14), rgba(255,255,255,0))' }} />
    {/* the pitch, tilted away from the viewer */}
    <div className="relative px-[5%] pt-[9%] pb-[3%]" style={{ transform: `rotateX(${tilt}deg)`, transformOrigin: '50% 100%' }}>
      {children}
    </div>
  </div>
);

const StadiumPitch: React.FC<{ match: Match; stats: LiveStatistics | null; flash?: React.ComponentProps<typeof LivePitch>['flash'] }> = ({ match, stats, flash }) => {
  const { t } = useI18n();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [scrolledPast, setScrolledPast] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const el = frameRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => {
      // "past" = the pitch left the screen through the TOP (the user scrolled down), not through the bottom
      const past = !e.isIntersecting && e.boundingClientRect.bottom < (e.rootBounds?.height ?? window.innerHeight) / 2;
      setScrolledPast(past);
      if (e.isIntersecting) setHidden(false);
    }, { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (match.status !== MatchStatus.LIVE) return null;

  return (
    <>
      <div ref={frameRef}>
        <Stadium><LivePitch match={match} stats={stats} flash={flash} /></Stadium>
      </div>
      {scrolledPast && !hidden && (
        <div className="fixed top-[3.25rem] right-2 z-40 w-[250px] max-w-[62vw] rounded-lg shadow-2xl ring-1 ring-black/60" style={{ animation: 'pitch-fade-in 0.3s ease both' }}>
          <button onClick={() => setHidden(true)} aria-label={t('Mbyll')} className="absolute -top-2 -right-2 z-50 w-6 h-6 rounded-full bg-black/80 text-white text-xs font-bold leading-none border border-white/30">✕</button>
          <div onClick={() => frameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="cursor-pointer">
            <Stadium tilt={14}><LivePitch match={match} stats={stats} flash={flash} /></Stadium>
          </div>
        </div>
      )}
    </>
  );
};

export default StadiumPitch;
