// Which live games get the expensive full-market refresh (/ajax/livegame/{id})
// in a given cycle.
//
// Fetching the detail of EVERY live game each cycle costs one provider request per
// game: fine for 50 matches, impossible for hundreds (the cycle outlasts its own
// interval and the provider starts refusing). The cheap list response (ONE request
// for all games: score, minute, 1X2 odds) plus the socket feed keep every match
// current; the full set of markets is refreshed on a budget, most important first:
//   1. games someone has an open bet on, or is looking at right now
//   2. games never refreshed yet
//   3. the rest, the one refreshed longest ago first (round robin)
// With fewer live games than the budget, every game is refreshed every cycle.

const lastDetailAt = new Map(); // bare game id -> ms of the last successful detail fetch

const bare = (id) => String(id).replace(/^l365-/, '');

export function markDetailFetched(gameId, now = Date.now()) {
  lastDetailAt.set(bare(gameId), now);
}

// Age of the last full-market refresh, or null if there has been none since boot.
export function getLiveDetailAgeMs(gameOrMatchId, now = Date.now()) {
  const t = lastDetailAt.get(bare(gameOrMatchId));
  return t == null ? null : now - t;
}

// Forget games that are no longer live (keeps the map bounded).
export function pruneDetailAt(liveBareIds) {
  for (const id of lastDetailAt.keys()) if (!liveBareIds.has(id)) lastDetailAt.delete(id);
}

export function __resetDetailPlanForTests() {
  lastDetailAt.clear();
}

export function selectDetailTargets(games, { budget, priorityIds = new Set() } = {}) {
  const ids = games.filter((g) => g && g.id != null).map((g) => String(g.id));
  if (!(budget > 0) || ids.length <= budget) return new Set(ids);
  const ranked = ids.map((id) => {
    const last = lastDetailAt.get(id);
    return { id, tier: priorityIds.has(id) ? 0 : last == null ? 1 : 2, last: last ?? 0 };
  });
  ranked.sort((a, b) => a.tier - b.tier || a.last - b.last);
  return new Set(ranked.slice(0, budget).map((r) => r.id));
}

// For bet placement: are the non-1X2 markets of a live match too old to bet on?
// A match never refreshed since boot only counts as stale once the grace period
// after startup has passed (the first cycles are still filling in).
export function isLiveDetailStale({ ageMs, maxAgeMs, uptimeMs, graceMs = 180000 }) {
  if (!(maxAgeMs > 0)) return false;
  if (ageMs == null) return uptimeMs > graceMs;
  return ageMs > maxAgeMs;
}
