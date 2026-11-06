import { describe, it, expect } from 'vitest';
import * as liveDogs from '../server/liveDogs.js';
import { DOGS } from '../server/dogs.js';

describe('live dogs forecast (1st-2nd) bets', () => {
  it('accepts only two different dogs', () => {
    expect(liveDogs.validRunner('F0-1')).toBe(true);
    expect(liveDogs.validRunner('F5-0')).toBe(true);
    expect(liveDogs.validRunner('F2-2')).toBe(false);
    expect(liveDogs.validRunner('F6-1')).toBe(false);
    expect(liveDogs.validRunner('3')).toBe(true);
  });
  it('pays only when both places match', () => {
    const order = [2, 0, 1, 3, 4, 5];
    expect(liveDogs.settle({ 'F2-0': 10 }, order)).toBe(Math.round(10 * liveDogs.forecastOdds(2, 0) * 100) / 100);
    expect(liveDogs.settle({ 'F0-2': 10 }, order)).toBe(0);
    expect(liveDogs.settle({ 'F2-1': 10 }, order)).toBe(0);
    expect(liveDogs.settle({ 2: 10, 'F2-0': 10 }, order)).toBeGreaterThan(liveDogs.settle({ 2: 10 }, order));
  });
  it('keeps the 95% return: probabilities of all 30 combinations sum to 1 and odds*prob ~ 0.95', () => {
    let total = 0;
    for (let a = 0; a < 6; a += 1) for (let b = 0; b < 6; b += 1) {
      if (a === b) continue;
      const pr = (DOGS[a].p * DOGS[b].p) / (1 - DOGS[a].p);
      total += pr;
      expect(liveDogs.forecastOdds(a, b) * pr).toBeLessThanOrEqual(0.95 + 1e-9);
      expect(liveDogs.forecastOdds(a, b) * pr).toBeGreaterThan(0.93);
    }
    expect(Math.abs(total - 1)).toBeLessThan(1e-9);
  });
});
