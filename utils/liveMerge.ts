import { Match, MatchStatus } from '../types';

// A list that arrives from the server can be a few seconds older than what the WebSocket already put on screen
// (minute, score, half-time status). For a match that is live in both, whichever copy has the NEWER minute
// timestamp keeps its live fields, so a late list can never move a clock or a score backwards.
export function keepNewerLive(current: Match[], incoming: Match[]): Match[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  return incoming.map((f) => {
    const c = byId.get(f.id);
    if (!c || c.status !== MatchStatus.LIVE || f.status !== MatchStatus.LIVE) return f;
    const cAt = c.currentMinuteUpdatedAt ?? 0;
    const fAt = f.currentMinuteUpdatedAt ?? 0;
    if (cAt <= fAt) return f;
    return {
      ...f,
      currentMinute: c.currentMinute,
      currentMinuteEstimated: c.currentMinuteEstimated,
      currentMinuteUpdatedAt: c.currentMinuteUpdatedAt,
      liveStatus: c.liveStatus,
      liveHomeScore: c.liveHomeScore,
      liveAwayScore: c.liveAwayScore,
      liveAction: c.liveAction,
    };
  });
}
