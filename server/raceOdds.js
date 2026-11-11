// Odds that change every race. Each runner's win chance is the base chance times a random factor, re-normalised to sum
// to 1; the odds are then rtp / chance, so the return to the player stays exactly the same (rtp) in every single race.
// The factors come from a seed (the round number for live races), so the server and every phone agree without storing
// anything.
export const ODDS_SPREAD = 0.35; // each chance moves by up to +-35% before re-normalising

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** runners: [{ id, p, ... }] -> same runners with new p and odds. */
export function varyRunners(base, seed, rtp, spread = ODDS_SPREAD) {
  const rnd = mulberry32(seed);
  const raw = base.map((r) => r.p * (1 + (rnd() * 2 - 1) * spread));
  const sum = raw.reduce((a, b) => a + b, 0);
  const ps = raw.map((w) => Math.round((w / sum) * 10000) / 10000);
  // repair rounding so the chances add up to exactly 1 (put the rest on the favourite)
  const diff = Math.round((1 - ps.reduce((a, b) => a + b, 0)) * 10000) / 10000;
  let fav = 0; ps.forEach((p, i) => { if (p > ps[fav]) fav = i; });
  ps[fav] = Math.round((ps[fav] + diff) * 10000) / 10000;
  return base.map((r, i) => ({ ...r, p: ps[i], odds: Math.floor((rtp / ps[i]) * 100) / 100 }));
}

/** Plackett-Luce finishing order for any set of runners. */
export function drawOrderFor(runners, randInt) {
  const left = runners.map((r) => ({ id: r.id, w: Math.round(r.p * 10000) }));
  const order = [];
  while (left.length) {
    const total = left.reduce((a, r) => a + r.w, 0);
    let r = randInt(total); let idx = 0;
    for (; idx < left.length; idx += 1) { if ((r -= left[idx].w) < 0) break; }
    order.push(left.splice(Math.min(idx, left.length - 1), 1)[0].id);
  }
  return order;
}

// ---- single-player races: the odds on screen are locked by a signed, short-lived token --------------------------
import crypto from 'node:crypto';
const TOKEN_TTL_MS = 15 * 60 * 1000;
const sign = (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 24);
export function makeRaceToken(secret, now = Date.now(), seed = crypto.randomInt(1, 2 ** 31)) {
  const payload = `${seed}.${now + TOKEN_TTL_MS}`;
  return { seed, token: `${payload}.${sign(payload, secret)}` };
}
/** Returns the seed when the token is genuine and not expired, otherwise null. */
export function readRaceToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const m = /^(\d{1,10})\.(\d{1,14})\.([0-9a-f]{24})$/.exec(token);
  if (!m) return null;
  const payload = `${m[1]}.${m[2]}`;
  const ok = crypto.timingSafeEqual(Buffer.from(sign(payload, secret)), Buffer.from(m[3]));
  if (!ok || Number(m[2]) < now) return null;
  return Number(m[1]);
}
