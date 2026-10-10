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
      return { ball: none ? null : { x: home ? 78 : 22, y: 93 }, zone: null, corner: null, offsideX: null, label: none ? { x: 50, align: 'center' } : { x: home ? 78 : 22, align: home ? 'right' : 'left' }, pulse: false };
    case 'shot_on_target':
      return { ball: none ? null : { x: home ? 93 : 7, y: 50 }, zone: none ? null : { side: home ? 'right' : 'left', depth: 22, tone: 'danger' }, corner: null, offsideX: null, label: none ? { x: 50, align: 'center' } : { x: home ? 72 : 28, align: home ? 'right' : 'left' }, pulse: true };
    case 'substitution':
    case 'half_time': // no ball, no team: just the centred label
      return { ball: null, zone: null, corner: null, offsideX: null, label: { x: 50, align: 'center' }, pulse: false };
    default:
      return { ball: null, zone: null, corner: null, offsideX: null, label: { x: 50, align: 'center' }, pulse: false };
  }
}

// Light on the grass: a soft white glow for attacks, a hot red one for real
// chances, a faint shade for quiet play. Always strongest at the goal it points to.
const ZONE_BG: Record<'attack' | 'danger' | 'calm', (toRight: boolean) => string> = {
  attack: (r) => `linear-gradient(to ${r ? 'right' : 'left'}, rgba(255,255,255,0), rgba(255,255,255,0.17))`,
  danger: (r) => `linear-gradient(to ${r ? 'right' : 'left'}, rgba(255,240,205,0), rgba(255,240,205,0.30))`,
  calm: (r) => `linear-gradient(to ${r ? 'right' : 'left'}, rgba(0,0,0,0), rgba(0,0,0,0.15))`,
};

// Chevrons that run toward the goal being attacked.
const chevrons = (color: string) =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='34' height='34' viewBox='0 0 34 34'%3E%3Cpath d='M11 8l9 9-9 9' fill='none' stroke='${color}' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;
const CHEVRONS_WHITE = chevrons('white');
const CHEVRONS_HOT = chevrons('%23ff5a3c');

const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const YELLOW = '#ffdf1b';
const HOT = '#ff5a3c';

// Turf: floodlit centre, darker towards the touchlines.
const TURF = 'radial-gradient(120% 95% at 50% 38%, #3fae66 0%, #2c8f50 52%, #1d6a3a 100%)';
const STRIPES = 'repeating-linear-gradient(90deg, rgba(255,255,255,0.045) 0 8.333%, rgba(0,0,0,0.055) 8.333% 16.666%)';
const VIGNETTE = 'radial-gradient(130% 120% at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.38) 100%)';

// A real 105 x 68 m pitch drawn in a 110 x 73 box (2.5 units of run-off all
// round, goals sit in the run-off), so circles are circles at any width.
const LINE = 'rgba(255,255,255,0.78)';

const PitchLines: React.FC = () => (
  <svg viewBox="0 0 110 73" className="absolute inset-0 w-full h-full" aria-hidden="true">
    <g fill="none" stroke={LINE} strokeWidth="0.38" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="105" height="68" />
      <line x1="55" y1="2.5" x2="55" y2="70.5" />
      <circle cx="55" cy="36.5" r="9.15" />
      {/* penalty areas, six-yard boxes, penalty arcs */}
      <rect x="2.5" y="16.34" width="16.5" height="40.32" />
      <rect x="91" y="16.34" width="16.5" height="40.32" />
      <rect x="2.5" y="27.34" width="5.5" height="18.32" />
      <rect x="102" y="27.34" width="5.5" height="18.32" />
      <path d="M19 29.19 A9.15 9.15 0 0 1 19 43.81" />
      <path d="M91 29.19 A9.15 9.15 0 0 0 91 43.81" />
      {/* corner arcs */}
      <path d="M3.5 2.5 A1 1 0 0 1 2.5 3.5" />
      <path d="M106.5 2.5 A1 1 0 0 0 107.5 3.5" />
      <path d="M3.5 70.5 A1 1 0 0 0 2.5 69.5" />
      <path d="M106.5 70.5 A1 1 0 0 1 107.5 69.5" />
    </g>
    <g fill={LINE}>
      <circle cx="55" cy="36.5" r="0.55" />
      <circle cx="13.5" cy="36.5" r="0.5" />
      <circle cx="96.5" cy="36.5" r="0.5" />
    </g>
    {/* goals in the run-off */}
    <g fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.7)" strokeWidth="0.3">
      <rect x="0.4" y="32.84" width="2.1" height="7.32" />
      <rect x="107.5" y="32.84" width="2.1" height="7.32" />
    </g>
  </svg>
);

// Live pitch. Everything drawn here comes from a decoded provider action or
// real stats; with no known action the pitch just shows the clock and the
// possession bar -- nothing is invented.
const LivePitch: React.FC<LivePitchProps> = ({ match, stats, flash }) => {
  const isLive = match.status === MatchStatus.LIVE;
  const liveClock = useTickingClock(
    isLive ? String(stats?.minute ?? match.currentMinute ?? '') : undefined,
    stats?.minuteUpdatedAt ?? match.currentMinuteUpdatedAt,
    isLive && !isHalftime(match),
    stats?.minute == null && !!match.currentMinuteEstimated
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
  const hot = action?.kind === 'dangerous_attack' || action?.kind === 'shot_on_target';
  const accent = hot ? HOT : YELLOW;
  const labelTransform = scene?.label.align === 'right' ? 'translate(calc(-100% - 10px), -50%)'
    : scene?.label.align === 'left' ? 'translate(10px, -50%)' : 'translate(-50%, -50%)';
  const chevrons = zone && zone.tone !== 'calm';
  const homeGoals = match.liveHomeScore ?? 0;
  const awayGoals = match.liveAwayScore ?? 0;

  return (
    <div
      className="relative w-full mx-auto max-w-[640px] aspect-[110/73] rounded-xl overflow-hidden select-none ring-1 ring-black/50 shadow-[0_14px_34px_-14px_rgba(0,0,0,0.85)]"
      style={{ background: TURF }}
      role="img"
      aria-label={halftime ? 'Pushim' : action ? `${teamName ? teamName + ': ' : ''}${action.label}` : 'Ndeshja live'}
    >
      {/* mowing stripes + floodlight falloff */}
      <div className="absolute inset-0" style={{ background: STRIPES }} />

      {/* attack zone: slides/widens smoothly, soft curved inner edge, chevrons run toward the goal */}
      <div
        className="absolute top-0 bottom-0 overflow-hidden"
        style={{
          [toRight ? 'right' : 'left']: 0,
          width: zone ? `${zone.depth}%` : '0%',
          opacity: zone ? 1 : 0,
          background: zone ? ZONE_BG[zone.tone](toRight) : 'transparent',
          borderRadius: toRight ? '55% 0 0 55% / 50% 0 0 50%' : '0 55% 55% 0 / 0 50% 50% 0',
          transition: `width 900ms ${EASE}, opacity 500ms ease`,
          boxShadow: zone?.tone === 'danger' ? `inset ${toRight ? '-' : ''}26px 0 30px -14px rgba(255,70,40,0.5)` : undefined,
          animation: zone?.tone === 'danger' ? 'pitch-heat 1.5s ease-in-out infinite' : undefined,
        }}
      >
        {chevrons && (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: zone.tone === 'danger' ? CHEVRONS_HOT : CHEVRONS_WHITE,
              backgroundSize: '34px 34px',
              opacity: zone.tone === 'danger' ? 0.85 : 0.4,
              transform: toRight ? 'none' : 'scaleX(-1)',
              WebkitMaskImage: 'linear-gradient(to right, transparent, #000 80%)',
              maskImage: 'linear-gradient(to right, transparent, #000 80%)',
              animation: 'pitch-chevrons 1.3s linear infinite',
            }}
          />
        )}
      </div>

      <PitchLines />

      {/* corner wedge, like the provider's corner view */}
      {scene?.corner && (
        <div
          className="absolute bottom-0 w-[26%] h-[48%]"
          style={{
            [scene.corner.x === 100 ? 'right' : 'left']: 0,
            background: 'linear-gradient(to top, rgba(0,0,0,0.30), rgba(0,0,0,0.04))',
            clipPath: scene.corner.x === 100 ? 'polygon(100% 100%, 0% 100%, 100% 0%)' : 'polygon(0% 100%, 100% 100%, 0% 0%)',
            animation: 'pitch-fade-in 0.5s ease both',
          }}
        />
      )}

      {/* offside line */}
      {scene?.offsideX != null && (
        <div className="absolute top-0 bottom-0" style={{ left: `${scene.offsideX}%`, width: 0, borderLeft: '2px dashed rgba(255,255,255,0.9)', filter: 'drop-shadow(0 0 3px rgba(255,255,255,0.6))', animation: 'pitch-fade-in 0.4s ease both' }}>
          <div className="absolute top-1 left-1"><OffsideFlagIcon className="w-3 h-4 md:w-4 md:h-5" /></div>
        </div>
      )}

      {/* ball: glides between positions, with its shadow on the grass */}
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
          <span className="absolute -left-4 -top-4 w-8 h-8 rounded-full border-2" style={{ borderColor: hot ? 'rgba(255,120,90,0.9)' : 'rgba(255,255,255,0.85)', animation: 'pitch-ping 1.4s ease-out infinite' }} />
        )}
        <span className="absolute -left-2.5 top-1 w-5 h-1.5 rounded-full bg-black/40 blur-[2px]" />
        <span className="absolute -left-2 -top-2 block w-4 h-4 md:w-[18px] md:h-[18px] -translate-x-[1px] -translate-y-[1px] drop-shadow-[0_2px_3px_rgba(0,0,0,0.55)]">
          <BallIcon className="w-full h-full" />
        </span>
        {action?.kind === 'corner' && scene?.ball && (
          <span className="absolute" style={{ left: scene.ball.x > 50 ? -20 : 6, top: -28 }}><CornerFlagIcon className="w-3 h-5 md:w-4 md:h-6" /></span>
        )}
      </div>

      {/* broadcast-style lower third: team + action */}
      {action && scene && (
        <div
          className="absolute z-10 pointer-events-none max-w-[46%]"
          aria-live="polite"
          style={{
            left: `${scene.label.x}%`, top: '38%', transform: labelTransform,
            transition: `left 900ms ${EASE}`,
          }}
        >
          <div
            key={`${action.side}-${action.kind}`}
            className="rounded-md bg-black/55 backdrop-blur-sm pl-2.5 pr-3 py-1 md:py-1.5 shadow-lg"
            style={{ borderLeft: `3px solid ${accent}`, animation: 'pitch-text-in 0.35s ease-out both' }}
          >
            {teamName && <div className="text-[10px] md:text-xs font-semibold leading-tight text-white/75 truncate">{teamName}</div>}
            <div className="text-sm md:text-xl font-extrabold leading-tight text-white tracking-tight whitespace-nowrap">{action.label}</div>
          </div>
        </div>
      )}

      {/* the two teams, with the way each one attacks (home to the right) */}
      <div className="absolute top-2 left-2 z-20 max-w-[30%] flex items-center gap-1 rounded-full bg-black/45 backdrop-blur-sm pl-2 pr-1.5 py-0.5 text-[10px] md:text-xs font-semibold text-white/90">
        <span className="truncate">{match.homeTeam}</span>
        <span aria-hidden="true" style={{ color: YELLOW }}>▸</span>
      </div>
      <div className="absolute top-2 right-2 z-20 max-w-[30%] flex items-center gap-1 rounded-full bg-black/45 backdrop-blur-sm pr-2 pl-1.5 py-0.5 text-[10px] md:text-xs font-semibold text-white/90">
        <span aria-hidden="true" style={{ color: YELLOW }}>◂</span>
        <span className="truncate">{match.awayTeam}</span>
      </div>

      {/* clock */}
      <div
        className={`absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full px-3 py-0.5 text-[11px] md:text-sm font-bold tabular-nums shadow-md ${halftime ? 'bg-brand-yellow text-black' : 'bg-black/65 backdrop-blur-sm text-white'}`}
      >
        {!halftime && <span className="w-1.5 h-1.5 rounded-full bg-brand-accent animate-pulse" />}
        <span>{halftime ? 'Pushim' : (clockLabel ?? formatLiveStatus(match))}</span>
        {half && !halftime && <span className="text-brand-yellow font-semibold text-[10px] md:text-xs">{half}</span>}
      </div>

      {/* half time: the pitch rests, the score stays */}
      {halftime && (
        <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ background: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0.5), rgba(0,0,0,0.62))', animation: 'pitch-fade-in 0.5s ease both' }}>
          <div className="text-center">
            <div className="text-2xl md:text-5xl font-black tracking-tight text-white">Pushim</div>
            <div className="mt-1 text-xs md:text-sm font-semibold text-white/75">Fundi i pjesës së parë</div>
            <div className="mt-2 inline-flex items-center gap-3 rounded-full bg-black/45 px-4 py-1 text-lg md:text-2xl font-black tabular-nums text-brand-yellow">
              <span>{homeGoals}</span><span className="text-white/50">-</span><span>{awayGoals}</span>
            </div>
          </div>
        </div>
      )}

      {/* card just shown */}
      {flash && (
        <div
          className="absolute left-1/2 top-10 md:top-12 z-30 flex items-center gap-2 bg-black/80 backdrop-blur-sm rounded-full pl-2.5 pr-4 py-1.5 shadow-xl"
          style={{ animation: 'pitch-card-in 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.2) both', border: `1px solid ${flash.kind === 'RED_CARD' ? 'rgba(255,70,70,0.6)' : 'rgba(255,223,27,0.6)'}` }}
        >
          <CardIcon color={flash.kind === 'RED_CARD' ? 'red' : 'yellow'} className="w-4 h-6" />
          <span className="text-white text-xs md:text-sm font-bold leading-none">
            {flash.kind === 'RED_CARD' ? 'Karton i kuq' : 'Karton i verdhë'}
            <span className="text-brand-yellow font-semibold"> · {flash.team === 'home' ? match.homeTeam : match.awayTeam}</span>
          </span>
        </div>
      )}

      {/* possession (real numbers only) */}
      {hasPoss && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full bg-black/50 backdrop-blur-sm px-3 py-1 text-[10px] md:text-xs font-bold tabular-nums text-white">
          <span style={{ color: YELLOW }}>{possHome}%</span>
          <div className="w-20 md:w-32 h-1.5 rounded-full bg-white/70 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${possHome}%`, background: YELLOW, transition: 'width 800ms ease' }} />
          </div>
          <span>{possAway}%</span>
        </div>
      )}

      {/* light on the turf */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: VIGNETTE }} />
    </div>
  );
};

export default LivePitch;
