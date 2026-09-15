import { describe, it, expect } from 'vitest';
import { withDbLock } from '../server/london365.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('withDbLock - per-match serialization, not a single global lock', () => {
  it('serializes two calls for the SAME key in order (correctness: no interleaved writes to one match)', async () => {
    const order = [];
    const a = withDbLock('match-1', async () => {
      order.push('a-start');
      await delay(30);
      order.push('a-end');
    });
    const b = withDbLock('match-1', async () => {
      order.push('b-start');
      await delay(5);
      order.push('b-end');
    });
    await Promise.all([a, b]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('does NOT serialize calls for DIFFERENT keys (performance: unrelated matches run in parallel)', async () => {
    const order = [];
    const slowMatch = withDbLock('match-slow', async () => {
      order.push('slow-start');
      await delay(30);
      order.push('slow-end');
    });
    const fastMatch = withDbLock('match-fast', async () => {
      order.push('fast-start');
      await delay(5);
      order.push('fast-end');
    });
    await Promise.all([slowMatch, fastMatch]);
    expect(order[0]).toBe('slow-start');
    expect(order[1]).toBe('fast-start');
    expect(order.indexOf('fast-end')).toBeLessThan(order.indexOf('slow-end'));
  });

  it('a later call still runs even if an earlier call for the same key throws', async () => {
    const results = [];
    const a = withDbLock('match-2', async () => { throw new Error('boom'); }).catch((e) => { results.push('a-caught:' + e.message); });
    const b = withDbLock('match-2', async () => { results.push('b-ran'); return 'ok'; });
    await Promise.all([a, b]);
    expect(results).toEqual(['a-caught:boom', 'b-ran']);
    expect(await b).toBe('ok');
  });

  it('returns the resolved value of fn to the caller', async () => {
    const result = await withDbLock('match-3', async () => 42);
    expect(result).toBe(42);
  });

  it('propagates a rejection to the caller of that specific call', async () => {
    await expect(withDbLock('match-4', async () => { throw new Error('nope'); })).rejects.toThrow('nope');
  });

  it('does not leak: a brand new call for a settled key starts immediately, not queued behind stale state', async () => {
    await withDbLock('match-5', async () => {});
    const start = Date.now();
    await withDbLock('match-5', async () => {});
    expect(Date.now() - start).toBeLessThan(50);
  });
});
