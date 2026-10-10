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

// Text for the live badge when there is no usable ticking clock.
export function liveMinuteFallback(match: { currentMinute?: string; currentMinuteEstimated?: boolean }): string {
  if (match.currentMinuteEstimated) return formatEstimatedMinute(match.currentMinute);
  return match.currentMinute ? `${match.currentMinute}'` : 'LIVE';
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
