import { describe, it, expect } from 'vitest';
import { fairCrashPoint, CRASH_MAX } from '../server/routes/casino.js';

describe('fairCrashPoint', () => {
  it('is 1.00 at the bottom of the range, capped at the top, and rounds to 2 decimals', () => {
    expect(fairCrashPoint(0)).toBe(1);
    expect(fairCrashPoint(0.5)).toBe(1.98);
    expect(fairCrashPoint(0.9999999)).toBe(CRASH_MAX);
  });
  it('reaches x with probability ~0.99 / x (1% house edge)', () => {
    const n = 40000; let ge2 = 0; let ge10 = 0; let one = 0;
    for (let i = 0; i < n; i++) { const c = fairCrashPoint(); if (c >= 2) ge2++; if (c >= 10) ge10++; if (c === 1) one++; }
    expect(ge2 / n).toBeGreaterThan(0.46); expect(ge2 / n).toBeLessThan(0.53);
    expect(ge10 / n).toBeGreaterThan(0.08); expect(ge10 / n).toBeLessThan(0.115);
    expect(one / n).toBeLessThan(0.03);
  });
});
