import { randomInt } from 'crypto';

// Pure slot maths — no database, no HTTP. Everything the server needs to play one paid round of a
// 5x3, 10-payline video slot with wilds and scatter-triggered free spins.
//
// The paytable a game advertises is the paytable that is paid: there is no hidden outcome control
// anywhere in this file. Every cell of every reel is an independent weighted draw, so a game's RTP
// follows directly from its symbol weights and pays (see tests/slotEngine.test.js, which measures it).

export const REELS = 5;
export const ROWS = 3;

// Row index (0 = top) hit on each reel, for each of the 10 paylines.
export const PAYLINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0],
];

export const defaultRng = (n) => randomInt(0, n);

const round2 = (n) => Number(n.toFixed(2));

// Cumulative weight tables per reel, built once per game config.
const tableCache = new WeakMap();
function reelTables(game) {
  let tables = tableCache.get(game);
  if (tables) return tables;
  tables = Array.from({ length: REELS }, (_, reel) => {
    const entries = [];
    for (const s of game.symbols) entries.push({ id: s.id, weight: s.weight });
    if (game.wild.reels.includes(reel)) entries.push({ id: 'wild', weight: game.wild.weight });
    entries.push({ id: 'scatter', weight: game.scatter.weight });
    let total = 0;
    const cum = entries.map((e) => ({ id: e.id, upTo: (total += e.weight) }));
    return { cum, total };
  });
  tableCache.set(game, tables);
  return tables;
}

// grid[reel][row] -> symbol id ('wild' / 'scatter' are reserved ids).
export function spinGrid(game, rng = defaultRng) {
  const tables = reelTables(game);
  return tables.map(({ cum, total }) =>
    Array.from({ length: ROWS }, () => {
      const r = rng(total);
      return cum.find((c) => r < c.upTo).id;
    })
  );
}

const paysFor = (game, symbolId, count) => {
  const sym = game.symbols.find((s) => s.id === symbolId);
  if (!sym || count < 3) return 0;
  return sym.pays[count - 3] || 0;
};

// Scores a grid at a given total stake (split evenly across all paylines).
// Lines pay left to right from reel 1, 3+ of a kind; wilds substitute for every symbol except
// scatter. The scatter pays anywhere (x total stake) and can start free spins.
export function evaluateGrid(game, grid, stake) {
  const lineBet = stake / PAYLINES.length;
  const wins = [];

  PAYLINES.forEach((line, lineIndex) => {
    const cells = line.map((row, reel) => grid[reel][row]);
    const target = cells[0];
    // Wild never lands on reel 1 and scatter never counts toward a line.
    if (target === 'scatter' || target === 'wild') return;
    let count = 1;
    while (count < REELS && (cells[count] === target || cells[count] === 'wild')) count++;
    const multiplier = paysFor(game, target, count);
    if (multiplier > 0) {
      wins.push({
        line: lineIndex + 1,
        symbol: target,
        count,
        multiplier,
        amount: round2(multiplier * lineBet),
        positions: line.slice(0, count).map((row, reel) => [reel, row]),
      });
    }
  });

  let scatterCount = 0;
  const scatterPositions = [];
  grid.forEach((col, reel) =>
    col.forEach((id, row) => {
      if (id === 'scatter') {
        scatterCount++;
        scatterPositions.push([reel, row]);
      }
    })
  );
  const scatterMultiplier = game.scatter.pays[Math.min(scatterCount, 5)] || 0;
  const scatterWin = scatterMultiplier > 0
    ? { count: scatterCount, multiplier: scatterMultiplier, amount: round2(scatterMultiplier * stake), positions: scatterPositions }
    : null;

  const total = round2(wins.reduce((sum, w) => sum + w.amount, 0) + (scatterWin ? scatterWin.amount : 0));
  return { wins, scatter: scatterWin, scatterCount, total };
}

// Plays one paid spin plus any free spins it triggers. Free spins cost nothing, pay with the game's
// free-spin multiplier and cannot be retriggered. Returns everything the client needs to animate it.
export function playSlotRound(game, stake, rng = defaultRng) {
  const grid = spinGrid(game, rng);
  const base = evaluateGrid(game, grid, stake);
  let payout = base.total;

  let freeSpins = null;
  const awarded = game.scatter.freeSpins[Math.min(base.scatterCount, 5)] || 0;
  if (awarded > 0) {
    const spins = [];
    let freeTotal = 0;
    for (let i = 0; i < awarded; i++) {
      const g = spinGrid(game, rng);
      const ev = evaluateGrid(game, g, stake);
      // Scatter symbols still pay in a free spin but never extend the feature.
      const raw = ev.total;
      const win = round2(raw * game.scatter.multiplier);
      freeTotal = round2(freeTotal + win);
      spins.push({ grid: g, wins: ev.wins, scatter: ev.scatter, win });
    }
    freeSpins = { count: awarded, multiplier: game.scatter.multiplier, spins, totalWin: freeTotal };
    payout = round2(payout + freeTotal);
  }

  return { grid, wins: base.wins, scatter: base.scatter, baseWin: base.total, freeSpins, payout };
}
