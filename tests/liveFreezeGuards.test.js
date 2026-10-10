import { describe, it, expect, vi } from 'vitest';
import { liveCycleDecision, shouldLogMissingLive } from '../server/london365.js';
import { clockReceivedAt, projectClock, parseLiveClock } from '../components/MatchCard.tsx';

describe('liveCycleDecision (a stuck cycle must not freeze live data forever)', () => {
  it('starts when nothing is running', () => {
    expect(liveCycleDecision(false, 0, 1000, 90000)).toBe('start');
  });
  it('skips the tick while the running cycle is still young', () => {
    expect(liveCycleDecision(true, 1000, 31000, 90000)).toBe('skip');
  });
  it('resets (starts anyway) once the running cycle is older than the limit', () => {
    expect(liveCycleDecision(true, 1000, 100000, 90000)).toBe('reset');
  });
});

describe('provider request timeout', () => {
  it('a request that never answers fails instead of hanging the live cycle', async () => {
    vi.resetModules();
    process.env.LONDON365_API_TIMEOUT_MS = '40';
    vi.stubGlobal('fetch', vi.fn((url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new Error('aborted by timeout')));
    })));
    const mod = await import('../server/london365.js');
    const t0 = Date.now();
    await expect(mod.fetchLiveRows('123')).rejects.toThrow(/failed/);
    expect(Date.now() - t0).toBeLessThan(5000); // 2 attempts x 40ms + backoff, not forever
    vi.unstubAllGlobals();
    delete process.env.LONDON365_API_TIMEOUT_MS;
  });
});

describe('shouldLogMissingLive (no log flood with ~100 live games)', () => {
  it('logs a game once, then not again for 10 minutes', () => {
    expect(shouldLogMissingLive('g1', 1_000)).toBe(true);
    expect(shouldLogMissingLive('g1', 60_000)).toBe(false);
    expect(shouldLogMissingLive('g1', 1_000 + 10 * 60 * 1000 + 1)).toBe(true);
    expect(shouldLogMissingLive('g2', 2_000)).toBe(true);
  });
});

describe('clockReceivedAt (the "11081:42" bug)', () => {
  const now = Date.parse('2026-10-10T14:41:00Z');
  it('uses a recent server stamp', () => {
    expect(clockReceivedAt(now - 5000, now)).toBe(now - 5000);
  });
  it('ignores a stamp from a week ago (row imported before the match) and uses now', () => {
    expect(clockReceivedAt(now - 7.7 * 24 * 3600 * 1000, now)).toBe(now);
  });
  it('ignores a stamp from the future and a missing stamp', () => {
    expect(clockReceivedAt(now + 60000, now)).toBe(now);
    expect(clockReceivedAt(undefined, now)).toBe(now);
  });
  it('with the old stale stamp the projection really was absurd; with the fix it is sane', () => {
    const base = parseLiveClock('40');
    const total = base.minute * 60 + base.second;
    const stale = now - 664_900_000; // the stamp that produced 11081:42
    // Before the guards this read 11081 minutes; the projection itself is now capped too
    // (MAX_PROJECTION_SECONDS), so even an unfiltered stale stamp can no longer run away.
    expect(projectClock(total, stale, now).minute).toBeLessThanOrEqual(42);
    expect(projectClock(total, clockReceivedAt(stale, now), now).minute).toBe(40);
  });
});
