import { describe, it, expect, vi, beforeEach } from 'vitest';

// applyGameDetails runs ~1/sec per live match. It used to SELECT the match row
// on every tick; it now reads the short-lived in-memory copy and only queries
// on a miss. It must still detect goals correctly off that copy.
const mocks = vi.hoisted(function () {
  const store = new Map();
  let selects = 0;
  const query = vi.fn(function (sql, params) {
    const s = String(sql);
    if (s.indexOf('SELECT id, home_team') === 0) { selects++; const r = store.get(params[0]); return Promise.resolve({ rows: r ? [{ ...r }] : [] }); }
    if (s.indexOf('UPDATE matches_cache SET live_home_score') === 0) {
      const r = store.get(params[2]); if (r) { r.live_home_score = params[0]; r.live_away_score = params[1]; }
      return Promise.resolve({ rows: [], rowCount: r ? 1 : 0 });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
  return { store, query, selects: () => selects, reset: () => { selects = 0; } };
});
vi.mock('../server/db.js', () => ({ default: { query: mocks.query } }));
vi.mock('../server/ws.js', () => ({ pushCardEvent: vi.fn(), pushLiveTick: vi.fn() }));
const recordGoalIfChanged = vi.fn().mockResolvedValue(undefined);
vi.mock('../server/london365.js', () => ({ recordGoalIfChanged, minuteToNumber: () => null }));

const { applyGameDetails, __resetLiveStateForTests } = await import('../server/london365GameDetails.js');
const tracker = await import('../server/liveTracker.js');

const tag = (a) => '<Detaje ' + Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ') + ' />';

beforeEach(() => {
  mocks.store.clear(); mocks.reset(); mocks.query.mockClear(); recordGoalIfChanged.mockClear();
  __resetLiveStateForTests();
  mocks.store.set('l365-10', { id: 'l365-10', home_team: 'A', away_team: 'B', live_home_score: 0, live_away_score: 0, live_minute: '5' });
});

describe('applyGameDetails - untracked games', () => {
  it('drops a game we do not hold with ZERO queries once the tracker is loaded', async () => {
    tracker.applyTrackerSnapshot([{ id: 'l365-10', status: 'LIVE' }], Date.now());
    for (let t = 1; t <= 5; t++) await applyGameDetails(tag({ EID: '424242', T: String(t), SC: '0-0' }));
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('starts processing a game the moment it becomes tracked (no multi-hour "unknown" verdict)', async () => {
    tracker.applyTrackerSnapshot([], Date.now());
    await applyGameDetails(tag({ EID: '10', T: '1', SC: '0-0', H: 'A', A: 'B' }));
    expect(mocks.query).not.toHaveBeenCalled();
    tracker.trackGame('l365-10');
    await applyGameDetails(tag({ EID: '10', T: '2', SC: '0-0', H: 'A', A: 'B' }));
    expect(mocks.selects()).toBe(1);
  });
});

describe('applyGameDetails - per-tick SELECT removed', () => {
  beforeEach(() => tracker.applyTrackerSnapshot([{ id: 'l365-10', status: 'LIVE' }], Date.now()));

  it('reads the row once for many ticks', async () => {
    for (let t = 1; t <= 20; t++) await applyGameDetails(tag({ EID: '10', T: String(t), SC: '0-0', H: 'A', A: 'B' }));
    expect(mocks.selects()).toBe(1);
  });

  it('still detects a goal, writes the score once, and passes the PRE-update score to goal detection', async () => {
    await applyGameDetails(tag({ EID: '10', T: '1', SC: '0-0', H: 'A', A: 'B' }));
    await applyGameDetails(tag({ EID: '10', T: '2', SC: '1-0', H: 'A', A: 'B' }));
    const updates = mocks.query.mock.calls.filter((c) => String(c[0]).indexOf('UPDATE matches_cache SET live_home_score') === 0);
    expect(updates).toHaveLength(1);
    expect(mocks.selects()).toBe(1);
    // recordGoalIfChanged runs every tick and diffs prev vs score itself. Exactly
    // ONE call may carry a real delta (prev 0-0 -> score 1-0); the later tick
    // must see prev = 1-0 (the in-memory copy), or the goal would be logged twice.
    await applyGameDetails(tag({ EID: '10', T: '3', SC: '1-0', H: 'A', A: 'B' }));
    const deltas = recordGoalIfChanged.mock.calls.filter(function (c) {
      return c[3].live_home_score !== c[1].home || c[3].live_away_score !== c[1].away;
    });
    expect(deltas).toHaveLength(1);
    expect(deltas[0][3].live_home_score).toBe(0);
    expect(deltas[0][1]).toEqual({ home: 1, away: 0 });
    const last = recordGoalIfChanged.mock.calls[recordGoalIfChanged.mock.calls.length - 1];
    expect(last[3].live_home_score).toBe(1);
  });

  it('a score written by the REST loop (upsertMatch -> setLiveRow) is seen by the next tick, so the goal is not double-counted', async () => {
    await applyGameDetails(tag({ EID: '10', T: '1', SC: '0-0', H: 'A', A: 'B' }));
    tracker.setLiveRow('l365-10', { home_team: 'A', away_team: 'B', live_home_score: 1, live_away_score: 0, live_minute: '20' });
    await applyGameDetails(tag({ EID: '10', T: '2', SC: '1-0', H: 'A', A: 'B' }));
    const updates = mocks.query.mock.calls.filter((c) => String(c[0]).indexOf('UPDATE matches_cache SET live_home_score') === 0);
    expect(updates).toHaveLength(0);
  });
});
