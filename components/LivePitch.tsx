import React from 'react';
import { Match, MatchStatus } from '../types';
import type { LiveStatistics } from '../services/api';
import { formatLiveStatus, isHalftime } from '../utils/liveStatus';

interface LivePitchProps {
  match: Match;
  stats: LiveStatistics | null;
}

// Animated pitch view for live matches. Possession dot position is driven
// by real possession_home/possession_away from the stats feed when
// available (Sportmonks), falling back to a 50/50 center position if the
// provider hasn't returned possession data yet.
const LivePitch: React.FC<LivePitchProps> = ({ match, stats }) => {
  const isLive = match.status === MatchStatus.LIVE;
  if (!isLive) return null;

  const possHome = stats?.possession_home ?? 50;
  const possAway = stats?.possession_away ?? (100 - possHome);
  // Map possession % to a left-position between 25% (away dominant) and 75% (home dominant)
  const dotLeftPct = 25 + (possHome / 100) * 50;
  const attackingSide = possHome >= possAway ? match.homeTeam : match.awayTeam;

  return (
    <div className="relative w-full h-44 md:h-52 rounded overflow-hidden border border-brand-divider bg-gradient-to-b from-[#1f6b4a] to-[#155038]">
      <div className={`absolute top-2 left-1/2 -translate-x-1/2 text-white text-[11px] font-bold px-2 py-0.5 rounded z-10 ${isHalftime(match) ? 'bg-brand-yellow text-black' : 'bg-black/50'}`}>
        {stats?.minute != null && !isHalftime(match) ? `${stats.minute}'` : formatLiveStatus(match)}
      </div>

      <svg viewBox="0 0 400 220" className="absolute inset-0 w-full h-full opacity-40" preserveAspectRatio="none">
        <rect x="4" y="4" width="392" height="212" fill="none" stroke="#fff" strokeWidth="2" />
        <line x1="200" y1="4" x2="200" y2="216" stroke="#fff" strokeWidth="2" />
        <circle cx="200" cy="110" r="30" fill="none" stroke="#fff" strokeWidth="2" />
        <rect x="4" y="60" width="40" height="100" fill="none" stroke="#fff" strokeWidth="2" />
        <rect x="356" y="60" width="40" height="100" fill="none" stroke="#fff" strokeWidth="2" />
      </svg>

      {/* Possession dot — animates smoothly toward whichever side has the ball, driven by real stats */}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-brand-yellow shadow-lg transition-all duration-1000 ease-in-out animate-pulse"
        style={{ left: `${dotLeftPct}%` }}
      />

      <div className="absolute bottom-2 left-3 text-white z-10">
        <div className="text-xs font-bold leading-tight">{attackingSide}</div>
        <div className="text-[11px] text-brand-yellow font-semibold leading-tight">Sulm</div>
      </div>

      <div className="absolute top-2 left-3 text-white text-xs font-bold">{match.homeTeam}</div>
      <div className="absolute top-2 right-3 text-white text-xs font-bold">{match.awayTeam}</div>
      <div className="absolute top-8 left-1/2 -translate-x-1/2 text-white font-mono font-bold text-xl">
        {match.liveHomeScore ?? 0} - {match.liveAwayScore ?? 0}
      </div>

      {/* Live possession bar, when the feed has real numbers */}
      {stats?.possession_home != null && (
        <div className="absolute bottom-2 right-3 flex items-center gap-1 text-[10px] text-white font-semibold">
          <span>{possHome}%</span>
          <div className="w-16 h-1.5 rounded-full bg-black/40 overflow-hidden">
            <div className="h-full bg-brand-yellow" style={{ width: `${possHome}%` }} />
          </div>
          <span>{possAway}%</span>
        </div>
      )}
    </div>
  );
};

export default LivePitch;
