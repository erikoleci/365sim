// LIVE DOG RACE: one shared race every 40 seconds (25 s betting).
import { DOGS, drawOrder } from './dogs.js';
export const RUNNERS = DOGS;
export const CYCLE_MS = 40000;
export const BET_MS = 25000;
export const MAX_TABLE_BET = 5000;
export const roundNo = (now = Date.now()) => Math.floor(now / CYCLE_MS);
export function phaseAt(now = Date.now()) {
  const e = now % CYCLE_MS;
  return e < BET_MS ? { phase: 'betting', msLeft: BET_MS - e } : { phase: 'race', msLeft: CYCLE_MS - e };
}
export const validRunner = (k) => /^[0-5]$/.test(k);
export const draw = (randInt) => drawOrder(randInt);
export const settle = (bets, order) => Math.round(Object.entries(bets).reduce((a, [h, amt]) => a + (order[0] === Number(h) ? amt * DOGS[Number(h)].odds : 0), 0) * 100) / 100;
