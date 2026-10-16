import { useEffect } from 'react';
import { Match, MatchStatus } from '../types';
import * as api from '../services/api';
import { isMessageForMatch } from '../utils/liveStatus';
import { OddsChange, patchMarketsOdds } from '../utils/matchPatches';

type SetMatches = (update: (current: Match[]) => Match[]) => void;
type SetDetail = (update: (current: Match | null) => Match | null) => void;

interface Options {
  enabled: boolean;
  setMatches: SetMatches;
  setDetailMatchFull: SetDetail;
  /** Re-download the match list (used for events the socket cannot patch in place). */
  reloadMatches: () => void;
}

// LIVE_TICKs are buffered and applied in ONE setMatches per 250ms. With ~80 live matches each
// ticking, applying every message separately re-mapped the whole list dozens of times a second.
// The buffer keeps only the newest value per field per match, so nothing is lost.
const TICK_FLUSH_MS = 250;
const RECONNECT_MAX_MS = 30_000;

interface TickAccumulator {
  homeScore?: number;
  awayScore?: number;
  minute?: string;
  minuteUpdatedAt?: number;
  action?: Match['liveAction'];
  hasAction?: boolean;
  liveStatus?: string;
}

const withScoreAndClock = (m: Match, msg: any): Match => ({
  ...m,
  liveHomeScore: msg.homeScore ?? m.liveHomeScore,
  liveAwayScore: msg.awayScore ?? m.liveAwayScore,
  currentMinute: msg.minute ?? m.currentMinute,
  currentMinuteUpdatedAt: msg.minute != null ? (msg.minuteUpdatedAt ?? Date.now()) : m.currentMinuteUpdatedAt,
});

/**
 * Real-time updates over the WebSocket: score, clock, half-time status, goals, match start/end and
 * price moves are patched into the match list in place. Reconnects with exponential backoff.
 * The slow REST refresh in useMatchesFeed is only a safety net for a missed message.
 */
export function useLiveSocket({ enabled, setMatches, setDetailMatchFull, reloadMatches }: Options) {
  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let tickTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let cancelled = false;
    const tickBuffer = new Map<string, TickAccumulator>();

    const flushTicks = () => {
      if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
      if (tickBuffer.size === 0) return;
      const batch = new Map(tickBuffer);
      tickBuffer.clear();
      setMatches((current) => current.map((m) => {
        const tick = batch.get(m.id) ?? (m.liveSourceId ? batch.get(m.liveSourceId) : undefined);
        if (!tick) return m;
        return {
          ...m,
          liveHomeScore: tick.homeScore ?? m.liveHomeScore,
          liveAwayScore: tick.awayScore ?? m.liveAwayScore,
          currentMinute: tick.minute ?? m.currentMinute,
          currentMinuteUpdatedAt: tick.minute != null ? (tick.minuteUpdatedAt ?? Date.now()) : m.currentMinuteUpdatedAt,
          liveAction: tick.hasAction ? tick.action : m.liveAction,
          // HT / 1H / 2H from the tick: the clock stops at half time and runs again the moment the
          // second half starts, without waiting for the list refresh.
          liveStatus: tick.liveStatus !== undefined ? tick.liveStatus : m.liveStatus,
        };
      }));
    };

    const queueTick = (msg: any) => {
      const acc = tickBuffer.get(msg.matchId) || {};
      if (msg.homeScore != null) acc.homeScore = msg.homeScore;
      if (msg.awayScore != null) acc.awayScore = msg.awayScore;
      if (msg.minute != null) { acc.minute = msg.minute; acc.minuteUpdatedAt = msg.minuteUpdatedAt ?? Date.now(); }
      if (msg.action !== undefined) { acc.action = msg.action; acc.hasAction = true; }
      if (msg.liveStatus !== undefined) acc.liveStatus = msg.liveStatus;
      tickBuffer.set(msg.matchId, acc);
      if (!tickTimer) tickTimer = setTimeout(flushTicks, TICK_FLUSH_MS);
    };

    const patchMatch = (matchId: string, patch: (m: Match) => Match) =>
      setMatches((current) => current.map((m) => (isMessageForMatch(m, matchId) ? patch(m) : m)));

    const handleOddsChanged = (msg: any) => {
      const changes: OddsChange[] = Array.isArray(msg.changes) ? msg.changes : [];
      if (!changes.length) return;
      // The list only carries the h2h market; the same patch is mirrored onto the full markets of
      // the open detail view so prices in other markets keep moving while someone is looking.
      setMatches((current) => current.map((m) => {
        if (m.id !== msg.matchId) return m;
        const markets = patchMarketsOdds(m.markets, changes);
        return markets === m.markets ? m : { ...m, markets };
      }));
      setDetailMatchFull((current) => {
        if (!current || current.id !== msg.matchId) return current;
        const markets = patchMarketsOdds(current.markets, changes);
        return markets === current.markets ? current : { ...current, markets };
      });
    };

    const handleMessage = (msg: any) => {
      // One frame with the newest tick of many matches (server-side coalescing).
      if (msg.type === 'LIVE_TICKS' && Array.isArray(msg.ticks)) {
        for (const tick of msg.ticks) if (tick && tick.matchId) queueTick(tick);
        return;
      }
      if (!msg.matchId) return;
      // Buffered ticks are older than this message: apply them first so a stale tick can never
      // overwrite what this message is about to set.
      if (msg.type !== 'LIVE_TICK') flushTicks();

      switch (msg.type) {
        case 'GOAL':
          patchMatch(msg.matchId, (m) => ({ ...withScoreAndClock(m, msg), status: MatchStatus.LIVE, isLive: true }));
          break;
        case 'GOAL_DISALLOWED':
          // A goal that was shown got retracted (VAR / provider correction): apply the lower score.
          patchMatch(msg.matchId, (m) => withScoreAndClock(m, msg));
          break;
        case 'LIVE_TICK':
          queueTick(msg);
          break;
        case 'LIVE_EVENT':
          reloadMatches();
          break;
        case 'MATCH_STARTED':
          patchMatch(msg.matchId, (m) => ({ ...m, status: MatchStatus.LIVE, isLive: true }));
          reloadMatches();
          break;
        case 'MATCH_ENDED':
          // Apply the final score and flip the status at once so the match drops out of the live
          // list immediately instead of minutes later.
          patchMatch(msg.matchId, (m) => ({
            ...m,
            status: MatchStatus.FINISHED,
            isLive: false,
            liveHomeScore: msg.homeScore ?? m.liveHomeScore,
            liveAwayScore: msg.awayScore ?? m.liveAwayScore,
          }));
          break;
        case 'ODDS_CHANGED':
          handleOddsChanged(msg);
          break;
        // CARD changes nothing the list carries; the open detail view refreshes its own events.
        default:
          break;
      }
    };

    const connect = () => {
      socket = new WebSocket(api.getWsUrl());
      socket.onopen = () => {
        attempt = 0;
        const token = api.getToken();
        if (token) socket!.send(JSON.stringify({ type: 'auth', token }));
        socket!.send(JSON.stringify({ type: 'subscribe', topic: 'live' }));
        socket!.send(JSON.stringify({ type: 'subscribe', topic: 'odds' }));
      };
      socket.onmessage = (event) => {
        try { handleMessage(JSON.parse(event.data)); } catch { /* ignore malformed socket messages */ }
      };
      socket.onclose = () => {
        if (cancelled) return;
        const delay = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** attempt);
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (tickTimer) clearTimeout(tickTimer);
      socket?.close();
    };
  }, [enabled, setMatches, setDetailMatchFull, reloadMatches]);
}
