// LIVE HORSE RACE: one shared race every 45 seconds (30 s betting). Same horses as the single-player race; odds change every race.
import { HORSES, drawOrder, horsesFor } from './horses.js';
export const CYCLE_MS = 45000;
export const BET_MS = 30000;
export const MAX_TABLE_BET = 5000;
export const roundNo = (now = Date.now()) => Math.floor(now / CYCLE_MS);
export function phaseAt(now = Date.now()) {
  const e = now % CYCLE_MS;
  return e < BET_MS ? { phase: 'betting', msLeft: BET_MS - e } : { phase: 'race', msLeft: CYCLE_MS - e };
}
// Rounds before this keep the old fixed odds (bets placed before the change settle as promised).
export const VARY_FROM_ROUND = Math.floor(Date.UTC(2026, 10, 12, 0, 0, 0) / CYCLE_MS);
export const horsesForRound = (round) => (round === undefined || round < VARY_FROM_ROUND ? HORSES : horsesFor(round + 7));
export const validHorse = (k) => /^[0-5]$/.test(k);
export const draw = (randInt, round) => drawOrder(randInt, horsesForRound(round));
// bets: { '2': 100, ... } horse id -> stake. Only the winner pays.
export const settle = (bets, order, round) => {
  const horses = horsesForRound(round);
  return Math.round(Object.entries(bets).reduce((a, [h, amt]) => a + (order[0] === Number(h) ? amt * horses[Number(h)].odds : 0), 0) * 100) / 100;
};
