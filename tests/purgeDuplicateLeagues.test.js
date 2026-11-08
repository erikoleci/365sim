import { describe, it, expect, vi, beforeEach } from 'vitest';

const q = vi.fn();
vi.mock('../server/db.js', () => ({ default: { query: (...a) => q(...a) }, pool: { query: (...a) => q(...a) }, setKV: vi.fn(), getKV: vi.fn() }));
const { purgeCountryPrefixedDuplicateLeagues } = await import('../server/london365/maintenance.js');

const run = (leagues, existing) => {
  q.mockReset();
  q.mockImplementation(async (sql, params) => {
    if (/SELECT DISTINCT league/.test(sql)) return { rows: leagues.map((league) => ({ league })) };
    if (/SELECT 1 FROM matches_cache/.test(sql)) return { rows: existing.includes(params[0]) ? [{ '?column?': 1 }] : [] };
    if (/^\s*DELETE/.test(sql)) return { rowCount: 3 };
    return { rows: [], rowCount: 0 };
  });
  return purgeCountryPrefixedDuplicateLeagues();
};
const deletes = () => q.mock.calls.filter((c) => /^\s*DELETE/.test(c[0]));

describe('purgeCountryPrefixedDuplicateLeagues', () => {
  beforeEach(() => q.mockReset());
  it('keeps a league that is really called "Spain La Liga" (no clean twin exists) -- its in-play records are not wiped', async () => {
    const n = await run(['l365_spain__spain_la_liga'], []);
    expect(deletes()).toHaveLength(0);
    expect(n).toBe(0);
  });
  it('still purges a true duplicate when the clean-named league exists next to it', async () => {
    const n = await run(['l365_england__england_premier_league'], ['l365_england__premier_league']);
    expect(deletes()).toHaveLength(1);
    expect(n).toBe(3);
  });
});
