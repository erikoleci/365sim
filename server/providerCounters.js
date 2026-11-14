// Corner totals read from the provider's own event list (result_list), kept in memory per match.
// Used by readLiveCorners() when live_statistics has no fresh counter (the game-details socket does not deliver every match).
// Memory only: it is refreshed every live cycle (~30 s) so a restart loses nothing that matters, and it costs no database write.
const store = new Map(); // match id -> { home, away, at }
const CAP = 5000;
export function setProviderCorners(matchId, home, away, at = Date.now()) {
  if (store.size >= CAP && !store.has(matchId)) store.clear();
  store.set(matchId, { home, away, at });
}
export function getProviderCorners(matchId) { return store.get(matchId) || null; }
export const __resetProviderCornersForTests = () => store.clear();
