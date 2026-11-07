import { describe, it, expect, vi } from 'vitest';
vi.mock('../server/db.js', () => ({ default: { query: async () => ({ rows: [] }), end: async () => {} } }));
process.env.API_FOOTBALL_KEY = 'x';
const { parseFixtures, describeEvent } = await import('../server/apiFootballProbe.js');

describe('API-Football probe parsing', () => {
  it('reads a fixture row', () => {
    const r = parseFixtures({ response: [{ fixture: { id: 7, date: '2026-11-07T09:30:00+00:00', status: { short: '1H', elapsed: 33 } }, league: { name: 'U19 League' }, teams: { home: { name: 'A' }, away: { name: 'B' } }, goals: { home: 1, away: 0 } }] });
    expect(r[0]).toMatchObject({ id: 7, status: '1H', elapsed: 33, home: 'A', away: 'B', homeScore: 1, awayScore: 0 });
  });
  it('describes goal, penalty and card events', () => {
    expect(describeEvent({ time: { elapsed: 45, extra: 2 }, type: 'Goal', detail: 'Penalty', player: { name: 'X Y' }, team: { name: 'A' } })).toBe("45+2' Goal/Penalty X Y (A)");
    expect(describeEvent({ time: { elapsed: 80 }, type: 'Card', detail: 'Yellow Card', player: { name: 'Z' }, team: { name: 'B' } })).toBe("80' Card/Yellow Card Z (B)");
  });
});
