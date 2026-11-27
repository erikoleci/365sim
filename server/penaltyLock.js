// Pauses betting on a match while a penalty is being taken / reviewed, like the original site does (every market of
// the match shows a padlock until play resumes). Zero imports on purpose: used from the feed consumer (sets / clears it)
// and from marketRules.js (reads it at placement time and when the board marks options closed).
//
// Set when the provider's pitch code says "penalty" (VC x1008 awarded / x1023, see liveAction.js). It is lifted ONLY by
// a code that proves play went on after the kick: a goal (also a score change), a throw-in, a corner, a dangerous attack,
// a goal kick, the half-time / full-time whistle. Possession, plain attacks, free kicks, unknown codes... arrive while the
// penalty is still being reviewed (VAR, protests, treatment), so they do NOT lift it. The safety cap below is a last resort
// so a feed that goes quiet can never leave a match locked for good (default 5 minutes, PENALTY_LOCK_MAX_MS to change it).
const MAX_MS = Number(process.env.PENALTY_LOCK_MAX_MS) > 0 ? Number(process.env.PENALTY_LOCK_MAX_MS) : 300000;
const RELEASE_KINDS = new Set(['goal', 'throw_in', 'corner', 'dangerous_attack', 'back_line_restart', 'half_time', 'full_time']);
export const releasesPenaltyLock = (kind) => RELEASE_KINDS.has(kind);
const CAP = 2000;
const locks = new Map(); // bare match id -> lock start (ms)

const bare = (id) => String(id == null ? '' : id).replace(/^l365-/, '');

export function setPenaltyLock(matchId, now = Date.now()) {
  const k = bare(matchId);
  if (!k) return;
  if (locks.size >= CAP) locks.clear();
  if (!locks.has(k)) locks.set(k, now);
}
export function clearPenaltyLock(matchId) { locks.delete(bare(matchId)); }
export function isPenaltyLocked(matchId, now = Date.now()) {
  const k = bare(matchId);
  const at = k ? locks.get(k) : undefined;
  if (at === undefined) return false;
  if (now - at > MAX_MS) { locks.delete(k); return false; }
  return true;
}
export const __resetPenaltyLockForTests = () => locks.clear();
