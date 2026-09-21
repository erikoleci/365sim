import { describe, it, expect, vi, beforeEach } from 'vitest';

// While nothing is live, the periodic loops must not touch Postgres, so Neon
// can auto-suspend compute. When something IS (or may be) live they must.
const mocks = vi.hoisted(function () {
  const queries = [];
  const query = vi.fn(function (sql) {
    queries.push(String(sql));
    if (String(sql).startsWith('SELECT COUNT(*)')) return Promise.resolve({ rows: [{ matches: 0, live: 0, upcoming: 0, finished: 0 }] });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  return { queries, query, setKV: vi.fn(), getKV: vi.fn() };
});
vi.mock('../server/db.js', () => ({ default: { query: mocks.query }, getKV: mocks.getKV, setKV: mocks.setKV }));
vi.mock('../server/ws.js', () => ({ pushOddsChanged: vi.fn(), pushGoal: vi.fn(), pushGoalDisallowed: vi.fn(), pushMatchEnded: vi.fn() }));
vi.mock('../server/matchSettlement.js', () => ({ settleMatch: vi.fn() }));

const { syncLondon365Live, getLondon365Status } = await import('../server/london365.js');
const tracker = await import('../server/liveTracker.js');
const stats = await import('../server/feedStats.js');

const endDetectionQueries = () => mocks.queries.filter((q) => q.startsWith('SELECT id, live_home_score'));

beforeEach(() => {
  mocks.queries.length = 0; mocks.query.mockClear(); mocks.setKV.mockClear(); mocks.getKV.mockImplementation((k, d) => Promise.resolve(d));
  tracker.__resetLiveTrackerForTests(); stats.__resetFeedStatsForTests();
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]), text: () => Promise.resolve('[]') }));
});

describe('syncLondon365Live - idle behaviour', () => {
  it('makes NO database call at all when the tracker knows nothing is live (no end-detection SELECT, no kv write)', async () => {
    tracker.applyTrackerSnapshot([{ id: 'l365-1', status: 'UPCOMING' }], Date.now());
    await syncLondon365Live();
    expect(endDetectionQueries()).toHaveLength(0);
    expect(mocks.setKV).not.toHaveBeenCalled();
    expect(stats.snapshot().counters['endDetection.skipped_idle']).toBe(1);
  });

  it('still runs end detection when a match is known LIVE', async () => {
    tracker.applyTrackerSnapshot([{ id: 'l365-1', status: 'LIVE' }], Date.now());
    await syncLondon365Live();
    expect(endDetectionQueries()).toHaveLength(1);
  });

  it('fail-open: before the tracker has loaded it behaves as before (runs end detection)', async () => {
    await syncLondon365Live();
    expect(endDetectionQueries()).toHaveLength(1);
  });

  it('last live sync time is kept in memory (status page) instead of a kv_store write every 30s', async () => {
    tracker.applyTrackerSnapshot([], Date.now());
    await syncLondon365Live();
    expect(mocks.setKV).not.toHaveBeenCalledWith('l365_last_live_sync', expect.anything());
    const status = await getLondon365Status();
    expect(status.lastLiveSync).toBeGreaterThan(0);
    expect(status.feedStats.counters).toBeDefined();
  });
});
