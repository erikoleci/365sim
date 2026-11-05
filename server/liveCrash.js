// LIVE CRASH: one shared rocket every 40 seconds for the whole table: 10 s betting, then the flight (max 28 s).
// The crash point is drawn by the server when betting closes; P(crash >= x) = 0.96 / x up to the 150x cap.
import { drawCrashPoint } from './crash.js';
export const CYCLE_MS = 40000;
export const BET_MS = 10000;
export const GROWTH = 0.18;
export const LIVE_CAP = 150;
export const MAX_TABLE_BET = 5000;
export const roundNo = (now = Date.now()) => Math.floor(now / CYCLE_MS);
export const flightStart = (round) => round * CYCLE_MS + BET_MS;
export const multiplierAt = (tSec) => Math.floor(Math.exp(GROWTH * Math.max(0, tSec)) * 100) / 100;
export const timeTo = (m) => Math.log(Math.max(1, m)) / GROWTH;
export const draw = (randInt) => Math.min(LIVE_CAP, drawCrashPoint(randInt));
export function infoAt(now, crashPoint = null) {
  const round = roundNo(now); const el = now % CYCLE_MS;
  if (el < BET_MS) return { round, phase: 'betting', msLeft: BET_MS - el };
  const t = (now - flightStart(round)) / 1000;
  if (crashPoint !== null && t >= timeTo(crashPoint)) return { round, phase: 'crashed', msLeft: CYCLE_MS - el, t };
  return { round, phase: 'flight', msLeft: CYCLE_MS - el, t };
}
// What happens to a bet {auto} placed in `round` when looked at in `now`, given the crash point.
export function outcome({ round, auto }, crashPoint, now) {
  const t = (now - flightStart(round)) / 1000;
  if (auto && crashPoint >= auto) { if (t >= timeTo(auto) - 0.05) return { done: true, multiplier: auto }; }
  else if (t >= timeTo(crashPoint) || roundNo(now) > round) return { done: true, multiplier: 0 };
  if (roundNo(now) > round) return { done: true, multiplier: auto && crashPoint >= auto ? auto : 0 };
  return { done: false, multiplier: multiplierAt(t) };
}
