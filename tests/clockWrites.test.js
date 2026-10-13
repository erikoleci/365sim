import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
let failNext = false;
vi.mock('../server/db.js', () => ({
  default: { query: vi.fn(async (sql, params) => { if (failNext) { failNext = false; throw new Error('db down'); } calls.push({ sql, params }); return { rows: [] }; }) },
}));
const { queueClockWrite, flushClockWrites, pendingClockWrites, __resetClockWritesForTests } = await import('../server/clockWrites.js');

describe('batched live-clock writes', () => {
  beforeEach(() => { calls.length = 0; failNext = false; __resetClockWritesForTests(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

  it('10,000 matches are persisted with 20 queries, not 10,000', async () => {
    for (let i = 0; i < 10000; i++) queueClockWrite('m' + i, '40:19', 1000);
    expect(await flushClockWrites()).toBe(10000);
    expect(calls).toHaveLength(20);
    expect(calls[0].params[0]).toHaveLength(500);
    expect(pendingClockWrites()).toBe(0);
  });
  it('keeps only the newest value per match', async () => {
    queueClockWrite('m1', '10:00', 1); queueClockWrite('m1', '10:15', 2);
    await flushClockWrites();
    expect(calls[0].params).toEqual([['m1'], ['10:15'], [2]]);
  });
  it('nothing queued means no query', async () => {
    expect(await flushClockWrites()).toBe(0);
    expect(calls).toHaveLength(0);
  });
  it('a failed write is retried on the next flush and loses nothing', async () => {
    queueClockWrite('m1', '10:00', 1);
    failNext = true;
    expect(await flushClockWrites()).toBe(0);
    expect(pendingClockWrites()).toBe(1);
    expect(await flushClockWrites()).toBe(1);
  });
  it('a newer value queued during a failure is not overwritten by the retry', async () => {
    queueClockWrite('m1', '10:00', 1);
    failNext = true;
    const p = flushClockWrites();
    queueClockWrite('m1', '10:30', 2);
    await p;
    await flushClockWrites();
    expect(calls.at(-1).params[1]).toEqual(['10:30']);
  });
});
