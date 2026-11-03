// Pauses betting on a match while a penalty is being taken / reviewed, like the original site does (every market of
// the match shows a padlock until play resumes). Zero imports on purpose: used from the feed consumer (sets / clears it)
// and from marketRules.js (reads it at placement time and when the board marks options closed).
//
// Set when the provider's pitch code says "penalty" (VC x1236, see liveAction.js); cleared by the next real action
// (anything else the feed decodes), by a goal, by the final whistle, or by the safety cap below, so a feed that goes
// quiet can never leave a match locked for good.
const MAX_MS = Number(process.env.PENALTY_LOCK_MAX_MS) > 0 ? Number(process.env.PENALTY_LOCK_MAX_MS) : 150000;
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
