// LIVE ROULETTE: one shared European wheel that spins every 30 seconds for everybody (20 s betting, then the spin).
// The round number comes from the clock, the winning pocket is drawn by the server when betting closes.
export const CYCLE_MS = 30000;
export const BET_MS = 20000;
export const MAX_TABLE_BET = 5000;
export const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
export const SIMPLE_SPOTS = ['RED', 'BLACK', 'EVEN', 'ODD', 'LOW', 'HIGH', 'D1', 'D2', 'D3'];

export const roundNo = (now = Date.now()) => Math.floor(now / CYCLE_MS);
export function phaseAt(now = Date.now()) {
  const elapsed = now % CYCLE_MS;
  return elapsed < BET_MS ? { phase: 'betting', msLeft: BET_MS - elapsed } : { phase: 'spin', msLeft: CYCLE_MS - elapsed };
}

export const isNumberSpot = (s) => /^\d{1,2}$/.test(s) && Number(s) >= 0 && Number(s) <= 36 && String(Number(s)) === s;
export const validSpot = (s) => isNumberSpot(s) || SIMPLE_SPOTS.includes(s);

// stake multiplier returned when the spot wins (stake included)
export function spotMultiplier(spot, n) {
  if (isNumberSpot(spot)) return Number(spot) === n ? 36 : 0;
  if (n === 0) return 0;
  switch (spot) {
    case 'RED': return RED.includes(n) ? 2 : 0;
    case 'BLACK': return RED.includes(n) ? 0 : 2;
    case 'EVEN': return n % 2 === 0 ? 2 : 0;
    case 'ODD': return n % 2 === 1 ? 2 : 0;
    case 'LOW': return n <= 18 ? 2 : 0;
    case 'HIGH': return n >= 19 ? 2 : 0;
    case 'D1': return n <= 12 ? 3 : 0;
    case 'D2': return n >= 13 && n <= 24 ? 3 : 0;
    case 'D3': return n >= 25 ? 3 : 0;
    default: return 0;
  }
}
export const settleBets = (bets, n) => Math.round(Object.entries(bets).reduce((a, [spot, amt]) => a + amt * spotMultiplier(spot, n), 0) * 100) / 100;
