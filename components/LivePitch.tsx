import React from 'react';
import { Match, MatchStatus } from '../types';

interface LivePitchProps {
  match: Match;
}

// A simple animated pitch view for live matches — team names, a pulsing
// possession dot near midfield, and a "Sulm" (attack) label, similar to
// the reference screenshots' in-play visualization. Purely decorative;
// it is driven off match.currentMinute / status, not real event data.
const LivePitch: React.FC<LivePitchProps> = ({ match }) => {
  const isLive = match.status === MatchStatus.LIVE;
  if (!isLive) return null;

  // Deterministic-but-lively side alternation based on the minute, so the
  // possession indicator drifts left/right over time instead of jumping randomly on every render.
  const minuteNum = parseInt((match.currentMinute || '0').replace(/\D/g, ''), 10) || 0;
  const possessionHome = Math.floor(minuteNum / 3) % 2 === 0;
  const possessingTeam = possessionHome ? match.homeTeam : match.awayTeam;

  return (
    <div className="relative w-full h-44 md:h-52 rounded overflow-hidden border border-brand-divider bg-gradient-to-b from-[#1f6b4a] to-[#155038]">
      {/* Minute badge */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-[11px] font-bold px-2 py-0.5 rounded z-10">
        {match.currentMinute || 'LIVE'}
      </div>

      {/* Pitch markings */}
      <svg viewBox="0 0 400 220" className="absolute inset-0 w-full h-full opacity-40" preserveAspectRatio="none">
        <rect x="4" y="4" width="392" height="212" fill="none" stroke="#fff" strokeWidth="2" />
        <line x1="200" y1="4" x2="200" y2="216" stroke="#fff" strokeWidth="2" />
        <circle cx="200" cy="110" r="30" fill="none" stroke="#fff" strokeWidth="2" />
        <rect x="4" y="60" width="40" height="100" fill="none" stroke="#fff" strokeWidth="2" />
        <rect x="356" y="60" width="40" height="100" fill="none" stroke="#fff" strokeWidth="2" />
      </svg>

      {/* Possession dot, animated drifting toward the attacking side */}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-brand-yellow shadow-lg transition-all duration-1000 ease-in-out animate-pulse"
        style={{ left: possessionHome ? '65%' : '30%' }}
      />

      {/* Team + attack label, bottom-left like the reference */}
      <div className="absolute bottom-2 left-3 text-white z-10">
        <div className="text-xs font-bold leading-tight">{possessingTeam}</div>
        <div className="text-[11px] text-brand-yellow font-semibold leading-tight">Sulm</div>
      </div>

      {/* Scoreline top-left/right */}
      <div className="absolute top-2 left-3 text-white text-xs font-bold">{match.homeTeam}</div>
      <div className="absolute top-2 right-3 text-white text-xs font-bold">{match.awayTeam}</div>
      <div className="absolute top-8 left-1/2 -translate-x-1/2 text-white font-mono font-bold text-xl">
        {match.liveHomeScore ?? 0} - {match.liveAwayScore ?? 0}
      </div>
    </div>
  );
};

export default LivePitch;
