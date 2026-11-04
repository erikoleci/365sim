// Pauses betting on a match for a few seconds after its score changes (goal, or a goal taken back by VAR).
// Why: players watching the match on TV know about the goal before our feed has moved the odds; for those seconds
// the old prices are worth more than they should be. Every market of the match is closed, then opens again.
//
// Open again when BOTH hold: at least MIN_MS passed since the score change, and the provider sent fresh odds for the
// match since then. If it never sends them, the pause ends after MAX_MS anyway, so a quiet feed never locks a match.
// Zero imports on purpose (same reason as penaltyLock.js): read by marketRules.js, set from the goal announcer.
const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
const MIN_MS = num(process.env.GOAL_PAUSE_MIN_MS, 10000);
const MAX_MS = num(process.env.GOAL_PAUSE_MAX_MS, 30000);
const CAP = 2000;
const pauses = new Map(); // bare match id -> { at, oddsSeen }

const bare = (id) => String(id == null ? '' : id).replace(/^l365-/, '');

export function setGoalPause(matchId, now = Date.now()) {
  const k = bare(matchId);
  if (!k) return;
  if (pauses.size >= CAP) pauses.clear();
  pauses.set(k, { at: now, oddsSeen: false });
}
// New odds arrived for the match (socket coefficient update): the pause may end once MIN_MS has passed.
export function noteOddsUpdate(matchId, now = Date.now()) {
  const p = pauses.get(bare(matchId));
  if (p && now >= p.at) p.oddsSeen = true;
}
export function isGoalPaused(matchId, now = Date.now()) {
  const k = bare(matchId);
  const p = k ? pauses.get(k) : undefined;
  if (!p) return false;
  const age = now - p.at;
  if (age >= MAX_MS || (age >= MIN_MS && p.oddsSeen)) { pauses.delete(k); return false; }
  return true;
}
export const __resetGoalPauseForTests = () => pauses.clear();
