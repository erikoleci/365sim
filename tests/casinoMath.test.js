import { describe, it, expect } from 'vitest';
import { plinkoMultipliers, plinkoRtp, PLINKO_ROWS, PLINKO_RISKS, minesMultiplier, dragonTigerPayout } from '../server/casinoMath.js';

describe('plinko', () => {
  it('every rows/risk table returns ~97% (never above 100%)', () => {
    for (const rows of PLINKO_ROWS) for (const risk of PLINKO_RISKS) {
      const rtp = plinkoRtp(rows, risk);
      expect(rtp).toBeGreaterThan(0.95);
      expect(rtp).toBeLessThan(0.99);
    }
  });
  it('edges pay more than the centre, and HIGH risk pays more at the edge than LOW', () => {
    const low = plinkoMultipliers(16, 'LOW'), high = plinkoMultipliers(16, 'HIGH');
    expect(low[0]).toBeGreaterThan(low[8]);
    expect(high[0]).toBeGreaterThan(low[0]);
    expect(high[8]).toBeLessThan(low[8]);
  });
});

describe('mines', () => {
  it('starts at 1x and never pays more than the fair odds', () => {
    expect(minesMultiplier(3, 0)).toBe(1);
    // 1 mine, 1 reveal: fair = 25/24 -> 1.0416..; 97% of it is below 1.01 -> house edge shows
    expect(minesMultiplier(1, 1)).toBeLessThan(25 / 24);
    expect(minesMultiplier(5, 3)).toBeGreaterThan(minesMultiplier(5, 2));
    expect(minesMultiplier(10, 2)).toBeGreaterThan(minesMultiplier(3, 2));
  });
});

describe('dragon tiger', () => {
  it('pays 2x on a win, loses on the other side, half back on a tie bet against Dragon/Tiger', () => {
    expect(dragonTigerPayout('DRAGON', 10, 4, 100)).toEqual({ result: 'DRAGON', payout: 200 });
    expect(dragonTigerPayout('TIGER', 10, 4, 100)).toEqual({ result: 'DRAGON', payout: 0 });
    expect(dragonTigerPayout('DRAGON', 7, 7, 100)).toEqual({ result: 'TIE', payout: 50 });
    expect(dragonTigerPayout('TIE', 7, 7, 100)).toEqual({ result: 'TIE', payout: 1600 });
  });
  it('RTP of the three bets with one 52-card deck is below 100%', () => {
    let d = 0, t = 0, tie = 0, n = 0;
    for (let a = 0; a < 52; a += 1) for (let b = 0; b < 52; b += 1) {
      if (a === b) continue; n += 1;
      const ra = (a % 13) + 1, rb = (b % 13) + 1;
      d += dragonTigerPayout('DRAGON', ra, rb, 1).payout; t += dragonTigerPayout('TIGER', ra, rb, 1).payout; tie += dragonTigerPayout('TIE', ra, rb, 1).payout;
    }
    for (const total of [d, t, tie]) expect(total / n).toBeLessThan(1);
  });
});
