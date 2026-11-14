import { describe, it, expect, vi } from 'vitest';
import { getProviderCorners, __resetProviderCornersForTests } from '../server/providerCounters.js';
vi.mock('../server/db.js', () => ({ default: { query: vi.fn() } }));
const { parseResultList, providerEventRows, ingestProviderEvents, __resetProviderEventsForTests } = await import('../server/london365/providerEvents.js');

// The real list the provider sent for Kosovo - Israel at 40:34 (its own page showed corners 13 18 25 26 40 41 and yellow cards 20 home, 27 away).
const SAMPLE = '2,1,1,327606921,1,13:00;2,1,2,327607979,1,18:00;4,1,1,327608431,1,20:00;2,2,3,327609136,1,25:00;2,2,4,327609228,1,26:00;4,2,2,327609406,1,27:00;2,1,5,327612155,1,40:00;2,1,6,327612333,1,41:00;';

describe('provider result_list', () => {
  it('parses every entry', () => { expect(parseResultList(SAMPLE)).toHaveLength(8); expect(parseResultList('garbage;;1,2')).toEqual([]); });
  it('turns corners and yellow cards into counted rows with the real minutes', () => {
    const rows = providerEventRows(SAMPLE);
    expect(rows.filter((r) => r.type === 'CORNER' && r.team === 'home').map((r) => r.minute + ':' + r.detail)).toEqual(['13:1', '18:2', '40:3', '41:4']);
    expect(rows.filter((r) => r.type === 'CORNER' && r.team === 'away').map((r) => r.minute + ':' + r.detail)).toEqual(['25:1', '26:2']);
    expect(rows.filter((r) => r.type === 'YELLOW_CARD').map((r) => r.team + r.minute)).toEqual(['home20', 'away27']);
  });
  it('ignores types whose meaning is not confirmed', () => { expect(providerEventRows('9,1,1,1,1,10:00;')).toEqual([]); });
  it('stores only what is missing, once, and does nothing while the list is unchanged', async () => {
    __resetProviderEventsForTests();
    const known = new Set(['CORNER:home:1']);
    const inserted = [];
    const db = { query: vi.fn(async (sql, p) => {
      if (sql.startsWith('SELECT 1')) return { rows: known.has(p[1] + ':' + p[2] + ':' + p[3]) ? [{}] : [] };
      inserted.push(p); return { rows: [] };
    }) };
    expect(await ingestProviderEvents('l365-1', SAMPLE, '41:30', { db, now: 1_000_000 })).toBe(7);
    expect(inserted).toHaveLength(7);
    const calls = db.query.mock.calls.length;
    expect(await ingestProviderEvents('l365-1', SAMPLE, '41:35', { db, now: 1_005_000 })).toBe(0);
    expect(db.query.mock.calls.length).toBe(calls);
  });
  it('keeps the corner totals for the live corner markets, refreshed even when the list did not change', async () => {
    __resetProviderEventsForTests(); __resetProviderCornersForTests();
    const db = { query: vi.fn(async (sql) => (sql.startsWith('SELECT 1') ? { rows: [{}] } : { rows: [] })) };
    await ingestProviderEvents('l365-2', SAMPLE, '41:30', { db, now: 5000 });
    expect(getProviderCorners('l365-2')).toEqual({ home: 4, away: 2, at: 5000 });
    await ingestProviderEvents('l365-2', SAMPLE, '42:30', { db, now: 35000 });
    expect(getProviderCorners('l365-2').at).toBe(35000);
    await ingestProviderEvents('l365-3', '4,1,1,1,1,20:00;', '30:00', { db, now: 1 });
    expect(getProviderCorners('l365-3')).toBe(null); // no corner in the list proves nothing about "0 corners"
  });
});
