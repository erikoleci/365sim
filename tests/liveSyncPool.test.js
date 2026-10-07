import { describe, it, expect } from 'vitest';
import { runPool } from '../server/london365.js';

describe('runPool (bounded parallelism for the live loop)', () => {
  it('never exceeds the concurrency limit and processes every item exactly once', async () => {
    let inFlight = 0, peak = 0;
    const seen = [];
    await runPool([...Array(25).keys()], 4, async (n) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(n); inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(seen.sort((a, b) => a - b)).toEqual([...Array(25).keys()]);
  });
  it('handles an empty list and a limit larger than the list', async () => {
    await runPool([], 6, async () => { throw new Error('should not run'); });
    const out = [];
    await runPool([1, 2], 10, async (n) => { out.push(n); });
    expect(out.sort()).toEqual([1, 2]);
  });
});
