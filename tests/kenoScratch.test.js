import { describe, it, expect } from 'vitest';
import { KENO_PAYTABLE, kenoRtp, drawKeno, kenoResult, hitProbability } from '../server/keno.js';
import { scratchCard, scratchRtp, SCRATCH_TIERS } from '../server/scratch.js';

const seeded = (seed) => { let s = seed; return (n) => { s = (s * 1664525 + 1013904223) % 4294967296; return Math.floor((s / 4294967296) * n); }; };

describe('keno', () => {
  it('every pick count returns 90-98% of the stakes (exact odds) and the hit odds add up to 1', () => {
    for (let k = 1; k <= 8; k += 1) {
      expect(kenoRtp(k)).toBeGreaterThan(0.9); expect(kenoRtp(k)).toBeLessThan(0.98);
      let sum = 0; for (let h = 0; h <= k; h += 1) sum += hitProbability(k, h);
      expect(sum).toBeCloseTo(1, 9);
    }
  });
  it('never pays more than 1000x the stake', () => {
    for (const k of Object.keys(KENO_PAYTABLE)) for (const m of Object.values(KENO_PAYTABLE[k])) expect(m).toBeLessThanOrEqual(1000);
  });
  it('draws 10 different numbers in 1..40', () => {
    for (let i = 1; i < 50; i += 1) { const d = drawKeno(seeded(i)); expect(new Set(d).size).toBe(10); expect(d.every((n) => n >= 1 && n <= 40)).toBe(true); }
  });
  it('pays by hits', () => {
    const r = kenoResult([1, 2, 3], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.hits).toBe(3); expect(r.multiplier).toBe(KENO_PAYTABLE[3][3]);
    expect(kenoResult([30, 31, 32], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).multiplier).toBe(0);
  });
});

describe('scratch card', () => {
  it('has a house edge', () => { expect(scratchRtp()).toBeGreaterThan(0.9); expect(scratchRtp()).toBeLessThan(1); });
  it('a card shows three of a kind only when it wins, and then exactly the prize', () => {
    const rng = seeded(7);
    for (let i = 0; i < 3000; i += 1) {
      const { cells, multiplier } = scratchCard(rng);
      expect(cells).toHaveLength(9);
      const counts = {}; cells.forEach((c) => { counts[c] = (counts[c] || 0) + 1; });
      const triples = Object.entries(counts).filter(([, n]) => n >= 3).map(([v]) => Number(v));
      if (multiplier === 0) expect(triples).toHaveLength(0); else expect(triples).toEqual([multiplier]);
    }
  });
  it('tiers add up to 10000', () => { expect(SCRATCH_TIERS.reduce((a, t) => a + t.weight, 0)).toBe(10000); });
});
