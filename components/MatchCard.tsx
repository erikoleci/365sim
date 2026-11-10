import React from 'react';
import { Match, MatchStatus } from '../types';
import * as api from '../services/api';
import { formatMatchTime, formatMatchDayMonth, isSameAlbaniaDay, albaniaTodayKey } from '../utils/albaniaTime';
import { isHalftime, liveMinuteFallback, isLiveClockStale, formatScore, serverToLocal } from '../utils/liveStatus';
import { useI18n } from '../i18n';
import StarButton from './StarButton';
import TeamLogo from './TeamLogo';

interface MatchRowProps {
  match: Match;
  onBetClick: (match: Match, marketId: string, selectionId: string) => void;
  onOpenDetail: (match: Match) => void;
  isAdmin: boolean;
  onSettleMatch: (match: Match, homeScore: number, awayScore: number) => void;
  isSimulating: boolean;
  selectedIds: string[];
  favoriteTeams: Set<string>;
  favoriteMatches?: Set<string>;
  onToggleFavoriteMatch?: (matchId: string) => void;
  onToggleFavoriteTeam: (team: string) => void;
}

// Real in-play clock: the provider reports minutes like "62:14" — render the
// running minute plus the game half (Pjesa I / Pushim / Pjesa II / Shtesë).
// A sane match clock, under either reading, is at most ~130 minutes (90 +
// stoppage + 30 extra time + its stoppage). The REST list/detail endpoints
// serve matches_cache.live_minute as-is (not re-normalized), so this mirrors
// server/london365.js's normalizeLiveMinute() as a defense-in-depth check:
// a bare integer still over 130 minutes once divided by 60 isn't a clock
// under either reading (e.g. a stray provider sentinel like "300924") and is
// discarded rather than shown as a nonsense "5015:24".
const MAX_SANE_MATCH_MINUTES = 130;
const MAX_CLOCK_STAMP_AGE_MS = 3 * 60 * 60 * 1000;
// The client keeps the clock RUNNING between provider readings, like londonpro365's own page: the
// clock is never frozen just because a tick was late (the old 120 s limit froze it whenever the
// socket hiccuped, the tab was in the background or the feed paused for a moment). It only stops
// after this long without ANY new reading (the feed is really dead), and never past the end of the
// period it belongs to (see projectionLimitSeconds).
export const MAX_PROJECTION_SECONDS = 15 * 60;
// How far beyond the nominal end of a period a running clock may go (stoppage time) before it holds.
const FIRST_HALF_CEILING_SECONDS = 75 * 60;   // 45' + up to 30' of stoppage (+15, +20 happen)
const SECOND_HALF_CEILING_SECONDS = 105 * 60; // 90' + up to 15' of stoppage
const LATE_CEILING_SECONDS = 125 * 60;
// Once the last reading is already in stoppage time (>= 90:00) the match is about to end, and a feed
// that goes quiet then has most likely lost the match (final whistle), not paused it: the clock may
// run on for only this long, so a finished match is not left showing "105:00".
export const LATE_MAX_PROJECTION_SECONDS = 5 * 60;
export function projectionLimitSeconds(baseTotalSeconds: number, bareMinute: boolean): number {
  if (bareMinute) return MAX_PROJECTION_BARE_MINUTE_SECONDS;
  const ceiling = baseTotalSeconds < 45 * 60 ? FIRST_HALF_CEILING_SECONDS
    : baseTotalSeconds < 105 * 60 ? SECOND_HALF_CEILING_SECONDS : LATE_CEILING_SECONDS;
  const maxRun = baseTotalSeconds >= 90 * 60 && baseTotalSeconds < 105 * 60 ? LATE_MAX_PROJECTION_SECONDS : MAX_PROJECTION_SECONDS;
  return Math.max(0, Math.min(maxRun, ceiling - baseTotalSeconds));
}
// A clock that came as a bare minute ("72", no seconds) says nothing about the seconds: never
// let the extrapolation roll over into the next minute ahead of the provider.
export const MAX_PROJECTION_BARE_MINUTE_SECONDS = 59;
export function parseLiveClock(minute?: string): { minute: number; second: number; half: string } | null {
  let raw = String(minute || '').trim();
  if (/^\d+$/.test(raw) && Number(raw) > MAX_SANE_MATCH_MINUTES) {
    const t = Number(raw);
    const mins = Math.floor(t / 60);
    if (mins > MAX_SANE_MATCH_MINUTES) return null;
    raw = mins + ':' + String(t % 60).padStart(2, '0');
  }
  const match = raw.match(/^(\d+):?(\d{1,2})?/);
  if (!match) return null;
  const m = parseInt(match[1], 10);
  if (Number.isNaN(m)) return null;
  const s = match[2] ? parseInt(match[2], 10) : 0;
  const half = m < 45 ? 'Pjesa I' : m < 46 ? 'Pushim' : m < 90 ? 'Pjesa II' : 'Shtesë';
  return { minute: m, second: Number.isNaN(s) ? 0 : s, half };
}

// The server only pushes a fresh minute every ~30s (live sync interval) or
// on a socket event — without this, the on-screen clock sits frozen between
// updates instead of counting up like the provider's own site does. Ticks
// once per second client-side from the last known {minute:second}, and
// snaps back to the real value the moment a fresh one arrives (socket poll
// or REST refresh), so it never drifts far from the truth.
// Pure decision extracted for direct testing (no React/DOM needed): should
// an incoming clock value replace the currently-ticking one? Exported so
// the "never rewind" rule can be verified in isolation from the hook.
export function shouldAcceptNewClockBase(
  current: { totalSeconds: number; receivedAt: number } | null,
  incomingTotalSeconds: number,
  now: number = Date.now(),
  // When the incoming reading was taken (server stamp). With it, a FRESHER reading that says the
  // running clock is clearly ahead (the match was paused: injury, VAR) corrects it, instead of the
  // clock running ahead of the provider for good. Small differences still never rewind it.
  incomingReceivedAt?: number
): boolean {
  if (!current) return true;
  const currentProjected = current.totalSeconds + Math.max(0, Math.floor((now - current.receivedAt) / 1000));
  if (incomingTotalSeconds >= currentProjected) return true;
  if (incomingReceivedAt != null && incomingReceivedAt > current.receivedAt) {
    const incomingProjected = incomingTotalSeconds + Math.max(0, Math.floor((now - incomingReceivedAt) / 1000));
    return currentProjected - incomingProjected > REWIND_TOLERANCE_SECONDS;
  }
  return false;
}
const REWIND_TOLERANCE_SECONDS = 5;

// Pure projection, extracted for direct testing: given a known
// {minute,second} as of `receivedAt`, what should the clock read `now`?
// This is the exact "source_time + received_at -> current elapsed" resync
// arithmetic — e.g. source 41:23 received at T, asked at T+7s -> 41:30.
export function projectClock(totalSecondsAtReceivedAt: number, receivedAt: number, now: number, maxElapsedSeconds: number = MAX_PROJECTION_SECONDS): { minute: number; second: number; half: string } {
  const elapsed = Math.min(maxElapsedSeconds, Math.max(0, Math.floor((now - receivedAt) / 1000)));
  const total = totalSecondsAtReceivedAt + elapsed;
  const minute = Math.floor(total / 60);
  const second = total % 60;
  const half = minute < 45 ? 'Pjesa I' : minute < 46 ? 'Pushim' : minute < 90 ? 'Pjesa II' : 'Shtesë';
  return { minute, second, half };
}

// When a minute reading was received: the server's stamp if it is plausible, else
// `now`. A stamp older than a few hours, or in the future, cannot belong to this
// match's running clock (rows imported days before kickoff used to carry their
// import time), so it is ignored instead of producing a clock like "11081:42".
export function clockReceivedAt(serverUpdatedAt: number | undefined, now: number): number {
  // The stamp is in SERVER time: move it onto this device's clock first (see noteServerTime).
  const local = serverUpdatedAt != null ? serverToLocal(serverUpdatedAt) : undefined;
  const ok = local != null && local <= now && now - local < MAX_CLOCK_STAMP_AGE_MS;
  return ok ? (local as number) : now;
}

export function useTickingClock(
  rawMinute?: string,
  // Real server-side "as of" timestamp for rawMinute (epoch ms) — see
  // migrations/0002_live_minute_updated_at.sql. When present, the FIRST
  // render already shows the correct elapsed minute:second (no waiting for
  // a few ticks to "catch up"), and the value is consistent across every
  // client/tab/device instead of each one anchoring to its own fetch time.
  // Falls back to the client's own receive time when absent (older API
  // response shape, or a synthetic/estimated minute with no real reading
  // to anchor to).
  serverUpdatedAt?: number,
  // Whether the clock should actually be advancing right now. False during
  // HALFTIME (and any other non-running live state) — the provider's
  // minute is frozen then, and ticking forward from it would show a clock
  // running through a break that hasn't actually resumed. See isHalftime()
  // in utils/liveStatus.ts for the source of truth this is normally paired
  // with at the call site.
  ticking: boolean = true,
  // The minute is a wall-clock guess from the kickoff time (currentMinuteEstimated), not a
  // provider reading: no clock is built from it (callers show "~40'" instead of "40:19").
  estimated: boolean = false
): { minute: number; second: number; half: string } | null {
  const base = estimated ? null : parseLiveClock(rawMinute);
  // Seconds are only trustworthy when the provider's own value carried them ("72:14", or a
  // bare seconds counter such as "1776"); a bare "72" does not.
  const hasSeconds = /:\d/.test(String(rawMinute ?? '')) || (/^\d+$/.test(String(rawMinute ?? '').trim()) && Number(rawMinute) > MAX_SANE_MATCH_MINUTES);
  const maxProject = base ? projectionLimitSeconds(base.minute * 60 + base.second, !hasSeconds) : MAX_PROJECTION_SECONDS;
  const [, forceTick] = React.useState(0);
  const baseRef = React.useRef<{ totalSeconds: number; receivedAt: number; hasSeconds: boolean } | null>(null);
  // A fresher reading that is a little BEHIND what is already on screen (the phone's clock was a
  // fraction early) must not make the seconds jump backwards: the clock runs at half speed until the
  // true time catches up with it, then at full speed again.
  const slewRef = React.useRef<{ from: number; startedAt: number } | null>(null);

  React.useEffect(() => {
    if (!base) {
      baseRef.current = null;
      slewRef.current = null;
      return;
    }
    const incomingTotalSeconds = base.minute * 60 + base.second;
    // A minute reading older than a few hours (or from the future) cannot belong to
    // this match's running clock: fall back to the local receive time.
    const receivedAt = clockReceivedAt(serverUpdatedAt, Date.now());
    const now = Date.now();
    const cur = baseRef.current;
    const curProjected = cur ? cur.totalSeconds + Math.max(0, Math.floor((now - cur.receivedAt) / 1000)) : 0;
    // A bare minute ("89", no seconds: the slower REST feed) says nothing about the seconds. Once the
    // clock has real seconds it must not be replaced by "89:00", which made it jump back by up to a
    // minute. It only matters when it names a minute the running clock has not reached yet.
    if (cur && cur.hasSeconds && !hasSeconds && Math.floor(incomingTotalSeconds / 60) <= Math.floor(curProjected / 60)) return;
    // Never let the displayed clock jump BACKWARD within the same match. A real match clock only
    // ever moves forward; a lower, OLDER reading is stale / out of order, not a correction.
    if (!shouldAcceptNewClockBase(cur, incomingTotalSeconds, now, receivedAt)) {
      // ... but a FRESHER reading that is only a few seconds behind is the truth: adopt it and let the
      // clock slow down until it matches, instead of keeping a clock that runs ahead of the provider.
      if (cur && receivedAt > cur.receivedAt) {
        const incomingProjected = incomingTotalSeconds + Math.max(0, Math.floor((now - receivedAt) / 1000));
        const behind = curProjected - incomingProjected;
        if (behind > 0 && behind <= REWIND_TOLERANCE_SECONDS) {
          slewRef.current = { from: curProjected, startedAt: now };
          baseRef.current = { totalSeconds: incomingTotalSeconds, receivedAt, hasSeconds };
        }
      }
      return;
    }
    slewRef.current = null;
    baseRef.current = { totalSeconds: incomingTotalSeconds, receivedAt, hasSeconds };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawMinute, serverUpdatedAt]);

  React.useEffect(() => {
    if (!base || !ticking) return;
    // Re-render exactly when the displayed second changes (aligned with the reading's own phase), not on a
    // free-running 1 s interval whose drift made seconds repeat or skip.
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const b = baseRef.current;
      const phase = b ? (Date.now() - b.receivedAt) % 1000 : 0;
      id = setTimeout(() => { forceTick((n) => n + 1); schedule(); }, Math.max(30, 1000 - phase + 15));
    };
    schedule();
    return () => clearTimeout(id);
  }, [!!base, ticking]);

  if (!base || !baseRef.current) return base;
  const nowMs = Date.now();
  const projected = ticking
    ? projectClock(baseRef.current.totalSeconds, baseRef.current.receivedAt, nowMs, maxProject)
    : projectClock(baseRef.current.totalSeconds, baseRef.current.receivedAt, baseRef.current.receivedAt, maxProject); // frozen: elapsed=0
  let shown = projected;
  const slew = slewRef.current;
  if (slew && ticking) {
    const slewed = Math.floor(slew.from + (nowMs - slew.startedAt) / 2000);
    if (slewed > projected.minute * 60 + projected.second) {
      shown = projectClock(slewed, nowMs, nowMs, 0);
    } else {
      slewRef.current = null;
    }
  }
  // Never display an impossible clock (it would read like "11081:42"): callers fall
  // back to the plain "LIVE" label when there is no usable clock.
  return shown.minute > MAX_SANE_MATCH_MINUTES ? null : shown;
}

// "61:01" gjatë lojës normale; kur provideri s'jep fare minutë (vetëm "LIVE"
// gjenerik), s'ka çfarë të shfaqet me sekonda — kthehet null dhe thirrësi
// bie mbrapa te fallback-u ekzistues ('LIVE').
export function formatLiveClock(clock: { minute: number; second: number } | null): string | null {
  if (!clock) return null;
  return `${clock.minute}:${String(clock.second).padStart(2, '0')}`;
}

// Shared by MatchRow and the featured-matches carousel: the card/row shows
// ONLY the 1X2 market (1 / X / 2) — never the extra outcomes some providers
// pack into the same bucket (correct score, HTFT).
export function getMatchWinnerMarket(match: Match) {
  const h2hMarket = match.markets.find(m => m.id.endsWith('-h2h'));
  return h2hMarket
    ? { ...h2hMarket, options: h2hMarket.options.filter(o => o.id === 'HOME' || o.id === 'DRAW' || o.id === 'AWAY') }
    : undefined;
}

const MatchRow: React.FC<MatchRowProps> = ({ match, onBetClick, onOpenDetail, isAdmin, onSettleMatch, isSimulating, selectedIds, favoriteTeams, onToggleFavoriteTeam, favoriteMatches, onToggleFavoriteMatch }) => {
  const { t } = useI18n();
  const isFinished = match.status === MatchStatus.FINISHED;
  const isLive = match.status === MatchStatus.LIVE;
  const matchWinnerMarket = getMatchWinnerMarket(match);
  const liveClock = useTickingClock(match.currentMinute, match.currentMinuteUpdatedAt, isLive && !isHalftime(match), !!match.currentMinuteEstimated);

  // Odds-movement arrows in the list view, same approach as MatchDetail:
  // remember last-seen price per selection, flash up/down briefly on change.
  const prevOddsRef = React.useRef<Map<string, number>>(new Map());
  const [oddsFlash, setOddsFlash] = React.useState<Map<string, 'up' | 'down'>>(new Map());

  React.useEffect(() => {
    const prev = prevOddsRef.current;
    const nextFlash = new Map<string, 'up' | 'down'>();
    let changed = false;
    for (const market of match.markets) {
      for (const opt of market.options) {
        const key = `${market.id}-${opt.id}`;
        const last = prev.get(key);
        if (last != null && last !== opt.odds) {
          nextFlash.set(key, opt.odds > last ? 'up' : 'down');
          changed = true;
        }
        prev.set(key, opt.odds);
      }
    }
    if (changed) {
      setOddsFlash(nextFlash);
      const flashTimer = setTimeout(() => setOddsFlash(new Map()), 2500);
      return () => clearTimeout(flashTimer);
    }
  }, [match.markets]);

  const getButtonClass = (marketId: string, selectionId: string) => {
    const uniqueId = `${match.id}-${marketId}-${selectionId}`;
    const isSelected = selectedIds.includes(uniqueId);
    const base = "flex-1 flex flex-col justify-center items-center h-11 md:h-full min-h-[44px] rounded cursor-pointer transition-colors text-xs font-bold mx-[1px] active:scale-95";
    if (isFinished) return `${base} opacity-40 cursor-default bg-brand-panel text-brand-textMuted`;
    if (isSelected) return `${base} bg-white text-brand-headerDark`;
    return `${base} bg-[#444] hover:bg-[#555] text-brand-yellow`;
  };

  const isToday = isSameAlbaniaDay(match.startTime, albaniaTodayKey());

  return (
    <div className={`flex flex-col md:flex-row border-b border-brand-divider bg-brand-panel hover:bg-[#3f3f3f] transition-colors group py-3 px-3 ${isLive ? 'border-l-4 border-l-brand-accent' : ''}`}>
      
      {/* Time & Teams Info */}
      <div className="flex-1 flex items-center cursor-pointer mb-3 md:mb-0" onPointerDown={() => { if (match.status === MatchStatus.LIVE) api.prefetchLiveDetail(String(match.liveSourceId ?? match.id)); }} onClick={() => onOpenDetail(match)}>
        <div className="text-xs text-brand-textMuted w-12 text-center flex flex-col items-center justify-center shrink-0">
           {isLive ? (
               <div className={`font-bold leading-tight ${isHalftime(match) ? 'text-brand-yellow' : 'text-brand-accent animate-pulse'}`}>
                   {isHalftime(match) ? t('Pushim') : (liveClock ? formatLiveClock(liveClock) : liveMinuteFallback(match))}
                   {isLiveClockStale(match) && <span title={t('Pa përditësim nga provider-i')} className="ml-1 text-amber-400">●</span>}
               </div>
           ) : (
               <>
                <div className={isToday ? "text-brand-text" : "text-brand-textMuted"}>
                    {formatMatchTime(match.startTime)}
                </div>
                {!isToday && <div className="text-[10px]">{formatMatchDayMonth(match.startTime)}</div>}
               </>
           )}
           {onToggleFavoriteMatch && !isFinished && (
             <span className="mt-1"><StarButton active={!!favoriteMatches?.has(match.id)} onClick={(e) => { e.stopPropagation(); onToggleFavoriteMatch(match.id); }} /></span>
           )}
        </div>
        
        <div className="flex-1 ml-3 border-l border-brand-divider pl-3 py-1 overflow-hidden">
           <div className="flex flex-col gap-1.5">
               {/* Home Team */}
               <div className={`flex justify-between items-center ${isFinished ? 'opacity-80' : ''}`}>
                 <span className="flex items-center min-w-0 gap-1.5">
                   <StarButton active={favoriteTeams.has(match.homeTeam)} onClick={(e) => { e.stopPropagation(); onToggleFavoriteTeam(match.homeTeam); }} />
                   <TeamLogo name={match.homeTeam} league={match.league} providerLogo={match.homeTeamLogo} size="sm" />
                   <span className="text-brand-text font-bold text-sm truncate pr-2">{match.homeTeam}</span>
                 </span>
                 {(isFinished || isLive) && (
                    <span className={`font-mono font-bold text-lg w-8 text-right leading-none ${isLive ? 'text-brand-yellow drop-shadow-md' : 'text-brand-accent'}`}>
                        {isLive ? formatScore(match.liveHomeScore) : formatScore(match.score?.home)}
                    </span>
                 )}
               </div>
               
               {/* Away Team */}
               <div className={`flex justify-between items-center ${isFinished ? 'opacity-80' : ''}`}>
                 <span className="flex items-center min-w-0 gap-1.5">
                   <StarButton active={favoriteTeams.has(match.awayTeam)} onClick={(e) => { e.stopPropagation(); onToggleFavoriteTeam(match.awayTeam); }} />
                   <TeamLogo name={match.awayTeam} league={match.league} providerLogo={match.awayTeamLogo} size="sm" />
                   <span className="text-brand-text font-bold text-sm truncate pr-2">{match.awayTeam}</span>
                 </span>
                 {(isFinished || isLive) && (
                    <span className={`font-mono font-bold text-lg w-8 text-right leading-none ${isLive ? 'text-brand-yellow drop-shadow-md' : 'text-brand-accent'}`}>
                        {isLive ? formatScore(match.liveAwayScore) : formatScore(match.score?.away)}
                    </span>
                 )}
               </div>
           </div>
        </div>
        
        {/* Detail Chevron */}
        <div className="mx-2 text-brand-textMuted">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
        </div>
      </div>

      {/* Admin Button */}
      {isAdmin && !isFinished && !isLive && (
         <div className="flex items-center justify-end md:justify-center md:px-2 md:border-r md:border-brand-divider mb-2 md:mb-0">
            <button 
                onClick={(e) => {
                    e.stopPropagation();
                    const homeStr = window.prompt(t('Gola {team} (shtëpi):', { team: match.homeTeam }));
                    if (homeStr === null) return;
                    const awayStr = window.prompt(t('Gola {team} (mysafir):', { team: match.awayTeam }));
                    if (awayStr === null) return;
                    const homeScore = parseInt(homeStr, 10);
                    const awayScore = parseInt(awayStr, 10);
                    if (Number.isNaN(homeScore) || Number.isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
                        window.alert(t('Rezultat i pavlefshëm.'));
                        return;
                    }
                    onSettleMatch(match, homeScore, awayScore);
                }}
                disabled={isSimulating}
                className="text-[10px] bg-brand-headerDark hover:bg-brand-header text-white px-2 py-1 rounded border border-brand-header w-full md:w-auto"
            >
                {isSimulating ? '...' : 'Settle (Real Score)'}
            </button>
         </div>
      )}

      {/* Odds Buttons */}
      <div className={`w-full md:w-[35%] flex items-stretch gap-1`}>
        {matchWinnerMarket && matchWinnerMarket.options.map(opt => {
            if (opt.odds === 0) return null;
            const flash = oddsFlash.get(`${matchWinnerMarket.id}-${opt.id}`);
            // A closed option is not shown at all: an empty cell keeps the 1 / X / 2 columns where they are.
            if (opt.suspended) return <div key={opt.id} className="flex-1" aria-hidden="true" />;
            return (
             <div 
                key={opt.id}
                onClick={() => !isFinished && onBetClick(match, matchWinnerMarket.id, opt.id)}
                className={getButtonClass(matchWinnerMarket.id, opt.id)}
            >
                <span className="text-brand-textMuted text-[10px] font-normal leading-none mb-0.5">{opt.id === 'DRAW' ? 'X' : opt.id === 'HOME' ? '1' : opt.id === 'AWAY' ? '2' : ''}</span>
                <span className="leading-none flex items-center gap-0.5">
                  {opt.odds.toFixed(2)}
                  {flash === 'up' && <span className="text-[9px] text-green-400">▲</span>}
                  {flash === 'down' && <span className="text-[9px] text-red-400">▼</span>}
                </span>
            </div>
            )
        })}
      </div>
    </div>
  );
};

export default React.memo(MatchRow);