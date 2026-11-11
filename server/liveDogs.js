// LIVE DOG RACE: one shared race every 40 seconds (25 s betting).
import { DOGS, DOG_RTP, drawOrder, dogsFor } from './dogs.js';
export const RUNNERS = DOGS;
export const CYCLE_MS = 40000;
export const BET_MS = 25000;
export const MAX_TABLE_BET = 5000;
export const roundNo = (now = Date.now()) => Math.floor(now / CYCLE_MS);
export function phaseAt(now = Date.now()) {
  const e = now % CYCLE_MS;
  return e < BET_MS ? { phase: 'betting', msLeft: BET_MS - e } : { phase: 'race', msLeft: CYCLE_MS - e };
}
// From this round on every race has its own chances and odds. Earlier rounds (bets placed before the change) keep the old fixed odds.
export const VARY_FROM_ROUND = Math.floor(Date.UTC(2026, 10, 12, 0, 0, 0) / CYCLE_MS);
export const runnersFor = (round) => (round === undefined || round < VARY_FROM_ROUND ? DOGS : dogsFor(round));
// Forecast ("kombinim"): the exact 1st and 2nd dog, key "F<first>-<second>". Plackett-Luce probability p_a * p_b / (1 - p_a), 5% margin like the win bets.
export const forecastOdds = (a, b, runners = DOGS) => Math.floor((DOG_RTP / ((runners[a].p * runners[b].p) / (1 - runners[a].p))) * 100) / 100;
export const forecastFor = (runners) => runners.map((_, a) => runners.map((__, b) => (a === b ? null : forecastOdds(a, b, runners))));
export const FORECAST = forecastFor(DOGS);
const FKEY = /^F([0-5])-([0-5])$/;
export const validRunner = (k) => /^[0-5]$/.test(k) || (FKEY.test(k) && k[1] !== k[3]);
export const draw = (randInt, round) => drawOrder(randInt, runnersFor(round));
export const settle = (bets, order, round) => {
  const runners = runnersFor(round);
  return Math.round(Object.entries(bets).reduce((a, [h, amt]) => {
    const f = FKEY.exec(h);
    if (f) return a + (order[0] === Number(f[1]) && order[1] === Number(f[2]) ? amt * forecastOdds(Number(f[1]), Number(f[2]), runners) : 0);
    return a + (order[0] === Number(h) ? amt * runners[Number(h)].odds : 0);
  }, 0) * 100) / 100;
};
