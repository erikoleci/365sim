// CRASH: a multiplier climbs from 1.00x; the player must cash out before it crashes. The crash point is drawn on the server
// when the round starts (and kept secret), so the browser can only watch and cash out. P(crash point >= x) = RTP / x.
export const CRASH_RTP = 0.96;
export const CRASH_MAX = 1000;
export const GROWTH = 0.12; // multiplier(t) = e^(GROWTH * t), t in seconds

// u in [0,1) from an injected integer RNG
export function drawCrashPoint(randInt) {
  const u = randInt(1_000_000_000) / 1_000_000_000;
  const raw = CRASH_RTP / (1 - u);
  const capped = Math.min(CRASH_MAX, raw);
  return Math.max(1, Math.floor(capped * 100) / 100);
}

export const multiplierAt = (elapsedSec) => Math.floor(Math.exp(GROWTH * Math.max(0, elapsedSec)) * 100) / 100;
export const timeToMultiplier = (m) => Math.log(Math.max(1, m)) / GROWTH;

// Outcome of a cash-out request made `elapsedSec` after the start.
// autoTarget (optional): the server-side auto cash-out target chosen before the round began.
export function resolveCashout({ crashPoint, elapsedSec, autoTarget = null, toleranceSec = 0.2 }) {
  const now = multiplierAt(elapsedSec);
  if (autoTarget && autoTarget >= 1.01) {
    if (crashPoint >= autoTarget) {
      // the target is reached at timeToMultiplier(target); the request must not come earlier than that
      if (elapsedSec + toleranceSec >= timeToMultiplier(autoTarget)) return { crashed: false, multiplier: autoTarget };
      return { early: true };
    }
    if (now >= crashPoint) return { crashed: true, multiplier: 0 };
    return { early: true };
  }
  if (now >= crashPoint) return { crashed: true, multiplier: 0 };
  return { crashed: false, multiplier: now };
}

export function simulateRtp(rounds, randInt, cashAt) {
  let paid = 0;
  for (let i = 0; i < rounds; i += 1) { const c = drawCrashPoint(randInt); if (c >= cashAt) paid += cashAt; }
  return paid / rounds;
}
