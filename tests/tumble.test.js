import { describe, it, expect } from 'vitest';
import { findWins, tumble, playRound, playSpin, simulateRtp, COLS, ROWS, MIN_CLUSTER, MAX_WIN_MULTIPLIER, PAYTABLE } from '../server/slots/tumble.js';

const seeded = (seed) => { let s = seed >>> 0; return (n) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; s ^= s >>> 13; return Math.floor(((s >>> 0) / 4294967296) * n); }; };
const gridOf = (fill) => Array.from({ length: COLS }, (_, c) => Array.from({ length: ROWS }, (_, r) => fill(c, r)));

describe('sugar cascade', () => {
  it('pays 8+ of a symbol anywhere, nothing below 8', () => {
    const g = gridOf((c, r) => (c * ROWS + r < 8 ? 'CAKE' : 'GUMMY'));
    const wins = findWins(g);
    const cake = wins.find((w) => w.symbol === 'CAKE');
    expect(cake.count).toBe(8); expect(cake.pay).toBe(PAYTABLE.CAKE[0]);
    const seven = gridOf((c, r) => (c * ROWS + r < 7 ? 'CAKE' : (c + r) % 2 ? 'GUMMY' : 'LOLLI'));
    expect(findWins(seven).find((w) => w.symbol === 'CAKE')).toBeUndefined();
  });
  it('tumble removes the winners, drops the rest and refills to a full grid', () => {
    const g = gridOf((c, r) => (r === 0 ? 'CAKE' : 'GUMMY'));
    const w = [{ symbol: 'GUMMY', count: 0, pay: 0, cells: Array.from({ length: COLS }, (_, c) => [c, ROWS - 1]) }];
    const next = tumble(g, w, seeded(5));
    next.forEach((col) => expect(col).toHaveLength(ROWS));
    next.forEach((col) => expect(col[ROWS - 1]).toBe(g[0][ROWS - 2])); // what was above the removed cell fell down
  });
  it('a round is consistent: total = sum of spins, free spins only after 4+ scatters, capped', () => {
    const rng = seeded(99);
    for (let i = 0; i < 4000; i += 1) {
      const r = playRound(rng);
      expect(r.totalMultiplier).toBeLessThanOrEqual(MAX_WIN_MULTIPLIER);
      const sum = r.spins.reduce((a, s) => a + s.win + (s.scatterWin || 0), 0);
      expect(Math.min(sum, MAX_WIN_MULTIPLIER)).toBeCloseTo(r.totalMultiplier, 6);
      if (r.freeSpins > 0) expect(r.spins[0].scatters).toBeGreaterThanOrEqual(4);
      r.spins.forEach((s) => s.steps.forEach((st) => { expect(st.wins.every((w) => w.count >= MIN_CLUSTER)).toBe(true); st.grid.forEach((col) => expect(col).toHaveLength(ROWS)); }));
    }
  });
  it('free-spin multiplier grows with every winning tumble', () => {
    const s = playSpin(seeded(3), { free: true, startMult: 1 });
    s.steps.forEach((st, i) => expect(st.multiplier).toBe(1 + i));
  });
  it('return to player is about 94% (Monte Carlo, fixed seed)', () => {
    const r = simulateRtp(300000, seeded(2024));
    expect(r.rtp).toBeGreaterThan(0.88); expect(r.rtp).toBeLessThan(1.0);
    expect(r.hitRate).toBeGreaterThan(0.4);
  });
});
