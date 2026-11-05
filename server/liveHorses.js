// LIVE HORSE RACE: one shared race every 45 seconds (30 s betting). Same horses and odds as the single-player race.
import { HORSES, drawOrder } from './horses.js';
export const CYCLE_MS = 45000;
export const BET_MS = 30000;
export const MAX_TABLE_BET = 5000;
export const roundNo = (now = Date.now()) => Math.floor(now / CYCLE_MS);
export function phaseAt(now = Date.now()) {
  const e = now % CYCLE_MS;
  return e < BET_MS ? { phase: 'betting', msLeft: BET_MS - e } : { phase: 'race', msLeft: CYCLE_MS - e };
}
export const validHorse = (k) => /^[0-5]$/.test(k);
export const draw = (randInt) => drawOrder(randInt);
// bets: { '2': 100, ... } horse id -> stake. Only the winner pays.
export const settle = (bets, order) => Math.round(Object.entries(bets).reduce((a, [h, amt]) => a + (order[0] === Number(h) ? amt * HORSES[Number(h)].odds : 0), 0) * 100) / 100;
