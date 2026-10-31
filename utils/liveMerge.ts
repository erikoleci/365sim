import { Match, MatchStatus } from '../types';

// A list that arrives from the server can be a few seconds older than what the WebSocket already put on screen.
// For a match that is live in both, the live MINUTE of the newer copy is kept, so a late list can never move a
// clock backwards. Half-time / second-half status, score and pitch action are NOT touched here: they always come
// from the list, so a missed socket message (the break ended, a goal) is still corrected by the next list.
export function keepNewerLive(current: Match[], incoming: Match[]): Match[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  return incoming.map((f) => {
    const c = byId.get(f.id);
    if (!c || c.status !== MatchStatus.LIVE || f.status !== MatchStatus.LIVE) return f;
    if ((c.currentMinuteUpdatedAt ?? 0) <= (f.currentMinuteUpdatedAt ?? 0)) return f;
    return {
      ...f,
      currentMinute: c.currentMinute,
      currentMinuteEstimated: c.currentMinuteEstimated,
      currentMinuteUpdatedAt: c.currentMinuteUpdatedAt,
    };
  });
}
