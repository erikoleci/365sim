import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(function () {
  const store = new Map();

  function reset() { store.clear(); }

  function query(sql, params = []) {
    const s = String(sql);
    if (s.startsWith('SELECT raw_json, status, live_home_score, live_away_score, live_minute, home_team, away_team FROM matches_cache')) {
      const row = store.get(params[0]);
      return Promise.resolve({ rows: row ? [{ ...row }] : [] });
    }
    if (s.startsWith('INSERT INTO matches_cache')) {
      const id = params[0], league = params[1], home_team = params[2], away_team = params[3],
        start_time = params[4], status = params[5], raw_json = params[6], fetched_at = params[7],
        live_home_score = params[8], live_away_score = params[9], live_minute = params[10],
        live_status = params[11], isDifferentMatch = params[12];
      const existing = store.get(id);
      if (!existing) {
        store.set(id, { id, league, home_team, away_team, start_time, status, raw_json, fetched_at, live_home_score, live_away_score, live_minute, live_status });
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      const next = {
        ...existing,
        league: league === '' ? existing.league : league,
        home_team, away_team, start_time,
        status: isDifferentMatch ? status : (existing.status === 'FINISHED' ? existing.status : status),
        raw_json, fetched_at,
        live_home_score: isDifferentMatch ? live_home_score : (live_home_score ?? existing.live_home_score),
        live_away_score: isDifferentMatch ? live_away_score : (live_away_score ?? existing.live_away_score),
        live_minute: isDifferentMatch ? live_minute : (live_minute ?? existing.live_minute),
        live_status: isDifferentMatch ? live_status : (live_status ?? existing.live_status),
      };
      store.set(id, next);
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (s.startsWith('INSERT INTO odds_history')) return Promise.resolve({ rows: [], rowCount: 1 });
    throw new Error('unmocked query: ' + s);
  }

  const pool = { query };
  return { store, reset, pool };
});

vi.mock('../server/db.js', () => ({ default: mocks.pool, pool: mocks.pool, getKV: vi.fn(), setKV: vi.fn() }));
vi.mock('../server/ws.js', () => ({
  pushOddsChanged: vi.fn(), pushGoal: vi.fn(), pushGoalDisallowed: vi.fn(), pushMatchEnded: vi.fn(),
}));
vi.mock('../server/matchSettlement.js', () => ({ settleMatch: vi.fn() }));

const { upsertMatch } = await import('../server/london365.js');

beforeEach(() => { mocks.reset(); });

function ev(id, home, away) {
  return { id, home_team: home, away_team: away, commence_time: '2026-09-15T18:00:00Z', bookmakers: [] };
}

describe('upsertMatch - reused id (EID) for a different real-world match', () => {
  it('normal case: same teams, FINISHED status sticks (existing correct behavior preserved)', async () => {
    mocks.store.set('l365-1', {
      id: 'l365-1', home_team: 'Team A', away_team: 'Team B', status: 'FINISHED',
      raw_json: JSON.stringify({ bookmakers: [] }), live_home_score: 2, live_away_score: 1, live_minute: '90',
    });
    await upsertMatch(ev('l365-1', 'Team A', 'Team B'), 'league-x', 'LIVE', { home: 3, away: 1 }, {});
    const row = mocks.store.get('l365-1');
    expect(row.status).toBe('FINISHED'); // still locked, as intended for a genuinely-settled match
    // Score itself is NOT locked by this guard (only status is) -- COALESCE
    // always prefers a present incoming value, which is pre-existing,
    // unrelated behavior (e.g. a late score correction after settlement).
    expect(row.live_home_score).toBe(3);
  });

  it('reused id: different teams reported -> status is NOT stuck at FINISHED, new match can go LIVE', async () => {
    mocks.store.set('l365-1', {
      id: 'l365-1', home_team: 'Old Team A', away_team: 'Old Team B', status: 'FINISHED',
      raw_json: JSON.stringify({ bookmakers: [] }), live_home_score: 2, live_away_score: 1, live_minute: '90',
    });
    await upsertMatch(ev('l365-1', 'New Team X', 'New Team Y'), 'league-y', 'LIVE', { home: 0, away: 0 }, {});
    const row = mocks.store.get('l365-1');
    expect(row.status).toBe('LIVE');
    expect(row.home_team).toBe('New Team X');
    expect(row.away_team).toBe('New Team Y');
  });

  it('reused id: the new match does not inherit the old match leftover score', async () => {
    mocks.store.set('l365-1', {
      id: 'l365-1', home_team: 'Old A', away_team: 'Old B', status: 'FINISHED',
      raw_json: JSON.stringify({ bookmakers: [] }), live_home_score: 5, live_away_score: 3, live_minute: '90',
    });
    await upsertMatch(ev('l365-1', 'New X', 'New Y'), 'league-y', 'LIVE', { home: 0, away: 0 }, {});
    const row = mocks.store.get('l365-1');
    expect(row.live_home_score).toBe(0);
    expect(row.live_away_score).toBe(0);
  });

  it('returns undefined as prev for a reused id, so the caller does not diff against the old match score', async () => {
    mocks.store.set('l365-1', {
      id: 'l365-1', home_team: 'Old A', away_team: 'Old B', status: 'FINISHED',
      raw_json: JSON.stringify({ bookmakers: [] }), live_home_score: 5, live_away_score: 3, live_minute: '90',
    });
    const prev = await upsertMatch(ev('l365-1', 'New X', 'New Y'), 'league-y', 'LIVE', { home: 1, away: 0 }, {});
    expect(prev).toBeUndefined();
  });

  it('same teams, not-yet-finished match: normal update flows through unaffected', async () => {
    mocks.store.set('l365-1', {
      id: 'l365-1', home_team: 'A', away_team: 'B', status: 'LIVE',
      raw_json: JSON.stringify({ bookmakers: [] }), live_home_score: 1, live_away_score: 0, live_minute: '50',
    });
    const prev = await upsertMatch(ev('l365-1', 'A', 'B'), 'league-x', 'LIVE', { home: 2, away: 0 }, {});
    expect(prev).toBeDefined();
    expect(prev.live_home_score).toBe(1);
    const row = mocks.store.get('l365-1');
    expect(row.live_home_score).toBe(2);
    expect(row.status).toBe('LIVE');
  });

  it('brand-new id (no existing row) inserts normally without hitting the mismatch path', async () => {
    const prev = await upsertMatch(ev('l365-999', 'Fresh A', 'Fresh B'), 'league-z', 'UPCOMING', null, {});
    expect(prev).toBeUndefined();
    const row = mocks.store.get('l365-999');
    expect(row.home_team).toBe('Fresh A');
    expect(row.status).toBe('UPCOMING');
  });
});
