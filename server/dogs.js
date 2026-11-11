// DOG RACE: six greyhounds in traps 1-6. The finishing order is drawn on the server (same Plackett-Luce method as the horses).
import { varyRunners, drawOrderFor } from './raceOdds.js';
export const DOG_RTP = 0.95;
export const DOGS = [
  { id: 0, name: 'Red Rocket', trap: 1, p: 0.28, color: '#ef4444' },
  { id: 1, name: 'Blue Bolt', trap: 2, p: 0.21, color: '#3b82f6' },
  { id: 2, name: 'White Shadow', trap: 3, p: 0.17, color: '#f1f5f9' },
  { id: 3, name: 'Green Flash', trap: 4, p: 0.14, color: '#22c55e' },
  { id: 4, name: 'Yellow Storm', trap: 5, p: 0.12, color: '#eab308' },
  { id: 5, name: 'Purple Comet', trap: 6, p: 0.08, color: '#a855f7' },
].map((d) => ({ ...d, odds: Math.floor((DOG_RTP / d.p) * 100) / 100 }));

/** The dogs for one particular race: same names and traps, new chances and odds. */
export const dogsFor = (seed, rtp = DOG_RTP) => varyRunners(DOGS, seed, rtp);
export function drawOrder(randInt, dogs = DOGS) { return drawOrderFor(dogs, randInt); }
export const dogPayout = (stake, id, order, dogs = DOGS) => (order[0] === id ? Math.round(stake * dogs[id].odds * 100) / 100 : 0);
