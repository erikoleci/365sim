import React, { useEffect, useRef, useState } from 'react';
import LivePitch from './LivePitch';
import { CornerFlagIcon } from './PitchIcons';
import { Match, MatchStatus } from '../types';
import type { LiveStatistics } from '../services/api';
import { useI18n } from '../i18n';

// The live pitch dressed as a stadium (stands full of fans, the pitch tilted in perspective, floodlight glow) and,
// once you scroll past it, a small floating copy that stays on screen above the markets -- like the provider's
// page -- so the match keeps playing in a corner while you pick bets. Tap the floating pitch to jump back up,
// the cross hides it until you scroll back to the top.

// Flat frame: no stands, no tilt -- the pitch is wide and low so the odds stay close under it.
const Stadium: React.FC<{ children: React.ReactNode; compact?: boolean }> = ({ children }) => (
  <div className="relative w-full mx-auto max-w-[560px]">{children}</div>
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

  // Corner card in the top right of the stage, like the provider's: only while the decoded action is a corner.
  const action = match.liveAction;
  const cornerTeam = action?.kind === 'corner' && action.side ? (action.side === 'home' ? match.homeTeam : match.awayTeam) : null;

  return (
    <>
      <div ref={frameRef}>
        <div className="relative">
          <Stadium><LivePitch match={match} stats={stats} flash={flash} /></Stadium>
          {cornerTeam && (
            <div key={`${action?.side}-corner`} className="absolute top-2 right-2 z-30 w-[96px] md:w-[118px] rounded-lg bg-black/75 backdrop-blur-sm ring-1 ring-white/15 shadow-xl overflow-hidden" style={{ animation: 'pitch-fade-in 0.4s ease both' }}>
              <div className="px-2 pt-1 text-left text-[11px] md:text-xs font-extrabold text-white">{t('Korner')}</div>
              <div className="flex items-end justify-center h-10 md:h-12" style={{ background: 'linear-gradient(to bottom, #1f5a37, #174a2d)' }}>
                <CornerFlagIcon className="w-5 h-8 md:w-6 md:h-10" />
              </div>
              <div className="px-1.5 py-1 text-center text-[9px] md:text-[10px] leading-tight text-white/85 truncate">{t('Korner për')} {cornerTeam}</div>
            </div>
          )}
        </div>
      </div>
      {scrolledPast && !hidden && (
        <div className="fixed top-[3.75rem] md:top-[5.75rem] right-2 z-40 w-[230px] max-w-[58vw] rounded-lg shadow-2xl ring-1 ring-black/60" style={{ animation: 'pitch-fade-in 0.3s ease both' }}>
          <button onClick={() => setHidden(true)} aria-label={t('Mbyll')} className="absolute -top-2 -right-2 z-50 w-6 h-6 rounded-full bg-black/80 text-white text-xs font-bold leading-none border border-white/30">✕</button>
          <div onClick={() => frameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="cursor-pointer">
            <Stadium compact><LivePitch match={match} stats={stats} flash={flash} compact /></Stadium>
          </div>
        </div>
      )}
    </>
  );
};

export default StadiumPitch;
