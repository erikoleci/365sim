import React from 'react';
import { Match, MatchStatus } from '../types';
import type { LiveStatistics } from '../services/api';
import { formatLiveStatus, isHalftime } from '../utils/liveStatus';
import { useTickingClock, formatLiveClock } from './MatchCard';
import { BallIcon, CornerFlagIcon, CardIcon, OffsideFlagIcon } from './PitchIcons';

interface LivePitchProps {
  match: Match;
  stats: LiveStatistics | null;
  // A card that has just been shown by the referee (from the live CARD
  // message); the parent clears it after a few seconds.
  flash?: { kind: 'YELLOW_CARD' | 'RED_CARD'; team: 'home' | 'away' } | null;
}

// Where the ball / attack zone sits for each decoded provider action. Home
// attacks to the right, away to the left (as on the provider's pitch). x/y
// are percentages of the pitch.
function actionSpot(action: NonNullable<Match['liveAction']>) {
  const home = action.side === 'home';
  switch (action.kind) {
    case 'dangerous_attack': return { x: home ? 84 : 16, y: 45, zone: 0.32 };
    case 'attack': return { x: home ? 66 : 34, y: 50, zone: 0.2 };
    case 'possession': return { x: home ? 42 : 58, y: 55, zone: 0.1 };
    case 'corner': return { x: home ? 95 : 5, y: 12, zone: 0.28 };
    case 'offside': return { x: home ? 78 : 22, y: 50, zone: 0.14 };
    case 'back_line_restart': return { x: home ? 9 : 91, y: 50, zone: 0.08 };
    default: return null;
  }
}

// Animated pitch view for live matches. Possession dot position is driven
// by real possession_home/possession_away when the live-detail feed
// provides them — nothing is shown (no dot, no "Sulm" label) when it
// doesn't, rather than defaulting to a fake 50/50 split.
const LivePitch: React.FC<LivePitchProps> = ({ match, stats, flash }) => {
  const isLive = match.status === MatchStatus.LIVE;
  // Real in-play minute:second + game half, ticking live client-side just
  // like the match list cards — same source (stats.minute, falling back to
  // match.currentMinute) and same hook, so the pitch header never shows a
  // less precise/stale clock than the card the user just tapped. Hook must
  // run unconditionally (before the early return below) per rules-of-hooks.
  const liveClock = useTickingClock(
    isLive ? String(stats?.minute ?? match.currentMinute ?? '') : undefined,
    // stats.minuteUpdatedAt (from GET /matches/:id/live-detail) is the more
    // authoritative reference when we're actually rendering stats.minute;
    // fall back to the match-list-shaped currentMinuteUpdatedAt otherwise.
    stats?.minuteUpdatedAt ?? match.currentMinuteUpdatedAt,
    isLive && !isHalftime(match)
  );
  if (!isLive) return null;

  const possHome = stats?.possession_home ?? 50;
  const possAway = stats?.possession_away ?? (100 - possHome);
  // Map possession % to a left-position between 25% (away dominant) and 75% (home dominant)
  const dotLeftPct = 25 + (possHome / 100) * 50;
  const attackingSide = possHome >= possAway ? match.homeTeam : match.awayTeam;
  const clockLabel = formatLiveClock(liveClock);
  const half = liveClock?.half ?? null;
  const spot = match.liveAction ? actionSpot(match.liveAction) : null;
  const attackRight = match.liveAction?.side === 'home';

  return (
    <div className="relative w-full h-44 md:h-52 rounded overflow-hidden border border-brand-divider bg-gradient-to-b from-[#1f6b4a] to-[#155038]">
      <div className={`absolute top-2 left-1/2 -translate-x-1/2 text-[11px] font-bold px-2 py-0.5 rounded z-10 ${isHalftime(match) ? 'bg-brand-yellow text-black' : 'bg-black/50 text-white'}`}>
        {isHalftime(match) ? 'Pushim' : (clockLabel ?? formatLiveStatus(match))}
        {half && !isHalftime(match) && <span className="text-brand-yellow font-semibold"> · {half}</span>}
      </div>

      <svg viewBox="0 0 400 220" className="absolute inset-0 w-full h-full opacity-40" preserveAspectRatio="none">
        <rect x="4" y="4" width="392" height="212" fill="none" stroke="#fff" strokeWidth="2" />
        <line x1="200" y1="4" x2="200" y2="216" stroke="#fff" strokeWidth="2" />
        <circle cx="200" cy="110" r="30" fill="none" stroke="#fff" strokeWidth="2" />
        <rect x="4" y="60" width="40" height="100" fill="none" stroke="#fff" strokeWidth="2" />
        <rect x="356" y="60" width="40" height="100" fill="none" stroke="#fff" strokeWidth="2" />
      </svg>

      {/* Attack zone (from the middle towards the goal being attacked) and the
          ball / flag icons for the action the provider is showing. Positions
          animate between ticks. Nothing here without a decoded action. */}
      {spot && (
        <>
          <div
            className="absolute top-0 bottom-0 w-1/2 transition-opacity duration-700 pointer-events-none"
            style={{
              [attackRight ? 'right' : 'left']: 0,
              background: `linear-gradient(to ${attackRight ? 'right' : 'left'}, rgba(255,255,255,0), rgba(255,255,255,${spot.zone}))`,
            }}
          />
          <div
            className="absolute z-10 flex items-end gap-0.5"
            style={{ left: `${spot.x}%`, top: `${spot.y}%`, transform: 'translate(-50%, -50%)', transition: 'left 900ms ease-in-out, top 900ms ease-in-out' }}
          >
            {match.liveAction?.kind === 'corner' && <CornerFlagIcon className="w-4 h-6" />}
            {match.liveAction?.kind === 'offside' && <OffsideFlagIcon className="w-4 h-6" />}
            <span style={{ display: 'inline-block', animation: 'pitch-bob 1s ease-in-out infinite' }}>
              <BallIcon className="w-5 h-5 drop-shadow" />
            </span>
          </div>
        </>
      )}

      {/* Card just shown (live CARD message), a few seconds */}
      {flash && (
        <div
          className="absolute left-1/2 top-1/2 z-20 flex items-center gap-2 bg-black/60 rounded px-3 py-1.5"
          style={{ animation: 'pitch-pop 0.4s ease-out both' }}
        >
          <CardIcon color={flash.kind === 'RED_CARD' ? 'red' : 'yellow'} className="w-5 h-7" />
          <div className="text-white leading-tight">
            <div className="text-xs font-bold">{flash.kind === 'RED_CARD' ? 'Karton i kuq' : 'Karton i verdhë'}</div>
            <div className="text-[11px] text-brand-yellow">{flash.team === 'home' ? match.homeTeam : match.awayTeam}</div>
          </div>
        </div>
      )}

      {/* Possession dot + attacking-side label — ONLY when the feed actually
          has real possession numbers. No fallback/default position: an
          always-on indicator defaulting to 50/50 would silently show the
          home team as "attacking" on every match with no real data behind
          it, which is exactly the fabricated-live-data problem to avoid. */}
      {stats?.possession_home != null && (
        <>
          {!spot && <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-brand-yellow shadow-lg transition-all duration-1000 ease-in-out animate-pulse"
            style={{ left: `${dotLeftPct}%` }}
          />}
          {!match.liveAction && (
            <div className="absolute bottom-2 left-3 text-white z-10">
              <div className="text-xs font-bold leading-tight">{attackingSide}</div>
              <div className="text-[11px] text-brand-yellow font-semibold leading-tight">Sulm</div>
            </div>
          )}
        </>
      )}

      {/* What the provider's own pitch shows right now (attack, dangerous
          attack, corner, offside, ...). Only rendered for codes decoded and
          confirmed server-side (server/liveAction.js); unknown code => nothing. */}
      {match.liveAction && (
        <div className="absolute bottom-2 left-3 text-white z-10">
          <div className="text-xs font-bold leading-tight">
            {match.liveAction.side === 'home' ? match.homeTeam : match.awayTeam}
          </div>
          <div className="text-[11px] text-brand-yellow font-semibold leading-tight">
            {match.liveAction.label}
          </div>
        </div>
      )}
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
