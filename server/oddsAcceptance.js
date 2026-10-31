// "Prano Ndryshimet & Vendos": a live price moved, the ticket was refused with ODDS_CHANGED, the
// player saw the new prices and pressed accept. That second request must book AT ONCE: the live
// delay (5 s) already ran for the first attempt, and waiting again let the price move again, so
// people chased changing prices for minutes.
//
// Safe because it only waives the WAITING, never the checks: the request is still verified against
// the current price / market / match state, and a price that got worse is refused again. Only an
// exact retry of the refused legs counts, within a short window, for a user with a normal risk level.
export const ACCEPT_WINDOW_MS = 60_000;
const MAX_USERS = 5000;
const refusals = new Map(); // userId -> { at, keys:Set }

const legKey = (s) => `${s.matchId}::${s.marketId}::${s.selectionId}`;

export function noteOddsRefusal(userId, selections, now = Date.now()) {
  if (userId == null || !Array.isArray(selections) || !selections.length) return;
  if (refusals.size >= MAX_USERS) {
    for (const [id, r] of refusals) if (now - r.at > ACCEPT_WINDOW_MS) refusals.delete(id);
    if (refusals.size >= MAX_USERS) refusals.clear();
  }
  refusals.set(String(userId), { at: now, keys: new Set(selections.map(legKey)) });
}

// True when this request is the player's retry of a ticket just refused for moved prices.
export function isAcceptedRetry(userId, selections, now = Date.now()) {
  const r = refusals.get(String(userId));
  if (!r || now - r.at > ACCEPT_WINDOW_MS) return false;
  if (!Array.isArray(selections) || !selections.length) return false;
  return selections.every((s) => r.keys.has(legKey(s))) && selections.length === r.keys.size;
}

export function forgetOddsRefusal(userId) { refusals.delete(String(userId)); }
export function __resetOddsAcceptanceForTests() { refusals.clear(); }
