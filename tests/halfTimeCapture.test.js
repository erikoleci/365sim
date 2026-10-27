import { describe, it, expect, vi, beforeEach } from 'vitest';

const queries = [];
vi.mock('../server/db.js', () => ({
  default: { query: vi.fn(async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; }) },
}));
const { captureHalfTimeScore, __resetHalfTimeCaptureForTests } = await import('../server/halfTime.js');

describe('captureHalfTimeScore', () => {
  beforeEach(() => { queries.length = 0; __resetHalfTimeCaptureForTests(); });

  it('stores the score once, only where none is stored yet', async () => {
    await captureHalfTimeScore('l365-1', 2, 1);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(/ht_home IS NULL/);
    expect(queries[0].params.slice(0, 3)).toEqual(['l365-1', 2, 1]);
    expect(queries[0].sql).toMatch(/ht_at = \$4/); // whistle time, so 45+2' events stay first half
    expect(Number.isFinite(queries[0].params[3])).toBe(true);
  });
  it('the ~1/sec HT ticks do not touch the database again', async () => {
    for (let i = 0; i < 50; i++) await captureHalfTimeScore('l365-1', 2, 1);
    expect(queries).toHaveLength(1);
  });
  it('ignores missing or invalid scores', async () => {
    await captureHalfTimeScore('l365-2', null, 1);
    await captureHalfTimeScore('l365-2', undefined, undefined);
    await captureHalfTimeScore('l365-2', -1, 0);
    await captureHalfTimeScore('l365-2', 1.5, 0);
    expect(queries).toHaveLength(0);
  });
});
