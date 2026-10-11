import { describe, it, expect } from 'vitest';
import { fetchMatchRowsPrioritized, PAGE_SIZE } from '../server/matchRows.js';

const NOW = Date.parse('2026-10-10T16:00:00.000Z');
const H = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();

// In-memory stand-in for the SQL: filters by [lo,hi) and applies ORDER BY start_time, id + LIMIT/OFFSET.
function fakeQuery(all) {
  const calls = [];
  const q = async (_sql, [lo, hi, limit, offset]) => {
    calls.push({ lo, hi, offset });
    const rows = all
      .filter((r) => Date.parse(r.start_time) >= Date.parse(lo) && Date.parse(r.start_time) < Date.parse(hi))
      .sort((a, b) => (a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : a.id < b.id ? -1 : 1));
    return { rows: rows.slice(offset, offset + limit) };
  };
  q.calls = calls;
  return q;
}

// Wide catalogue: 700 finished matches from the last 2 days, + today's live Chelsea-Bournemouth.
const finished = Array.from({ length: 700 }, (_, i) => ({ id: 'l365-f' + i, start_time: iso(NOW - 40 * H + i * 1000) }));
const chelsea = { id: 'l365-5200421', start_time: iso(NOW - 2 * H) };
const upcoming = Array.from({ length: 50 }, (_, i) => ({ id: 'l365-u' + i, start_time: iso(NOW + (3 + i) * H) }));

describe('fetchMatchRowsPrioritized', () => {
  it('with a tight cap, today\'s live match is kept and OLD finished matches are what gets cut', async () => {
    const q = fakeQuery([...finished, chelsea, ...upcoming]);
    const { rows, truncated } = await fetchMatchRowsPrioritized(q, 'x', 3, NOW); // 3 pages = 600 rows max
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('l365-5200421');
    expect(upcoming.every((u) => ids.includes(u.id))).toBe(true);
    expect(truncated).toBe(true);
    expect(rows.length).toBeLessThan(finished.length + 1 + upcoming.length);
  });

  it('shows what the OLD ascending query did: the same data and cap lose the live match', () => {
    const asc = [...finished, chelsea, ...upcoming].sort((a, b) => (a.start_time < b.start_time ? -1 : 1)).slice(0, 3 * PAGE_SIZE);
    expect(asc.map((r) => r.id)).not.toContain('l365-5200421');
  });

  it('with a big cap everything is returned exactly once, not truncated', async () => {
    const q = fakeQuery([...finished, chelsea, ...upcoming]);
    const { rows, truncated } = await fetchMatchRowsPrioritized(q, 'x', 1000, NOW);
    expect(truncated).toBe(false);
    expect(rows).toHaveLength(finished.length + 1 + upcoming.length);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it('rows outside the 2-days-back / 21-days-ahead window are never read', async () => {
    const old = { id: 'l365-old', start_time: iso(NOW - 5 * 24 * H) };
    const far = { id: 'l365-far', start_time: iso(NOW + 30 * 24 * H) };
    const { rows } = await fetchMatchRowsPrioritized(fakeQuery([old, far, chelsea]), 'x', 100, NOW);
    expect(rows.map((r) => r.id)).toEqual(['l365-5200421']);
  });

  it('reports which segment was cut', async () => {
    const cut = [];
    await fetchMatchRowsPrioritized(fakeQuery([...finished, chelsea, ...upcoming]), 'x', 3, NOW, (s) => cut.push(s));
    expect(cut.length).toBeGreaterThan(0);
  });
});
