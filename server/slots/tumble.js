// "Sugar Cascade": a 6x5 scatter-pays slot with tumbles. 8 or more of the same symbol ANYWHERE on the grid pay;
// the winning symbols disappear, the ones above fall down, new ones drop in, and it repeats while there is a win.
// 4+ scatters give free spins; in free spins every tumble that wins raises a multiplier that stays for the round.
// Pure: randomness is injected (`rng(n)` -> integer in [0, n)), so it drives the real spins, the RTP check and tests.
export const COLS = 6;
export const ROWS = 5;
export const MIN_CLUSTER = 8;
export const SCATTER = 'SCATTER';
export const MAX_WIN_MULTIPLIER = 5000;
export const FREE_SPINS = 10;

export const TUMBLE_SYMBOLS = ['GUMMY', 'LOLLI', 'DONUT', 'CUPCAKE', 'ICECREAM', 'CAKE', 'CHOCO'];
// drawing weights per cell (symbols are drawn independently, with replacement)
export const WEIGHTS = { GUMMY: 24, LOLLI: 22, DONUT: 20, CUPCAKE: 18, ICECREAM: 15, CAKE: 12, CHOCO: 9, SCATTER: 2.2 };
// pay in multiples of the TOTAL stake for 8-9 / 10-11 / 12+ of a symbol (before the free-spin multiplier)
export const PAYTABLE = {
  GUMMY: [0.11, 0.28, 1.24], LOLLI: [0.15, 0.4, 1.58], DONUT: [0.2, 0.56, 2.49], CUPCAKE: [0.29, 0.9, 4.07],
  ICECREAM: [0.51, 1.58, 6.78], CAKE: [1.02, 2.94, 13.56], CHOCO: [2.15, 6.78, 36.16],
};
export const SCATTER_PAY = { 4: 3, 5: 5, 6: 100 };
const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
const ORDER = [...TUMBLE_SYMBOLS, SCATTER];

export function drawSymbol(rng) {
  let r = (rng(1_000_000) / 1_000_000) * TOTAL_WEIGHT;
  for (const s of ORDER) { r -= WEIGHTS[s]; if (r < 0) return s; }
  return TUMBLE_SYMBOLS[0];
}
// grid[col][row], row 0 = top
export const freshGrid = (rng) => Array.from({ length: COLS }, () => Array.from({ length: ROWS }, () => drawSymbol(rng)));
const tier = (n) => (n >= 12 ? 2 : n >= 10 ? 1 : 0);

// The symbols that pay on this grid: [{ symbol, count, pay, cells: [[col,row]...] }]
export function findWins(grid) {
  const cells = {};
  grid.forEach((col, c) => col.forEach((s, r) => { if (s !== SCATTER) (cells[s] ||= []).push([c, r]); }));
  return Object.entries(cells).filter(([, list]) => list.length >= MIN_CLUSTER)
    .map(([symbol, list]) => ({ symbol, count: list.length, pay: PAYTABLE[symbol][tier(list.length)], cells: list }));
}
export const countScatters = (grid) => grid.reduce((n, col) => n + col.filter((s) => s === SCATTER).length, 0);

// Remove the winning cells, let the rest fall, fill the top with new symbols.
export function tumble(grid, wins, rng) {
  const gone = new Set(wins.flatMap((w) => w.cells.map(([c, r]) => `${c}-${r}`)));
  return grid.map((col, c) => {
    const kept = col.filter((_, r) => !gone.has(`${c}-${r}`));
    const fresh = Array.from({ length: ROWS - kept.length }, () => drawSymbol(rng));
    return [...fresh, ...kept];
  });
}

// One spin (base or free). Returns the steps for the animation and the win in multiples of the total stake.
// `startMult` is the running multiplier of a free-spin round; it grows by 1 on every winning tumble.
export function playSpin(rng, { free = false, startMult = 1 } = {}) {
  let grid = freshGrid(rng);
  const first = grid;
  const steps = [];
  let mult = startMult; let win = 0;
  for (let guard = 0; guard < 40; guard += 1) {
    const wins = findWins(grid);
    if (wins.length === 0) break;
    const base = wins.reduce((a, w) => a + w.pay, 0);
    const stepMult = free ? mult : 1;
    win += base * stepMult;
    const next = tumble(grid, wins, rng);
    steps.push({ wins: wins.map(({ symbol, count, pay, cells }) => ({ symbol, count, pay, cells })), multiplier: stepMult, win: base * stepMult, grid: next });
    if (free) mult += 1;
    grid = next;
  }
  // scatters count over everything that was on the board during the spin (the first grid plus every refill)
  const scatters = Math.max(countScatters(first), ...steps.map((s) => countScatters(s.grid)));
  return { first, steps, scatters, win, endMult: mult };
}

// A whole round: the base spin and, if 4+ scatters land, 10 free spins (+5 more for 3+ scatters inside them, up to 30).
export function playRound(rng) {
  const spins = [];
  const base = playSpin(rng);
  const scatterWin = SCATTER_PAY[Math.min(base.scatters, 6)] || 0;
  spins.push({ ...base, free: false, scatterWin });
  let total = base.win + scatterWin;
  if (base.scatters >= 4) {
    let left = FREE_SPINS; let given = FREE_SPINS; let mult = 1;
    while (left > 0) {
      left -= 1;
      const s = playSpin(rng, { free: true, startMult: mult });
      mult = s.endMult;
      spins.push({ ...s, free: true, scatterWin: 0 });
      total += s.win;
      if (s.scatters >= 3 && given < 30) { left += 5; given += 5; }
      if (total >= MAX_WIN_MULTIPLIER) break;
    }
  }
  return { spins, totalMultiplier: Math.min(total, MAX_WIN_MULTIPLIER), freeSpins: spins.length - 1 };
}

// Monte Carlo RTP (there are far too many grids to enumerate); a seeded generator makes it repeatable.
export function simulateRtp(rounds, rng) {
  let total = 0; let hits = 0; let freeRounds = 0; let max = 0;
  for (let i = 0; i < rounds; i += 1) {
    const r = playRound(rng);
    total += r.totalMultiplier; if (r.totalMultiplier > 0) hits += 1; if (r.freeSpins > 0) freeRounds += 1; if (r.totalMultiplier > max) max = r.totalMultiplier;
  }
  return { rtp: total / rounds, hitRate: hits / rounds, freeRate: freeRounds / rounds, max };
}
