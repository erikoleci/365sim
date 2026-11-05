// Scratch card: 9 cells; three equal prizes win that multiplier. The outcome tier is drawn first (like a printed card),
// then a grid that shows exactly that result is laid out (a losing card never shows three equal prizes).
export const SCRATCH_TIERS = [
  { multiplier: 0, weight: 7150 }, { multiplier: 1, weight: 1400 }, { multiplier: 2, weight: 800 },
  { multiplier: 5, weight: 420 }, { multiplier: 10, weight: 180 }, { multiplier: 50, weight: 50 },
];
const TOTAL = SCRATCH_TIERS.reduce((a, t) => a + t.weight, 0);
export const SCRATCH_VALUES = [1, 2, 5, 10, 50, 100];
export const scratchRtp = () => SCRATCH_TIERS.reduce((a, t) => a + (t.multiplier * t.weight) / TOTAL, 0);

export function scratchCard(rng) {
  let pick = rng(TOTAL); let tier = SCRATCH_TIERS[0];
  for (const t of SCRATCH_TIERS) { if (pick < t.weight) { tier = t; break; } pick -= t.weight; }
  const counts = new Map(); const cells = [];
  const add = (v) => { cells.push(v); counts.set(v, (counts.get(v) || 0) + 1); };
  if (tier.multiplier > 0) for (let i = 0; i < 3; i += 1) add(tier.multiplier);
  while (cells.length < 9) {
    const v = SCRATCH_VALUES[rng(SCRATCH_VALUES.length)];
    if ((counts.get(v) || 0) < 2) add(v);   // filler: never three of a kind
  }
  for (let i = cells.length - 1; i > 0; i -= 1) { const j = rng(i + 1); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  return { cells, multiplier: tier.multiplier };
}
