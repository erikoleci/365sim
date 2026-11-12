import React, { useId } from 'react';
import { Match, MatchStatus } from '../types';
import type { LiveStatistics } from '../services/api';
import { formatLiveStatus, isHalftime, formatScore, pickClockSource } from '../utils/liveStatus';
import { useTickingClock, formatLiveClock } from './MatchCard';
import { CardIcon } from './PitchIcons';
import { useI18n } from '../i18n';
import TeamLogo from './TeamLogo';

interface LivePitchProps {
  match: Match;
  stats: LiveStatistics | null;
  // A card that has just been shown by the referee (from the live CARD message); the parent clears it after a few seconds.
  flash?: { kind: 'YELLOW_CARD' | 'RED_CARD'; team: 'home' | 'away' } | null;
}

type Action = NonNullable<Match['liveAction']>;

// The pitch is drawn in a wide 110 x 56 box (a stylised, flatter pitch: wider than tall so the markets stay close).
// The home team attacks to the RIGHT, the away team to the LEFT. Nothing is invented: every effect comes from the
// decoded provider action; without one the pitch only shows the clock and the possession bar.
const W = 110;
const H = 56;
const YELLOW = '#ffdf1b';
const HOT = '#ff5a3c';
const LINE = 'rgba(255,255,255,0.8)';

type Fx = {
  path: string;            // ball flight, in the home (left-to-right) direction
  tone: 'attack' | 'danger' | 'calm';
  dur: number;             // seconds per loop
  zoneDepth: number;       // % of pitch width lit in front of the goal
  target?: { x: number; y: number }; // ring on the spot (free kick / penalty)
  burst?: boolean;         // goal-mouth shockwave
  curve?: boolean;
  big?: string;            // big centre banner text key
  offside?: number;        // x of the offside line
  touch?: boolean;         // throw-in: arrow on the touchline
  arrows?: boolean;        // attack: waves of chevrons running at the goal (no dashed trail)
  wall?: number;           // free kick: x of the defensive wall
  nodes?: Array<[number, number]>; // possession: the pass points
};

const FX: Record<string, Fx> = {
  attack: { path: 'M38 34 L84 28', tone: 'attack', dur: 2.4, zoneDepth: 45, arrows: true },
  dangerous_attack: { path: 'M64 38 L101 28', tone: 'danger', dur: 1.2, zoneDepth: 32, burst: true, arrows: true },
  corner: { path: 'M106 53 Q99 18 94 27', tone: 'attack', dur: 2, zoneDepth: 28, curve: true },
  free_kick: { path: 'M76 30 Q92 12 106 26', tone: 'attack', dur: 1.9, zoneDepth: 34, target: { x: 76, y: 30 }, curve: true, wall: 88 },
  penalty: { path: 'M96 28 L106 25', tone: 'danger', dur: 1.3, zoneDepth: 20, target: { x: 96, y: 28 }, burst: true, big: 'Penallti' },
  shot_on_target: { path: 'M84 34 L106 26', tone: 'danger', dur: 1.2, zoneDepth: 26, burst: true },
  big_chance: { path: 'M86 36 L106 27', tone: 'danger', dur: 1.1, zoneDepth: 28, burst: true, big: 'Shanc i madh për gol' },
  throw_in: { path: 'M80 54 Q80 42 88 39', tone: 'attack', dur: 1.8, zoneDepth: 0, touch: true },
  back_line_restart: { path: 'M9 28 Q28 8 50 24', tone: 'calm', dur: 2.2, zoneDepth: 0 },
  offside: { path: 'M62 36 L76 28', tone: 'attack', dur: 1.6, zoneDepth: 0, offside: 78 },
  possession: { path: 'M30 38 L44 24 L58 36 L70 26', tone: 'calm', dur: 3.2, zoneDepth: 0, nodes: [[30, 38], [44, 24], [58, 36], [70, 26]] },
  goal: { path: 'M92 30 L107 28', tone: 'danger', dur: 1.4, zoneDepth: 22, burst: true, big: 'Gol' },
};

const ZONE_BG = (tone: Fx['tone'], toRight: boolean) => {
  const c = tone === 'danger' ? '255,45,30' : '255,255,255';
  const a = tone === 'danger' ? 0.26 : 0.16;
  return `linear-gradient(to ${toRight ? 'right' : 'left'}, rgba(${c},0), rgba(${c},${a}))`;
};

// Turf: deep floodlit green with a soft centre glow and mowing stripes.
const TURF = 'radial-gradient(110% 130% at 50% 40%, #2fa05a 0%, #1f7d45 55%, #14572f 100%)';
const STRIPES = 'repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 8.333%, rgba(0,0,0,0.06) 8.333% 16.666%)';
const VIGNETTE = 'radial-gradient(130% 140% at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.42) 100%)';

const PitchLines: React.FC = () => {
  const uid = useId().replace(/:/g, '');
  const goals = [{ front: 2.5, back: 0.2 }, { front: 107.5, back: 109.8 }];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
      <defs>
        <pattern id={`net-${uid}`} width="0.55" height="0.55" patternUnits="userSpaceOnUse">
          <path d="M0 0L0.55 0.55M0.55 0L0 0.55" stroke="rgba(255,255,255,0.7)" strokeWidth="0.07" fill="none" />
        </pattern>
      </defs>
      <g fill="none" stroke={LINE} strokeWidth="0.34" strokeLinejoin="round">
        <rect x="2.5" y="2" width="105" height="52" rx="0.6" />
        <line x1="55" y1="2" x2="55" y2="54" />
        <ellipse cx="55" cy="28" rx="8" ry="7.6" />
        <rect x="2.5" y="12.6" width="15.5" height="30.8" />
        <rect x="92" y="12.6" width="15.5" height="30.8" />
        <rect x="2.5" y="21" width="5.4" height="14" />
        <rect x="102.1" y="21" width="5.4" height="14" />
        <path d="M18 22.6 A7.6 7.2 0 0 1 18 33.4" />
        <path d="M92 22.6 A7.6 7.2 0 0 0 92 33.4" />
      </g>
      <g fill={LINE}>
        <circle cx="55" cy="28" r="0.5" />
        <circle cx="13" cy="28" r="0.45" />
        <circle cx="97" cy="28" r="0.45" />
      </g>
      {goals.map((g, i) => (
        <g key={i}>
          <polygon points={`${g.front},24.4 ${g.back},25.2 ${g.back},30.8 ${g.front},31.6`} fill={`url(#net-${uid})`} stroke="rgba(255,255,255,0.8)" strokeWidth="0.2" />
          <line x1={g.front} y1="24.4" x2={g.front} y2="31.6" stroke="#fff" strokeWidth="0.45" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
};

// The moving picture of the action: ball flight with a glowing trail, spot rings, goal shockwave.
const ActionFx: React.FC<{ kind: string; home: boolean; fx: Fx }> = ({ kind, home, fx }) => {
  const uid = useId().replace(/:/g, '');
  const hot = fx.tone === 'danger';
  const col = hot ? HOT : '#ffffff';
  const mirror = home ? '' : `translate(${W} 0) scale(-1 1)`;
  const gx = 107.5;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full z-[5] pointer-events-none" aria-hidden="true">
      <defs>
        <filter id={`gl-${uid}`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="0.8" /></filter>
      </defs>
      <g transform={mirror}>
        {/* shockwave at the goal mouth */}
        {fx.burst && [0, 0.5, 1].map((d) => (
          <circle key={d} cx={gx} cy="28" r="3" fill="none" stroke={col} strokeWidth="0.5" style={{ transformOrigin: `${gx}px 28px`, transformBox: 'view-box' as never, animation: `fx-shock 1.5s ease-out ${d}s infinite` }} />
        ))}
        {/* spot ring (free kick / penalty) */}
        {fx.target && (
          <g style={{ transformOrigin: `${fx.target.x}px ${fx.target.y}px`, animation: 'fx-pulse 1s ease-in-out infinite' }}>
            <circle cx={fx.target.x} cy={fx.target.y} r="2.2" fill="none" stroke={YELLOW} strokeWidth="0.5" />
            <circle cx={fx.target.x} cy={fx.target.y} r="0.7" fill={YELLOW} />
          </g>
        )}
        {/* the trail: glow underneath, dashed line running along the flight */}
        {fx.arrows ? (
          // waves of chevrons run at the goal: a real "attack" look, not a ball arc
          [0, 1, 2].map((r) => [0, 1, 2].map((c) => (
            <path key={`${r}-${c}`} d={`M${30 + c * 11} ${16 + r * 12} l4 3.4 l-4 3.4`} fill="none" stroke={col} strokeWidth={hot ? 1.3 : 1} strokeLinecap="round" strokeLinejoin="round" style={{ animation: `fx-run ${hot ? 0.7 : 1.1}s ease-in ${(c * 0.16 + r * 0.07).toFixed(2)}s infinite` }} />
          )))
        ) : fx.nodes ? (
          <g>
            <polyline points={fx.nodes.map((n) => n.join(',')).join(' ')} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="0.35" />
            {fx.nodes.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.1" fill="none" stroke="#fff" strokeWidth="0.4" style={{ transformOrigin: `${x}px ${y}px`, animation: `fx-pulse 1.2s ease-in-out ${i * 0.25}s infinite` }} />)}
          </g>
        ) : (
          <>
            <path d={fx.path} fill="none" stroke={col} strokeWidth="1.8" strokeLinecap="round" opacity="0.28" filter={`url(#gl-${uid})`} />
            <path d={fx.path} fill="none" stroke={col} strokeWidth="0.7" strokeLinecap="round" strokeDasharray={fx.wall != null ? undefined : '2 1.8'} style={fx.wall != null ? undefined : { animation: 'fx-dash 0.7s linear infinite' }} />
          </>
        )}
        {fx.wall != null && [-4.5, -1.5, 1.5, 4.5].map((dy, i) => (
          <rect key={i} x={fx.wall! - 0.6} y={28 + dy - 1.2} width="1.2" height="2.4" rx="0.6" fill="#fff" opacity="0.9" style={{ animation: `fx-pulse 0.8s ease-in-out ${i * 0.1}s infinite`, transformOrigin: `${fx.wall}px ${28 + dy}px` }} />
        ))}
        {/* the ball, flying along the path */}
        <g>
          <ellipse rx="1.5" ry="0.55" fill="rgba(0,0,0,0.4)" transform="translate(0 1.9)">
            <animateMotion dur={`${fx.dur}s`} repeatCount="indefinite" path={fx.path} calcMode="spline" keyTimes="0;1" keySplines="0.35 0 0.25 1" />
          </ellipse>
          <circle r="1.55" fill="#fff" stroke="#1b1d22" strokeWidth="0.35">
            <animateMotion dur={`${fx.dur}s`} repeatCount="indefinite" path={fx.path} calcMode="spline" keyTimes="0;1" keySplines="0.35 0 0.25 1" />
          </circle>
        </g>
        {fx.offside != null && (
          <g>
            <line x1={fx.offside} y1="2" x2={fx.offside} y2="54" stroke="#fff" strokeWidth="0.5" strokeDasharray="2 1.6" style={{ animation: 'fx-dash 0.9s linear infinite' }} />
            <path d={`M${fx.offside} 3 l5 1.8 l-5 1.8z`} fill={YELLOW} />
          </g>
        )}
        {fx.touch && (
          <g style={{ animation: 'fx-pulse 0.9s ease-in-out infinite', transformOrigin: '80px 54px' }}>
            <path d="M74 54 h12" stroke={YELLOW} strokeWidth="0.9" strokeLinecap="round" />
            <circle cx="80" cy="54" r="1.6" fill="none" stroke={YELLOW} strokeWidth="0.5" />
          </g>
        )}
        {kind === 'corner' && (
          <g style={{ transformOrigin: '106.4px 52.6px', animation: 'fx-wave 0.9s ease-in-out infinite' }}>
            <line x1="106.4" y1="52.6" x2="106.4" y2="47.6" stroke="#fff" strokeWidth="0.4" />
            <path d="M106.4 47.6 l-3.4 1.4 l3.4 1.4z" fill={YELLOW} />
          </g>
        )}
        {kind === 'goal' && [0, 1, 2, 3, 4, 5].map((i) => (
          <circle key={i} cx={gx - 4} cy="28" r="0.7" fill={i % 2 ? YELLOW : '#fff'} style={{ ['--dx' as never]: `${-10 - i * 2}px`, ['--dy' as never]: `${(i - 2.5) * 7}px`, animation: `fx-spark 1.2s ease-out ${i * 0.07}s infinite` }} />
        ))}
      </g>
    </svg>
  );
};

const LivePitch: React.FC<LivePitchProps> = ({ match, stats, flash }) => {
  const { t } = useI18n();
  const isLive = match.status === MatchStatus.LIVE;
  const clockSrc = pickClockSource(match, stats);
  const liveClock = useTickingClock(isLive ? clockSrc.raw : undefined, clockSrc.stamp, isLive && !isHalftime(match), clockSrc.estimated);
  if (!isLive) return null;

  const halftime = isHalftime(match);
  const action: Action | null = !halftime && match.liveAction ? match.liveAction : null;
  const fx = action ? FX[action.kind] ?? null : null;
  const home = action?.side === 'home';
  const hasSide = action?.side === 'home' || action?.side === 'away';
  const showFx = !!(fx && hasSide);
  const clockLabel = formatLiveClock(liveClock);
  const hasPoss = stats?.possession_home != null;
  const possHome = stats?.possession_home ?? 50;
  const possAway = stats?.possession_away ?? (100 - possHome);
  const teamName = action && hasSide ? (home ? match.homeTeam : match.awayTeam) : null;
  const hot = fx?.tone === 'danger';
  const accent = hot ? HOT : YELLOW;
  const bigText = showFx && fx?.big ? t(fx.big) : null;
  const homeGoals = formatScore(match.liveHomeScore);
  const awayGoals = formatScore(match.liveAwayScore);

  return (
    <div
      className="relative w-full mx-auto max-w-[560px] aspect-[110/56] rounded-xl overflow-hidden select-none ring-1 ring-white/10 shadow-[0_12px_30px_-14px_rgba(0,0,0,0.9)]"
      style={{ background: TURF }}
      role="img"
      aria-label={halftime ? t('Pushim') : action ? `${teamName ? teamName + ': ' : ''}${t(action.label)}` : t('Ndeshja live')}
    >
      <div className="absolute inset-0" style={{ background: STRIPES }} />

      {/* light in front of the goal that is being attacked */}
      {showFx && fx && (
        <div
          key={`${action?.side}-${action?.kind}-z`}
          className="absolute top-0 bottom-0"
          style={{
            [home ? 'right' : 'left']: 0, width: `${fx.zoneDepth}%`,
            background: ZONE_BG(fx.tone, !!home),
            borderRadius: home ? '60% 0 0 60% / 50% 0 0 50%' : '0 60% 60% 0 / 0 50% 50% 0',
            animation: `${hot ? 'pitch-heat 1.1s' : 'pitch-fade-in 0.6s'} ease-in-out ${hot ? 'infinite' : 'both'}`,
          }}
        />
      )}

      <PitchLines />

      {showFx && fx && action && <ActionFx key={`${action.side}-${action.kind}`} kind={action.kind} home={!!home} fx={fx} />}

      {action && (action.kind === 'injury' || action.kind === 'substitution') && (
        <svg key={`${action.kind}-i`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full z-[5] pointer-events-none" aria-hidden="true">
          {action.kind === 'injury' ? (
            <g style={{ transformOrigin: '55px 28px', animation: 'fx-pulse 0.9s ease-in-out infinite' }}>
              <circle cx="55" cy="28" r="7" fill="rgba(0,0,0,0.35)" stroke="#fff" strokeWidth="0.5" />
              <path d="M55 23.5v9M50.5 28h9" stroke="#ff3b3b" strokeWidth="2.2" strokeLinecap="round" />
            </g>
          ) : (
            <g style={{ animation: 'fx-pulse 1.1s ease-in-out infinite', transformOrigin: '55px 28px' }}>
              <circle cx="55" cy="28" r="8" fill="rgba(0,0,0,0.35)" stroke="#fff" strokeWidth="0.5" />
              <path d="M50.5 31 l0 -8 m-2 2.4 l2 -2.4 l2 2.4" fill="none" stroke="#3ee05a" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M59.5 25 l0 8 m-2 -2.4 l2 2.4 l2 -2.4" fill="none" stroke="#ff4d4d" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )}
        </svg>
      )}

      {/* big banner: penalty / big chance / goal */}
      {bigText && (
        <div key={`${action?.side}-${action?.kind}-b`} className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="text-center" style={{ animation: 'fx-banner 0.5s cubic-bezier(0.2,0.9,0.3,1.3) both' }}>
            <div className="text-base sm:text-2xl font-black uppercase tracking-tight text-white" style={{ textShadow: `0 0 18px ${accent}, 0 2px 0 rgba(0,0,0,0.5)`, animation: hot ? 'fx-shake 0.6s ease-in-out infinite' : undefined }}>{bigText}</div>
            {teamName && <div className="mt-0.5 text-[10px] sm:text-xs font-bold text-white/85 truncate max-w-[70vw]">{teamName}</div>}
          </div>
        </div>
      )}

      {/* small action tag for the other actions */}
      {action && !bigText && action.kind !== 'possession' && (
        <div
          key={`${action.side}-${action.kind}-t`}
          className="absolute z-10 pointer-events-none left-1/2 bottom-2 -translate-x-1/2 max-w-[94%]"
          aria-live="polite"
          style={{ animation: 'pitch-text-in 0.35s ease-out both' }}
        >
          <div className="rounded-full bg-black/60 backdrop-blur-sm pl-2.5 pr-3 py-0.5 flex items-center gap-1.5 shadow-lg overflow-hidden" style={{ borderLeft: `3px solid ${accent}` }}>
            {teamName && <span className="text-[10px] sm:text-xs font-semibold text-white/75 truncate min-w-0 max-w-[45%]">{teamName}</span>}
            <span className="text-xs sm:text-sm font-extrabold text-white whitespace-nowrap shrink-0">{t(action.label)}</span>
          </div>
        </div>
      )}

      {/* the two teams, with the way each one attacks */}
      <div className="absolute top-1.5 left-1.5 z-20 max-w-[30%] flex items-center gap-1 rounded-full bg-black/45 backdrop-blur-sm pl-1.5 pr-2 py-0.5 text-[10px] md:text-xs font-semibold text-white/90">
        <TeamLogo name={match.homeTeam} league={match.league} providerLogo={match.homeTeamLogo} size="xs" />
        <span className="truncate">{match.homeTeam}</span>
        <span aria-hidden="true" style={{ color: YELLOW }}>▸</span>
      </div>
      <div className="absolute top-1.5 right-1.5 z-20 max-w-[30%] flex items-center gap-1 rounded-full bg-black/45 backdrop-blur-sm pr-1.5 pl-2 py-0.5 text-[10px] md:text-xs font-semibold text-white/90">
        <span aria-hidden="true" style={{ color: YELLOW }}>◂</span>
        <span className="truncate">{match.awayTeam}</span>
        <TeamLogo name={match.awayTeam} league={match.league} providerLogo={match.awayTeamLogo} size="xs" />
      </div>

      {/* clock */}
      <div className={`absolute top-1.5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] md:text-sm font-bold tabular-nums whitespace-nowrap shadow-md ${halftime ? 'bg-brand-yellow text-black' : 'bg-black/60 text-white'}`}>
        {!halftime && <span className="w-1.5 h-1.5 rounded-full bg-brand-accent animate-pulse" />}
        <span>{halftime ? t('Pushim') : (clockLabel ?? formatLiveStatus(match))}</span>
      </div>

      {halftime && (
        <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)', animation: 'pitch-fade-in 0.5s ease both' }}>
          <div className="text-center">
            <div className="text-2xl md:text-4xl font-black tracking-tight text-white">{t('Pushim')}</div>
            <div className="mt-1 inline-flex items-center gap-3 rounded-full bg-black/45 px-4 py-0.5 text-lg md:text-2xl font-black tabular-nums text-brand-yellow">
              <span>{homeGoals}</span><span className="text-white/50">-</span><span>{awayGoals}</span>
            </div>
          </div>
        </div>
      )}

      {flash && (
        <div className="absolute left-1/2 top-9 z-30 max-w-[92%] flex items-center gap-2 bg-black/80 backdrop-blur-sm rounded-full pl-2.5 pr-4 py-1 shadow-xl" style={{ animation: 'pitch-card-in 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.2) both', border: `1px solid ${flash.kind === 'RED_CARD' ? 'rgba(255,70,70,0.6)' : 'rgba(255,223,27,0.6)'}` }}>
          <CardIcon color={flash.kind === 'RED_CARD' ? 'red' : 'yellow'} className="w-4 h-6" />
          <span className="text-white text-xs md:text-sm font-bold leading-none">
            {flash.kind === 'RED_CARD' ? t('Karton i kuq') : t('Karton i verdhë')}
            <span className="text-brand-yellow font-semibold"> · {flash.team === 'home' ? match.homeTeam : match.awayTeam}</span>
          </span>
        </div>
      )}

      {hasPoss && (
        <div className="absolute bottom-1.5 left-1.5 z-20 flex items-center gap-2 rounded-full bg-black/50 backdrop-blur-sm px-2.5 py-0.5 text-[10px] md:text-xs font-bold tabular-nums text-white">
          <span style={{ color: YELLOW }}>{possHome}%</span>
          <div className="w-14 md:w-24 h-1.5 rounded-full bg-white/70 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${possHome}%`, background: YELLOW, transition: 'width 800ms ease' }} />
          </div>
          <span>{possAway}%</span>
        </div>
      )}

      <div className="absolute inset-0 pointer-events-none" style={{ background: VIGNETTE }} />
    </div>
  );
};

export default LivePitch;
