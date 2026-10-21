import { Match } from '../types';
import { isLiveClockStale } from './liveStatus';

// A phone/tab that was in the background keeps a WebSocket that looks OPEN but stopped receiving,
// and its timers were paused, so on return the clock still read the minute it had when the user
// left. These rules decide when to force a fresh connection and a full reload.

/** Hidden at least this long -> on return always reconnect + reload (the socket cannot be trusted). */
export const BACKGROUND_RESYNC_MS = 20_000;
/** A live board with no socket message at all for this long is treated as a dead connection. */
export const SOCKET_SILENCE_MS = 45_000;
/** Never reload the list more often than this because of resume / focus events. */
export const RESUME_RELOAD_MIN_GAP_MS = 3_000;
/** While a live clock stays frozen, ask the server for a fresh list at most this often. */
export const STALE_CLOCK_RELOAD_GAP_MS = 20_000;
/** How often the watchdog looks at the connection and the clocks. */
export const WATCHDOG_INTERVAL_MS = 10_000;

const WS_OPEN = 1;

export function socketLooksDead(readyState: number | undefined, lastMessageAt: number, now: number, hasLiveMatches: boolean): boolean {
  if (readyState === undefined || readyState > WS_OPEN) return true; // closing / closed / none
  return readyState === WS_OPEN && hasLiveMatches && now - lastMessageAt > SOCKET_SILENCE_MS;
}

export const hasLiveMatches = (matches: Pick<Match, 'status'>[]): boolean => matches.some((m) => String(m.status) === 'LIVE');

export const anyLiveClockStale = (matches: Match[], now: number): boolean => matches.some((m) => isLiveClockStale(m, now));

/** On coming back to the page: must everything be re-synced from scratch? */
export const needsFullResync = (hiddenSince: number | null, now: number): boolean =>
  hiddenSince != null && now - hiddenSince >= BACKGROUND_RESYNC_MS;
