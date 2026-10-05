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

type Action = NonNullable<Match['liveAction']>;

// Everything the pitch draws for one action. The home team attacks to the
// RIGHT, the away team to the LEFT (same as the provider's pitch). All
// numbers are percentages of the pitch.
interface Scene {
  ball: { x: number; y: number } | null;
  zone: { side: 'left' | 'right'; depth: number; tone: 'attack' | 'danger' | 'calm' } | null;
  corner: { x: number } | null;      // x of the corner wedge (0 or 100)
  offsideX: number | null;           // x of the offside line
  label: { x: number; align: 'left' | 'right' | 'center' };
  pulse: boolean;
}

function sceneFor(action: Action): Scene {
  const home = action.side === 'home';
  const none = action.side == null;
  switch (action.kind) {
    case 'dangerous_attack':
      return { ball: none ? null : { x: home ? 87 : 13, y: 60 }, zone: none ? null : { side: home ? 'right' : 'left', depth: 28, tone: 'danger' }, corner: null, offsideX: null, label: none ? { x: 50, align: 'center' } : { x: home ? 72 : 28, align: home ? 'right' : 'left' }, pulse: true };
    case 'attack':
      return { ball: none ? null : { x: home ? 72 : 28, y: 62 }, zone: none ? null : { side: home ? 'right' : 'left', depth: 50, tone: 'attack' }, corner: null, offsideX: null, label: none ? { x: 50, align: 'center' } : { x: 50, align: home ? 'right' : 'left' }, pulse: false };
    case 'possession':
      return { ball: none ? null : { x: home ? 36 : 64, y: 66 }, zone: none ? null : { side: home ? 'left' : 'right', depth: 45, tone: 'calm' }, corner: null, offsideX: null, label: none ? { x: 50, align: 'center' } : { x: home ? 47 : 53, align: home ? 'left' : 'right' }, pulse: false };
    case 'corner':
      return { ball: none ? null : { x: home ? 97 : 3, y: 93 }, zone: null, corner: none ? null : { x: home ? 100 : 0 }, offsideX: null, label: none ? { x: 50, align: 'center' } : { x: home ? 72 : 28, align: home ? 'right' : 'left' }, pulse: true };
    case 'offside':
      return { ball: none ? null : { x: home ? 70 : 30, y: 68 }, zone: null, corner: null, offsideX: none ? null : (home ? 78 : 22), label: none ? { x: 50, align: 'center' } : { x: home ? 76 : 24, align: home ? 'right' : 'left' }, pulse: false };
    case 'back_line_restart':
      return { ball: none ? null : { x: home ? 8 : 92, y: 62 }, zone: none ? null : { side: home ? 'left' : 'right', depth: 18, tone: 'calm' }, corner: null, offsideX: null, label: none ? { x: 50, align: 'center' } : { x: home ? 22 : 78, align: home ? 'left' : 'right' }, pulse: false };
    case 'throw_in':
      return { ball: none ? null : { x: home ? 62 : 38, y: 94 }, zone: null, corner: null, offsideX: null, label: none ? { x: 50, align: 'center' } : { x: home ? 62 : 38, align: home ? 'right' : 'left' }, pulse: false };
    case 'shot_on_target':
      return { ball: none ? null : { x: home ? 93 : 7, y: 50 }, zone: none ? null : { side: home ? 'right' : 'left', depth: 22, tone: 'danger' }, corner: null, offsideX: null, label: none ? { x: 50, align: 'center' } : { x: home ? 72 : 28, align: home ? 'right' : 'left' }, pulse: true };
    case 'substitution':
    case 'half_time': // no ball, no team: just the centred "Pushim" label
      return { ball: null, zone: null, corner: null, offsideX: null, label: { x: 50, align: 'center' }, pulse: false };
    default:
      return { ball: null, zone: null, corner: null, offsideX: null, label: { x: 50, align: 'center' }, pulse: false };
  }
}

const ZONE_BG: Record<'attack' | 'danger' | 'calm', (toRight: boolean) => string> = {
  attack: (r) => `linear-gradient(to ${r ? 'right' : 'left'}, rgba(0,0,0,0.04), rgba(0,0,0,0.26))`,
  danger: (r) => `linear-gradient(to ${r ? 'right' : 'left'}, rgba(205,60,30,0.10), rgba(205,60,30,0.46))`,
  calm: (r) => `linear-gradient(to ${r ? 'right' : 'left'}, rgba(0,0,0,0.02), rgba(0,0,0,0.14))`,
};

const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

// Live pitch. Everything drawn here comes from a decoded provider action or
// real stats; with no known action the pitch just shows the clock and the
// possession bar -- nothing is invented.
const LivePitch: React.FC<LivePitchProps> = ({ match, stats, flash }) => {
  const isLive = match.status === MatchStatus.LIVE;
  const liveClock = useTickingClock(
    isLive ? String(stats?.minute ?? match.currentMinute ?? '') : undefined,
    stats?.minuteUpdatedAt ?? match.currentMinuteUpdatedAt,
    isLive && !isHalftime(match)
  );
  if (!isLive) return null;

  const halftime = isHalftime(match);
  const action = !halftime && match.liveAction ? match.liveAction : null;
  const scene = action ? sceneFor(action) : null;
  const clockLabel = formatLiveClock(liveClock);
  const half = liveClock?.half ?? null;
  const hasPoss = stats?.possession_home != null;
  const possHome = stats?.possession_home ?? 50;
  const possAway = stats?.possession_away ?? (100 - possHome);
  const teamName = action && action.side ? (action.side === 'home' ? match.homeTeam : match.awayTeam) : null;

  const zone = scene?.zone ?? null;
  const toRight = zone?.side === 'right';
  const labelTransform = scene?.label.align === 'right' ? 'translate(calc(-100% - 10px), -50%)'
    : scene?.label.align === 'left' ? 'translate(10px, -50%)' : 'translate(-50%, -50%)';

  return (
    <div className="relative w-full aspect-[2/1] max-h-64 rounded overflow-hidden border border-brand-divider select-none" style={{ background: '#2e8b4d' }}>
      {/* mowing stripes */}
      <div className="absolute inset-0" style={{ background: 'repeating-linear-gradient(90deg, rgba(0,0,0,0) 0 8.33%, rgba(0,0,0,0.07) 8.33% 16.66%)' }} />

      {/* attack zone: slides/widens smoothly, soft curved inner edge */}
      <div
        className="absolute top-0 bottom-0"
        style={{
          [toRight ? 'right' : 'left']: 0,
          width: zone ? `${zone.depth}%` : '0%',
          opacity: zone ? 1 : 0,
          background: zone ? ZONE_BG[zone.tone](toRight) : 'transparent',
          borderRadius: toRight ? '55% 0 0 55% / 50% 0 0 50%' : '0 55% 55% 0 / 0 50% 50% 0',
          transition: `width 900ms ${EASE}, opacity 500ms ease`,
        }}
      />

      {/* pitch lines */}
      <svg viewBox="0 0 200 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
        <g fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="0.7" vectorEffect="non-scaling-stroke">
          <rect x="1" y="1" width="198" height="98" />
          <line x1="100" y1="1" x2="100" y2="99" />
          <ellipse cx="100" cy="50" rx="13" ry="22" />
          <rect x="1" y="22" width="26" height="56" />
          <rect x="173" y="22" width="26" height="56" />
          <rect x="1" y="36" width="9" height="28" />
          <rect x="190" y="36" width="9" height="28" />
        </g>
      </svg>

      {/* corner wedge, like the provider's corner view */}
      {scene?.corner && (
        <div
          className="absolute bottom-0 w-[26%] h-[48%]"
          style={{
            [scene.corner.x === 100 ? 'right' : 'left']: 0,
            background: 'rgba(0,0,0,0.20)',
            clipPath: scene.corner.x === 100 ? 'polygon(100% 100%, 0% 100%, 100% 0%)' : 'polygon(0% 100%, 100% 100%, 0% 0%)',
            animation: 'pitch-fade-in 0.5s ease both',
          }}
        />
      )}

      {/* offside line */}
      {scene?.offsideX != null && (
        <div className="absolute top-0 bottom-0" style={{ left: `${scene.offsideX}%`, width: 0, borderLeft: '2px dashed rgba(255,255,255,0.85)', animation: 'pitch-fade-in 0.4s ease both' }}>
          <div className="absolute -top-0.5 left-0.5"><OffsideFlagIcon className="w-3 h-4" /></div>
        </div>
      )}

      {/* ball: glides between positions */}
      <div
        className="absolute z-10"
        style={{
          left: `${scene?.ball?.x ?? 50}%`,
          top: `${scene?.ball?.y ?? 50}%`,
          width: 0, height: 0,
          opacity: scene?.ball ? 1 : 0,
          transition: `left 1100ms ${EASE}, top 1100ms ${EASE}, opacity 400ms ease`,
        }}
      >
        {scene?.pulse && (
          <span className="absolute -left-3 -top-3 w-6 h-6 rounded-full border-2 border-white/80" style={{ animation: 'pitch-ping 1.4s ease-out infinite' }} />
        )}
        <span className="absolute -left-[7px] -top-[7px] block drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
          <BallIcon className="w-3.5 h-3.5" />
        </span>
        {action?.kind === 'corner' && scene?.ball && (
          <span className="absolute" style={{ left: scene.ball.x > 50 ? -16 : 4, top: -24 }}><CornerFlagIcon className="w-3 h-5" /></span>
        )}
      </div>

      {/* team + action, with the provider-style blinking caret */}
      {action && scene && (
        <div
          className="absolute z-10 pointer-events-none"
          style={{
            left: `${scene.label.x}%`, top: '38%', transform: labelTransform,
            transition: `left 900ms ${EASE}`,
            textAlign: scene.label.align === 'right' ? 'right' : scene.label.align === 'left' ? 'left' : 'center',
          }}
        >
          <div key={`${action.side}-${action.kind}`} className="flex items-stretch gap-1.5" style={{ animation: 'pitch-text-in 0.35s ease-out both', flexDirection: scene.label.align === 'right' ? 'row' : 'row-reverse', justifyContent: scene.label.align === 'center' ? 'center' : undefined }}>
            <div className="leading-tight whitespace-nowrap" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.55)' }}>
              {teamName && <div className="text-[11px] md:text-sm font-semibold" style={{ color: '#bff2a8' }}>{teamName}</div>}
              <div className="text-sm md:text-xl font-bold text-white">{action.label}</div>
            </div>
            <span className="w-0.5 bg-white self-stretch" style={{ animation: 'pitch-caret 1s steps(1) infinite' }} />
          </div>
        </div>
      )}

      {/* clock */}
      <div className={`absolute top-2 left-1/2 -translate-x-1/2 text-[11px] md:text-xs font-bold px-2.5 py-0.5 rounded z-20 ${halftime ? 'bg-brand-yellow text-black' : 'bg-black/55 text-white'}`}>
        {halftime ? 'Pushim' : (clockLabel ?? formatLiveStatus(match))}
        {half && !halftime && <span className="text-brand-yellow font-semibold"> · {half}</span>}
      </div>

      {/* card just shown */}
      {flash && (
        <div
          className="absolute left-1/2 top-9 z-20 flex items-center gap-2 bg-black/70 rounded-full pl-2 pr-3.5 py-1"
          style={{ animation: 'pitch-card-in 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.2) both' }}
        >
          <CardIcon color={flash.kind === 'RED_CARD' ? 'red' : 'yellow'} className="w-3.5 h-5" />
          <span className="text-white text-xs font-bold leading-none">
            {flash.kind === 'RED_CARD' ? 'Karton i kuq' : 'Karton i verdhë'}
            <span className="text-brand-yellow font-semibold"> · {flash.team === 'home' ? match.homeTeam : match.awayTeam}</span>
          </span>
        </div>
      )}

      {/* possession (real numbers only) */}
      {hasPoss && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 text-[10px] md:text-xs text-white font-semibold bg-black/35 rounded-full px-2.5 py-0.5">
          <span>{possHome}%</span>
          <div className="w-16 md:w-24 h-1.5 rounded-full bg-black/40 overflow-hidden">
            <div className="h-full bg-brand-yellow" style={{ width: `${possHome}%`, transition: 'width 800ms ease' }} />
          </div>
          <span>{possAway}%</span>
        </div>
      )}
    </div>
  );
};

export default LivePitch;
