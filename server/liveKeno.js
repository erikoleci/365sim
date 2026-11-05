// LIVE KENO: one shared draw of 10 balls every 30 seconds (20 s to pick and bet). Same paytable as the single-player Keno.
import { KENO_MAX_PICKS, KENO_POOL, drawKeno, kenoResult } from './keno.js';
export const CYCLE_MS = 30000;
export const BET_MS = 20000;
export const MAX_TABLE_BET = 5000;
export const roundNo = (now = Date.now()) => Math.floor(now / CYCLE_MS);
export function phaseAt(now = Date.now()) {
  const e = now % CYCLE_MS;
  return e < BET_MS ? { phase: 'betting', msLeft: BET_MS - e } : { phase: 'draw', msLeft: CYCLE_MS - e };
}
export const validPicks = (p) => Array.isArray(p) && p.length >= 1 && p.length <= KENO_MAX_PICKS && p.every((n) => Number.isInteger(n) && n >= 1 && n <= KENO_POOL) && new Set(p).size === p.length;
export const draw = (randInt) => drawKeno(randInt);
export const multiplierFor = (picks, drawn) => kenoResult(picks, drawn);
