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
      if (sql.startsWith('SELECT type')) return { rows: [{ type: 'CORNER', team: 'home', detail: '1' }] };
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
    const db = { query: vi.fn(async () => ({ rows: [] })) };
    await ingestProviderEvents('l365-2', SAMPLE, '41:30', { db, now: 5000 });
    expect(getProviderCorners('l365-2')).toEqual({ home: 4, away: 2, at: 5000 });
    await ingestProviderEvents('l365-2', SAMPLE, '42:30', { db, now: 35000 });
    expect(getProviderCorners('l365-2').at).toBe(35000);
    await ingestProviderEvents('l365-3', '4,1,1,1,1,20:00;', '30:00', { db, now: 1 });
    expect(getProviderCorners('l365-3')).toBe(null); // no corner in the list proves nothing about "0 corners"
  });
});

const { providerGoals, missingGoals } = await import('../server/london365/providerEvents.js');
// Real list: Persika Karanganyar - Persipa Pati 3-0 (goals 19', 34', 43' for the home side; type 1 = goal confirmed 2026-11-26).
const GOALS = '2,2,1,329593585,1,05:00;1,1,1,329595805,1,19:00;1,1,2,329597910,1,34:00;1,1,3,329599222,1,43:00;5,0,0,329599995,2,3-0;';
describe('goals from the provider list', () => {
  it('reads goals with the running score', () => {
    expect(providerGoals(GOALS).map((g) => g.side + g.minute + ':' + g.score)).toEqual(['home19:1-0', 'home34:2-0', 'home43:3-0']);
    expect(providerGoals('1,2,1,1,1,06:00;1,1,1,2,1,10:00;1,2,2,3,1,45:00;').map((g) => g.score)).toEqual(['0-1', '1-1', '1-2']);
  });
  it('finds only the goals the log lacks', () => {
    const l = providerGoals(GOALS);
    expect(missingGoals(l, [19]).map((g) => g.minute)).toEqual([34, 43]);
    expect(missingGoals(l, [34, 43, 19])).toEqual([]);
    expect(missingGoals(l, [])).toHaveLength(3);
  });
  const run = async (score, goalRows) => {
    __resetProviderEventsForTests();
    const inserted = [];
    const db = { query: vi.fn(async (sql, p) => {
      if (sql.startsWith('SELECT type')) return { rows: goalRows };
      if (sql.startsWith('SELECT home_team')) return { rows: [{ home_team: 'Persika', away_team: 'Persipa' }] };
      inserted.push(p); return { rows: [] };
    }) };
    const n = await ingestProviderEvents('l365-9', GOALS, '47:30', { db, now: 10_000_000, score });
    return { n, inserted };
  };
  it('recovers missing goals when the list agrees with the live score', async () => {
    const { inserted } = await run({ home: 3, away: 0 }, [{ type: 'GOAL', team: 'Persika', detail: '1-0', minute: 19 }]);
    const goals = inserted.filter((p) => p[2] === 'Persika');
    expect(goals.map((p) => p[1] + ':' + p[3])).toEqual(['34:2-0', '43:3-0']);
  });
  it('adds nothing when the list and the live score disagree or nothing is missing', async () => {
    expect((await run({ home: 2, away: 0 }, [])).inserted.filter((p) => p[2] === 'Persika')).toEqual([]);
    expect((await run(null, [])).inserted.filter((p) => p[2] === 'Persika')).toEqual([]);
    const full = [19, 34, 43].map((m) => ({ type: 'GOAL', team: 'Persika', detail: 'x', minute: m }));
    expect((await run({ home: 3, away: 0 }, full)).inserted.filter((p) => p[2] === 'Persika')).toEqual([]);
  });
});
