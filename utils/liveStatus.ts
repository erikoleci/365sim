import { Match } from '../types';

// Turns whatever the live-scores provider sent us (a raw status code like
// "1H"/"HT"/"2H"/"FT"/"ET"/"PEN", or just a minute number) into a short
// Albanian label for the live badge — same source of truth used by the
// match card, the match detail header, and the live pitch widget.
export function formatLiveStatus(match: Pick<Match, 'currentMinute' | 'liveStatus' | 'currentMinuteEstimated'>): string {
  const approx = match.currentMinuteEstimated ? '~' : '';
  const raw = (match.liveStatus || '').toString().toUpperCase().trim();

  if (raw === 'HT' || raw === 'HALFTIME' || raw === 'HALF_TIME' || raw === 'PAUSED') {
    return 'Pushim (Pjesa e Parë ka Mbaruar)';
  }
  if (raw === 'FT' || raw === 'AET' || raw === 'ENDED' || raw === 'FINISHED') {
    return 'Ka Mbaruar';
  }
  if (raw === 'ET' || raw === 'EXTRA_TIME') {
    return 'Vazhdime';
  }
  if (raw === 'PEN' || raw === 'PENALTIES') {
    return 'Penallti';
  }
  if (raw === '1H' || raw === 'FIRST_HALF') {
    return match.currentMinute ? `${approx}${match.currentMinute}' (Pjesa 1)` : 'Pjesa e Parë';
  }
  if (raw === '2H' || raw === 'SECOND_HALF') {
    return match.currentMinute ? `${approx}${match.currentMinute}' (Pjesa 2)` : 'Pjesa e Dytë';
  }
  if (match.currentMinute) {
    return `${approx}${match.currentMinute}'`;
  }
  return 'LIVE';
}

// WebSocket live messages (GOAL, LIVE_TICK, MATCH_ENDED...) carry the id of the provider
// record that receives live data. When the same fixture is shown from a duplicate record
// (richer odds), the server marks it with liveSourceId; both ids must hit the same row.
export function isMessageForMatch(m: { id: string; liveSourceId?: string }, matchId: string): boolean {
  return m.id === matchId || m.liveSourceId === matchId;
}

// An estimated minute is a wall-clock guess from kickoff time, not a provider reading:
// show it as a rounded "~40'" -- never with ticking seconds ("~40:19"), which would
// look like a precise provider clock.
export function formatEstimatedMinute(minute: string | undefined | null): string {
  const raw = String(minute ?? '').trim();
  if (!raw) return 'LIVE';
  const m = raw.match(/^(\d+)(\+?)/);
  if (!m) return 'LIVE';
  return `~${m[1]}${m[2] ? '+' : "'"}`;
}

// A score that is missing must look missing ("–"), never "0": a real 0-0 comes from the
// provider as an explicit 0.
export function formatScore(v: number | null | undefined): string {
  return v == null ? '–' : String(v);
}

// The clock for the detail view/pitch: ONE coherent (minute, stamp) pair, never a minute from one
// source with the stamp of another. The live list/socket pair is the freshest, so it wins when it
// holds a real provider minute; otherwise the live-detail clock (same provider clock, its own
// stamp); otherwise the estimated minute is shown as "~".
export function pickClockSource(
  match: { currentMinute?: string; currentMinuteUpdatedAt?: number; currentMinuteEstimated?: boolean },
  stats: { clock?: string; minute?: number | null; minuteUpdatedAt?: number } | null | undefined,
): { raw: string | undefined; stamp: number | undefined; estimated: boolean } {
  if (match.currentMinute && !match.currentMinuteEstimated) {
    return { raw: String(match.currentMinute), stamp: match.currentMinuteUpdatedAt, estimated: false };
  }
  if (stats?.clock && stats.minuteUpdatedAt != null) {
    return { raw: stats.clock, stamp: stats.minuteUpdatedAt, estimated: false };
  }
  if (stats?.minute != null) {
    return { raw: String(stats.minute), stamp: undefined, estimated: false };
  }
  return { raw: match.currentMinute, stamp: match.currentMinuteUpdatedAt, estimated: !!match.currentMinuteEstimated };
}

// Text for the live badge when there is no usable ticking clock.
export function liveMinuteFallback(match: { currentMinute?: string; currentMinuteEstimated?: boolean }): string {
  // A wall-clock guess is never shown as a minute: just "LIVE" until the provider's clock arrives.
  if (match.currentMinuteEstimated) return 'LIVE';
  return match.currentMinute ? `${match.currentMinute}'` : 'LIVE';
}

// A row marked LIVE that has NO real provider clock is not receiving live data: its minute is
// only a wall-clock guess ("~60'") or missing ("LIVE"), and its score is a default 0-0. These
// are leftovers of the pre-match catalogue (or a second record of a match whose live record
// does work) and were shown next to the working ones, e.g. "Liverpool FC v Manchester City ~60'"
// beside the real "Liverpool v Man City 58:49". They are hidden. Kept: any row with a real
// provider clock, halftime, and a match that kicked off a moment ago (the feed needs a minute
// to deliver its first clock).
export const HIDE_LIVE_WITHOUT_PROVIDER_CLOCK = true;
export const LIVE_FIRST_CLOCK_GRACE_MS = 5 * 60 * 1000;
export const LIVE_RECENT_CLOCK_MS = 30 * 60 * 1000;

// The provider clock stopped moving: the client froze it (MAX_PROJECTION_SECONDS = 120). Shown as
// a small marker so a frozen "72:14" is never mistaken for a live one. Not for halftime.
export const LIVE_CLOCK_STALE_MS = 150 * 1000;
export function isLiveClockStale(
  match: { status: unknown; currentMinute?: string; currentMinuteUpdatedAt?: number; currentMinuteEstimated?: boolean; liveStatus?: string },
  now: number = Date.now(),
): boolean {
  if (String(match.status) !== 'LIVE' || isHalftime(match as any)) return false;
  if (!match.currentMinute || match.currentMinuteEstimated) return false;
  const stamp = Number(match.currentMinuteUpdatedAt);
  return Number.isFinite(stamp) && stamp > 0 && now - stamp > LIVE_CLOCK_STALE_MS;
}
export function isGhostLiveMatch(
  match: { status: unknown; startTime: string; currentMinute?: string; currentMinuteUpdatedAt?: number; currentMinuteEstimated?: boolean; liveStatus?: string },
  now: number = Date.now(),
): boolean {
  if (!HIDE_LIVE_WITHOUT_PROVIDER_CLOCK) return false;
  if (String(match.status) !== 'LIVE') return false;
  if (isHalftime(match as any)) return false;
  if (match.currentMinute && !match.currentMinuteEstimated) return false;
  // It had a real provider clock a moment ago (halftime, a brief feed gap): not a ghost.
  const stamp = Number(match.currentMinuteUpdatedAt);
  if (Number.isFinite(stamp) && stamp > 0 && now - stamp <= LIVE_RECENT_CLOCK_MS) return false;
  const kickoff = Date.parse(match.startTime);
  if (!Number.isNaN(kickoff) && kickoff <= now && now - kickoff <= LIVE_FIRST_CLOCK_GRACE_MS) return false;
  return true;
}

export function isHalftime(match: Pick<Match, 'liveStatus'>): boolean {
  const raw = (match.liveStatus || '').toString().toUpperCase().trim();
  return raw === 'HT' || raw === 'HALFTIME' || raw === 'HALF_TIME' || raw === 'PAUSED';
}

// Same rule as the server (server/oddsUtils.js isStaleLive): a match that is
// still marked LIVE this long after kickoff was abandoned by the feed, not
// really being played. It is dropped from every list instead of sitting there
// as "LIVE 0-0" for days.
export const MAX_LIVE_AGE_MS = 4 * 60 * 60 * 1000;

export function isStaleLiveMatch(match: Pick<Match, 'status' | 'startTime'>, now: number = Date.now()): boolean {
  if (String(match.status) !== 'LIVE') return false;
  const kickoff = Date.parse(match.startTime);
  return !Number.isNaN(kickoff) && kickoff <= now && now - kickoff > MAX_LIVE_AGE_MS;
}
