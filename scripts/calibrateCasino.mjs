// Measures, for every 'outcome' game, how its natural rounds behave: the share of rounds that pay anything (pWin) and the
// mean payout of those rounds (meanWin, in stakes). server/casinoProfiles.js uses meanWin to set the payout factor so the
// configured RTP is exact in the long run. The draws use a fixed seed, so running this again gives the same file.
// Run:  node scripts/calibrateCasino.mjs [rounds]      (writes server/casinoCalibration.json)
import fs from 'node:fs';
import { SLOT_GAMES } from '../server/slots/games.js';
import { playRound as slotRound } from '../server/slots/engine.js';
import * as tumble from '../server/slots/tumble.js';
import * as holdwin from '../server/holdwin.js';
import { GAMES as SUPER, spinReels, multiplierFor } from '../server/slots.js';
import { WHEEL_SEGMENTS } from '../server/wheel.js';
import { SCRATCH_TIERS } from '../server/scratch.js';
import { mulberry32 } from '../server/raceOdds.js';

const N = Number(process.argv[2]) || 1_000_000;
// Winning payouts are also kept as a histogram `dist` = [[mean payout of the bin, rounds in the bin], ...] (log bins, 4% wide).
// server/casinoProfiles.js uses it to compute, for any hit frequency / RTP / volatility / max win, the exact payout factor
// and the expected distribution shown in the Admin Panel.
const BIN = Math.log(1.04);
const stats = (xs) => { // xs: iterator of multipliers
  let n = 0; let wins = 0; let sum = 0; let sumSq = 0; let max = 0; const bins = new Map();
  for (const m of xs) {
    n += 1; sum += m; sumSq += m * m; if (m > max) max = m;
    if (m > 0) { wins += 1; const b = Math.round(Math.log(m) / BIN); const e = bins.get(b) || [0, 0]; e[0] += m; e[1] += 1; bins.set(b, e); }
  }
  const mean = sum / n;
  return { rounds: n, pWin: wins / n, meanWin: wins ? sum / wins : 0, rtpNat: mean, sd: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), max,
    dist: [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([, [s, c]]) => [Number((s / c).toFixed(4)), c]) };
};
const rngFor = (seed) => { const r = mulberry32(seed); return (n) => Math.floor(r() * n); };
function* gen(count, f) { for (let i = 0; i < count; i += 1) yield f(); }

const out = {};
let seed = 1;
for (const g of SLOT_GAMES) { const rng = rngFor(seed++); out[`slot:${g.id}`] = { ...stats(gen(N, () => slotRound(g, rng).totalMultiplier)), method: 'seeded simulation' }; }
{ const rng = rngFor(seed++); out.tumble = { ...stats(gen(N, () => tumble.playRound(rng).totalMultiplier)), method: 'seeded simulation' }; }
{ const rng = rngFor(seed++); out.holdwin = { ...stats(gen(N, () => holdwin.playRound(rng).multiplier)), method: 'seeded simulation' }; }
{ const rng = rngFor(seed++); const g = SUPER.fruit; out.slots = { ...stats(gen(N, () => multiplierFor(g, spinReels(g, rng)))), method: 'seeded simulation' }; }
{ // wheel: exact, every segment equally likely
  const xs = WHEEL_SEGMENTS; const n = xs.length; const wins = xs.filter((m) => m > 0);
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  out.wheel = { rounds: n, pWin: wins.length / n, meanWin: wins.reduce((a, b) => a + b, 0) / wins.length, rtpNat: mean, sd: Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / n - mean * mean), max: Math.max(...xs), method: 'exact', dist: Object.entries(wins.reduce((a, m) => { a[m] = (a[m] || 0) + 1; return a; }, {})).map(([m, c]) => [Number(m), c]).sort((a, b) => a[0] - b[0]) };
}
{ // scratch: exact from the tier weights
  const total = SCRATCH_TIERS.reduce((a, t) => a + t.weight, 0);
  const wins = SCRATCH_TIERS.filter((t) => t.multiplier > 0);
  const wTotal = wins.reduce((a, t) => a + t.weight, 0);
  const mean = SCRATCH_TIERS.reduce((a, t) => a + (t.multiplier * t.weight) / total, 0);
  out.scratch = { rounds: total, pWin: wTotal / total, meanWin: wins.reduce((a, t) => a + t.multiplier * t.weight, 0) / wTotal, rtpNat: mean,
    sd: Math.sqrt(SCRATCH_TIERS.reduce((a, t) => a + (t.multiplier ** 2 * t.weight) / total, 0) - mean * mean), max: Math.max(...wins.map((t) => t.multiplier)), method: 'exact', dist: wins.map((t) => [t.multiplier, t.weight]).sort((a, b) => a[0] - b[0]) };
}
for (const v of Object.values(out)) for (const k of ['pWin', 'meanWin', 'rtpNat', 'sd']) v[k] = Number(v[k].toFixed(6));
fs.writeFileSync(new URL('../server/casinoCalibration.json', import.meta.url), `${JSON.stringify(out)}\n`);
console.log(`calibrated ${Object.keys(out).length} games with ${N} rounds each`);
