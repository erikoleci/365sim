// HORSE RACE: six horses with fixed win chances. The server draws the full finishing order (Plackett-Luce: each place is
// drawn from the horses still running, weighted by their strength) so the winner is exactly as likely as the odds imply.
import { varyRunners, drawOrderFor } from './raceOdds.js';
export const HORSE_RTP = 0.95;
export const HORSES = [
  { id: 0, name: 'Thunder Bolt', p: 0.30, color: '#ef4444' },
  { id: 1, name: 'Golden Arrow', p: 0.22, color: '#eab308' },
  { id: 2, name: 'Night Storm', p: 0.17, color: '#6366f1' },
  { id: 3, name: 'Emerald Wind', p: 0.14, color: '#22c55e' },
  { id: 4, name: 'Crimson Flash', p: 0.10, color: '#ec4899' },
  { id: 5, name: 'Silver Ghost', p: 0.07, color: '#94a3b8' },
].map((h) => ({ ...h, odds: Math.floor((HORSE_RTP / h.p) * 100) / 100 }));

/** The horses for one particular race: same names, new chances and odds. */
export const horsesFor = (seed, rtp = HORSE_RTP) => varyRunners(HORSES, seed, rtp);
export function drawOrder(randInt, horses = HORSES) { return drawOrderFor(horses, randInt); }
export const horsePayout = (stake, horseId, order, horses = HORSES) => (order[0] === horseId ? Math.round(stake * horses[horseId].odds * 100) / 100 : 0);
