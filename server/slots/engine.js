// Video-slot engine: N reels (3 to 7) x 3 rows, paylines, wild, scatter -> free spins. A game that sets nothing is the
// classic 5 reels x 10 paylines; `game.reels` and `game.paylines` give the others.
// Everything here is pure: the randomness is injected (`rng(n)` returns an integer in [0, n)), so the same code
// drives the real spins (crypto RNG), the RTP calculation and the tests.
export const REELS = 5;
export const ROWS = 3;
export const PAYLINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0],
];
// Paylines for a layout other than the classic one: every path over the 3 rows that moves at most one row between
// neighbouring reels, calmest first, then `count` of them picked evenly (so the set mixes straight and zig-zag lines).
export function smoothLines(reels, count) {
  const paths = [];
  const walk = (acc) => {
    if (acc.length === reels) { paths.push(acc); return; }
    for (const d of [0, -1, 1]) { const n = acc[acc.length - 1] + d; if (n >= 0 && n <= 2) walk([...acc, n]); }
  };
  [0, 1, 2].forEach((r) => walk([r]));
  const changes = (l) => l.reduce((a, v, i) => a + (i && v !== l[i - 1] ? 1 : 0), 0);
  paths.sort((a, b) => changes(a) - changes(b) || a.join('').localeCompare(b.join('')));
  const n = Math.min(count, paths.length);
  return Array.from({ length: n }, (_, i) => paths[Math.floor((i * paths.length) / n)]);
}
export const linesOf = (game) => game.paylines || PAYLINES;
export const WILD = 'WILD';
export const SCATTER = 'SCATTER';

// grid[reel][row]. Each reel shows 3 consecutive symbols of its strip, starting at `stop`.
export function gridFromStops(game, stops) {
  return game.strips.map((strip, r) => [0, 1, 2].map((row) => strip[(stops[r] + row) % strip.length]));
}

// Expanding wild: a reel that shows a wild becomes wild on all three rows (games with `wildExpand`).
export function expandWilds(game, grid) {
  if (!game.wildExpand) return grid;
  return grid.map((col) => (col.includes(WILD) ? [WILD, WILD, WILD] : col));
}

// Line wins, left to right. A wild substitutes for every symbol except the scatter. Pays are multiples of the
// bet of one line (total stake / number of lines). The best of "wild line" and "symbol line" is paid, once.
export function evaluateLines(game, grid) {
  const wins = [];
  linesOf(game).forEach((line, idx) => {
    const syms = line.map((row, reel) => grid[reel][row]);
    let base = null;
    for (const s of syms) { if (s !== WILD) { base = s; break; } }
    let count = 0;
    if (base === SCATTER) return;
    for (const s of syms) { if (s === base || s === WILD) count += 1; else break; }
    const wildCount = (() => { let n = 0; for (const s of syms) { if (s === WILD) n += 1; else break; } return n; })();
    let best = 0; let bestSym = null; let bestCount = 0;
    if (base && count >= 3 && game.paytable[base]?.[count]) { best = game.paytable[base][count]; bestSym = base; bestCount = count; }
    if (wildCount >= 3 && game.paytable[WILD]?.[wildCount] > best) { best = game.paytable[WILD][wildCount]; bestSym = WILD; bestCount = wildCount; }
    if (best > 0) wins.push({ line: idx, symbol: bestSym, count: bestCount, pay: best });
  });
  return wins;
}

export const countScatters = (grid) => grid.reduce((n, col) => n + col.filter((s) => s === SCATTER).length, 0);

// One spin. `free` = a free spin: pays the free-spin multiplier, scatters neither pay nor retrigger.
export function playSpin(game, rng, { free = false } = {}) {
  const stops = game.strips.map((strip) => rng(strip.length));
  const grid = expandWilds(game, gridFromStops(game, stops));
  const wins = evaluateLines(game, grid);
  const scatters = countScatters(grid);
  const mult = free ? game.freeSpinMultiplier : 1;
  const linePay = wins.reduce((a, w) => a + w.pay, 0) * mult;          // in line bets
  const scatterPay = free ? 0 : (game.scatterPay[scatters] ?? 0);       // in TOTAL bets
  const freeSpinsAwarded = free ? 0 : (game.freeSpins[scatters] ?? 0);
  return { stops, grid, wins, scatters, linePay, scatterPay, freeSpinsAwarded };
}

// A whole round: the base spin and, when it triggers them, all of its free spins. Returns the spins in order
// and the total win in TOTAL bets (stake = 1).
export function playRound(game, rng) {
  const spins = [];
  const first = playSpin(game, rng);
  spins.push({ ...first, free: false, win: first.linePay / linesOf(game).length + first.scatterPay });
  let total = spins[0].win;
  for (let i = 0; i < first.freeSpinsAwarded; i += 1) {
    const s = playSpin(game, rng, { free: true });
    const win = s.linePay / linesOf(game).length;
    spins.push({ ...s, free: true, win });
    total += win;
  }
  return { spins, totalMultiplier: total };
}

// Exact RTP by enumerating every combination of reel stops (reels are short on purpose, so this is cheap).
// Free spins use the same reels, so their expected value is closed-form: E[spins] x E[free spin].
export function exactRtp(game) {
  const lens = game.strips.map((x) => x.length);
  let lineBase = 0; let lineFree = 0; let scatterPay = 0; let freeSpinsExpected = 0;
  const total = lens.reduce((a, b) => a * b, 1);
  const stops = lens.map(() => 0);
  for (let n = 0; n < total; n += 1) {
    const grid = expandWilds(game, gridFromStops(game, stops));
    const lw = evaluateLines(game, grid).reduce((x, w) => x + w.pay, 0);
    const sc = countScatters(grid);
    lineBase += lw; scatterPay += game.scatterPay[sc] ?? 0; freeSpinsExpected += game.freeSpins[sc] ?? 0;
    lineFree += lw * game.freeSpinMultiplier;
    for (let r = lens.length - 1; r >= 0; r -= 1) { stops[r] += 1; if (stops[r] < lens[r]) break; stops[r] = 0; }
  }
  const L = linesOf(game).length;
  const baseEv = lineBase / total / L + scatterPay / total;
  const freeEvPerSpin = lineFree / total / L;
  const rtp = baseEv + (freeSpinsExpected / total) * freeEvPerSpin;
  return { rtp, baseEv, freeShare: ((freeSpinsExpected / total) * freeEvPerSpin) / rtp, freeTriggerPerSpin: undefined, combos: total };
}
