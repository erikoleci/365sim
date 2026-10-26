// Keeps a match in "half-time" for the whole break.
//
// Before: VC=1015 ("pushim") held HT for only 45 s; after that the provider's numeric
// api_status (meaning undocumented) came back, the client no longer saw HT, and its clock kept
// counting through the 15-minute break. Now the break starts on VC=1015 and lasts until real
// evidence that the second half has begun (a gameplay action, a goal, the provider saying 2H)
// or, as a safety net, MAX_HOLD_MS.
const MIN_HOLD_MS = 20000; // ignore late, out-of-order messages right after the whistle
const MAX_HOLD_MS = 20 * 60000; // a break is ~15 min; never stay in HT longer than this
const CAP = 5000;
const latched = new Map(); // matchId -> since (ms)

// Actions that can only happen while the ball is in play (a substitution can happen in the break).
const PLAY_KINDS = new Set([
  'attack', 'dangerous_attack', 'possession', 'shot_on_target', 'corner',
  'free_kick', 'throw_in', 'offside', 'goal', 'back_line_restart',
]);

export function __resetHalfTimeLatchForTests() {
  latched.clear();
}

export function isHalfTimeLatched(matchId, now = Date.now()) {
  const since = latched.get(matchId);
  if (since == null) return false;
  if (now - since > MAX_HOLD_MS) {
    latched.delete(matchId);
    return false;
  }
  return true;
}

export function enterHalfTime(matchId, now = Date.now()) {
  if (latched.has(matchId)) return false; // already in the break
  if (latched.size >= CAP) latched.clear();
  latched.set(matchId, now);
  return true; // newly entered
}

// Returns true when the latch was released by this call.
export function maybeReleaseHalfTime(matchId, { action, restStatus, scoreMoved, now = Date.now() } = {}) {
  const since = latched.get(matchId);
  if (since == null) return false;
  if (now - since < MIN_HOLD_MS) return false;
  const rest = String(restStatus || '').toUpperCase().trim();
  const secondHalf = rest === '2H' || rest === 'SECOND_HALF' || rest === 'ET' || rest === 'FT' || rest === 'ENDED' || rest === 'FINISHED';
  if (secondHalf || scoreMoved || (action && PLAY_KINDS.has(action.kind))) {
    latched.delete(matchId);
    return true;
  }
  return false;
}

export function forgetHalfTime(matchId) {
  latched.delete(matchId);
}
