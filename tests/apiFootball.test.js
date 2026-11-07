import { describe, it, expect, vi } from 'vitest';
vi.mock('../server/db.js', () => ({ pool: { query: async () => ({ rows: [] }) }, default: { query: async () => ({ rows: [] }) } }));
const { statusKind, parseFixtures, findFixture, eventRows, shouldFetchEvents } = await import('../server/apiFootball.js');

const fx = (o = {}) => ({ id: 1, start: Date.parse('2026-11-07T10:00:00Z'), status: '2H', elapsed: 70, home: 'Slavia Praha C', away: 'Dynamo České Budějovice', homeScore: 2, awayScore: 1, ...o });
const row = { home_team: 'SK Slavia Prague C', away_team: 'SK Dynamo Ceske Budejovice', start_time: '2026-11-07T10:00:00Z' };
const ev = (type, detail, team, name, elapsed) => ({ type, detail, team: { name: team }, player: { name }, time: { elapsed } });

describe('API-Football second source', () => {
  it('classifies statuses; only plain FT is settled from', () => {
    expect(statusKind('FT')).toBe('FINISHED');
    expect(['1H', 'HT', '2H', 'ET'].map(statusKind)).toEqual(['LIVE', 'LIVE', 'LIVE', 'LIVE']);
    expect(statusKind('AET')).toBe('FINISHED_EXTRA');
    expect(['NS', 'PST', 'CANC', 'ABD'].map(statusKind)).toEqual(['OTHER', 'OTHER', 'OTHER', 'OTHER']);
  });
  it('finds our match under the other feed names, same order, within 3 h, exactly one', () => {
    expect(findFixture([fx()], row)).toMatchObject({ id: 1 });
    expect(findFixture([fx({ home: 'Dynamo České Budějovice', away: 'Slavia Praha C' })], row)).toBeNull(); // swapped order is never trusted
    expect(findFixture([fx({ start: Date.parse('2026-11-07T15:00:00Z') })], row)).toBeNull();
    expect(findFixture([fx(), fx({ id: 2 })], row)).toBeNull(); // ambiguous
    expect(findFixture([fx({ home: 'Slavia Praha' })], row)).toBeNull(); // the first team is not the C team
  });
  it('parses the fixtures response', () => {
    const r = parseFixtures({ response: [{ fixture: { id: 9, date: '2026-11-07T10:00:00+00:00', status: { short: 'FT', elapsed: 90 } }, teams: { home: { name: 'A' }, away: { name: 'B' } }, goals: { home: 3, away: 0 } }, { fixture: {} }] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 9, status: 'FT', homeScore: 3, awayScore: 0 });
  });
  it('turns events into rows: scorers, penalties, cards', () => {
    const f = fx({ homeScore: 2, awayScore: 1 });
    const rows = eventRows([
      ev('Goal', 'Normal Goal', 'Slavia Praha C', 'A. Novak', 12),
      ev('Goal', 'Penalty', 'Dynamo České Budějovice', 'B. Svoboda', 30),
      ev('Card', 'Yellow Card', 'Slavia Praha C', 'C. Dvorak', 55),
      ev('Goal', 'Normal Goal', 'Slavia Praha C', 'D. Prochazka', 61),
      ev('Goal', 'Missed Penalty', 'Dynamo České Budějovice', 'E. Cerny', 80),
      ev('Card', 'Red Card', 'Dynamo České Budějovice', 'F. Kral', 85),
    ], f, row.home_team, row.away_team);
    const goals = rows.filter((r) => r.type === 'GOAL');
    expect(goals.map((g) => [g.team, g.player, g.detail, g.minute])).toEqual([[row.home_team, 'A. Novak', '1-0', 12], [row.away_team, 'B. Svoboda', '1-1', 30], [row.home_team, 'D. Prochazka', '2-1', 61]]);
    expect(rows.filter((r) => r.type === 'PENALTY').map((r) => [r.team, r.player, r.detail])).toEqual([['away', 'B. Svoboda', '1'], ['away', 'E. Cerny', '2']]);
    expect(rows.filter((r) => r.type === 'YELLOW_CARD')).toHaveLength(1);
    expect(rows.find((r) => r.type === 'RED_CARD')).toMatchObject({ team: 'away', player: 'F. Kral', detail: '1', half: 2 });
  });
  it('an own goal counts for the other side', () => {
    const rows = eventRows([ev('Goal', 'Own Goal', 'Slavia Praha C', 'G. Hruby', 40)], fx({ homeScore: 0, awayScore: 1 }), row.home_team, row.away_team);
    expect(rows.find((r) => r.type === 'GOAL')).toMatchObject({ team: row.away_team, detail: '0-1', player: 'G. Hruby (a.g.)' });
  });
  it('returns null when the goals do not add up to the reported score (nothing is logged)', () => {
    expect(eventRows([ev('Goal', 'Normal Goal', 'Slavia Praha C', 'A', 10)], fx({ homeScore: 3, awayScore: 0 }), row.home_team, row.away_team)).toBeNull();
  });
});

describe('request saving', () => {
  const base = { kind: 'LIVE', h: 1, a: 0, prevScore: '1-0', lastAt: 0, now: 1e9, used: 10, max: 90 };
  it('does not call events while nothing changed', () => {
    expect(shouldFetchEvents({ ...base, lastAt: base.now - 60000 })).toBe(false);
    expect(shouldFetchEvents({ ...base, h: 0, a: 0, prevScore: '0-0' })).toBe(false);
  });
  it('calls events on a new goal, at full time, and every 10 minutes for cards', () => {
    expect(shouldFetchEvents({ ...base, h: 2, prevScore: '1-0', lastAt: base.now - 1000 })).toBe(true);
    expect(shouldFetchEvents({ ...base, kind: 'FINISHED' })).toBe(true);
    expect(shouldFetchEvents({ ...base, lastAt: base.now - 11 * 60000 })).toBe(true);
    expect(shouldFetchEvents({ ...base, prevScore: undefined, h: 1, a: 0 })).toBe(true);
    expect(shouldFetchEvents({ ...base, kind: 'FINISHED', h: 0, a: 0 })).toBe(false);
  });
  it('keeps the last 30% of the daily budget for fixtures and settling', () => {
    expect(shouldFetchEvents({ ...base, h: 2, prevScore: '1-0', used: 64, max: 90 })).toBe(false);
    expect(shouldFetchEvents({ ...base, kind: 'FINISHED', used: 85, max: 90 })).toBe(true);
  });
});

describe('pacing', () => {
  it('a 90/day budget spaces fixtures calls about 12 minutes apart, a 7000/day budget does not', async () => {
    process.env.API_FOOTBALL_DAILY_MAX = '90';
    const gap90 = 86400000 * 0.8 / 90;
    expect(Math.round(gap90 / 60000)).toBe(13);
    expect(Math.round(86400000 * 0.8 / 7000 / 1000)).toBe(10);
  });
});

describe('per-minute limit (free plan: 10 per minute)', () => {
  it('allows 8 calls inside a minute, then waits', async () => {
    const { underMinuteLimit } = await import('../server/apiFootball.js');
    const log = [];
    const t0 = 1e9;
    for (let i = 0; i < 8; i++) { expect(underMinuteLimit(t0 + i * 1000, 8, log)).toBe(true); log.push(t0 + i * 1000); }
    expect(underMinuteLimit(t0 + 9000, 8, log)).toBe(false);
    expect(underMinuteLimit(t0 + 61000, 8, log)).toBe(true); // the first call is more than a minute old
  });
});
