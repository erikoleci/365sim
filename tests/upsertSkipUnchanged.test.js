import { describe, it, expect, vi, beforeEach } from 'vitest';

// upsertMatch used to rewrite the whole row (incl. 9-30KB raw_json) on EVERY
// call because fetched_at always changed. It now skips the UPSERT when the row
// we just read already equals what would be written, with a heartbeat so the
// "not touched for 8+ minutes" stale rule keeps working.
const mocks = vi.hoisted(function () {
  const store = new Map();
  const writes = [];
  const query = vi.fn(function (sql, params) {
    const s = String(sql);
    if (s.startsWith('SELECT raw_json, status')) {
      const row = store.get(params[0]);
      return Promise.resolve({ rows: row ? [{ ...row }] : [] });
    }
    if (s.startsWith('INSERT INTO matches_cache')) {
      writes.push(params);
      const [id, league, league_id, country_id, home_team, away_team, start_time, status, raw_json, fetched_at, lh, la, lm, ls, isDiff] = params;
      const ex = store.get(id);
      store.set(id, {
        id, league: league === '' && ex ? ex.league : league,
        league_id: league_id ?? (ex && ex.league_id), country_id: country_id ?? (ex && ex.country_id),
        home_team, away_team, start_time,
        status: isDiff ? status : (ex && ex.status === 'FINISHED' ? ex.status : status),
        raw_json, fetched_at: String(fetched_at), // pg returns BIGINT as a string
        live_home_score: isDiff || !ex ? lh : (lh ?? ex.live_home_score),
        live_away_score: isDiff || !ex ? la : (la ?? ex.live_away_score),
        live_minute: isDiff || !ex ? lm : (lm ?? ex.live_minute),
        live_status: isDiff || !ex ? ls : (ls ?? ex.live_status),
      });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (s.startsWith('INSERT INTO odds_history')) return Promise.resolve({ rows: [], rowCount: 1 });
    throw new Error('unmocked query: ' + s);
  });
  return { store, writes, query };
});
vi.mock('../server/db.js', () => ({ default: { query: mocks.query }, getKV: vi.fn(), setKV: vi.fn() }));
vi.mock('../server/ws.js', () => ({ pushOddsChanged: vi.fn(), pushGoal: vi.fn(), pushGoalDisallowed: vi.fn(), pushMatchEnded: vi.fn() }));
vi.mock('../server/matchSettlement.js', () => ({ settleMatch: vi.fn() }));

const { upsertMatch } = await import('../server/london365.js');
const { __resetLiveTrackerForTests, getLiveRow } = await import('../server/liveTracker.js');
const { snapshot, __resetFeedStatsForTests } = await import('../server/feedStats.js');

function ev(price = 1.9) {
  return {
    id: 'l365-1', home_team: 'A', away_team: 'B', commence_time: '2026-09-30T18:00:00Z',
    bookmakers: [{ title: 'L365', markets: [{ key: 'h2h', outcomes: [
      { name: 'A', price, id: '1' }, { name: 'Draw', price: 3.2, id: '2' }, { name: 'B', price: 2.8, id: '3' },
    ] }] }],
  };
}
const meta = { id: 11, countryId: 64 };

beforeEach(() => { mocks.store.clear(); mocks.writes.length = 0; mocks.query.mockClear(); __resetLiveTrackerForTests(); __resetFeedStatsForTests(); });

describe('upsertMatch - skips writes that would change nothing', () => {
  it('first sight inserts; an identical repeat inside the heartbeat window writes nothing', async () => {
    await upsertMatch(ev(), 'l365_england__premier_league', 'UPCOMING', null, null, meta);
    expect(mocks.writes).toHaveLength(1);
    await upsertMatch(ev(), 'l365_england__premier_league', 'UPCOMING', null, null, meta);
    expect(mocks.writes).toHaveLength(1);
    expect(snapshot().counters['upsert.skipped_unchanged']).toBe(1);
  });

  it('a price move IS written', async () => {
    await upsertMatch(ev(1.9), 'l365_england__premier_league', 'UPCOMING', null, null, meta);
    await upsertMatch(ev(2.1), 'l365_england__premier_league', 'UPCOMING', null, null, meta);
    expect(mocks.writes).toHaveLength(2);
    expect(JSON.parse(mocks.store.get('l365-1').raw_json).bookmakers[0].markets[0].outcomes[0].price).toBe(2.1);
  });

  it('a score / minute / status change IS written even when odds are identical', async () => {
    await upsertMatch(ev(), 'l365_england__premier_league', 'LIVE', { home: 0, away: 0 }, { minute: '10', apiStatus: 2 }, meta);
    await upsertMatch(ev(), 'l365_england__premier_league', 'LIVE', { home: 0, away: 0 }, { minute: '10', apiStatus: 2 }, meta);
    expect(mocks.writes).toHaveLength(1); // identical -> skipped
    await upsertMatch(ev(), 'l365_england__premier_league', 'LIVE', { home: 1, away: 0 }, { minute: '11', apiStatus: 2 }, meta);
    expect(mocks.writes).toHaveLength(2);
    expect(mocks.store.get('l365-1').live_home_score).toBe(1);
  });

  it('a missing score in the payload does not count as a change (COALESCE keeps the stored one)', async () => {
    await upsertMatch(ev(), 'l365_england__premier_league', 'LIVE', { home: 2, away: 1 }, { minute: '70', apiStatus: 2 }, meta);
    await upsertMatch(ev(), 'l365_england__premier_league', 'LIVE', null, null, meta);
    expect(mocks.writes).toHaveLength(1);
    expect(mocks.store.get('l365-1').live_home_score).toBe(2);
  });

  it('still writes once the heartbeat interval has elapsed (keeps fetched_at fresh for the stale-live rule)', async () => {
    await upsertMatch(ev(), 'l365_england__premier_league', 'UPCOMING', null, null, meta);
    mocks.store.get('l365-1').fetched_at = String(Date.now() - 5 * 60 * 1000 - 1000);
    await upsertMatch(ev(), 'l365_england__premier_league', 'UPCOMING', null, null, meta);
    expect(mocks.writes).toHaveLength(2);
  });

  it('a newly learned league_id / country_id is written', async () => {
    await upsertMatch(ev(), 'l365_england__premier_league', 'UPCOMING', null, null, undefined);
    await upsertMatch(ev(), 'l365_england__premier_league', 'UPCOMING', null, null, meta);
    expect(mocks.writes).toHaveLength(2);
  });

  it('a reused id with different teams is never skipped', async () => {
    await upsertMatch(ev(), 'l365_england__premier_league', 'UPCOMING', null, null, meta);
    const other = { ...ev(), home_team: 'C', away_team: 'D' };
    await upsertMatch(other, 'l365_england__premier_league', 'UPCOMING', null, null, meta);
    expect(mocks.writes).toHaveLength(2);
  });

  it('keeps the in-memory live row in step, including on a skipped write', async () => {
    await upsertMatch(ev(), 'l365_england__premier_league', 'LIVE', { home: 1, away: 0 }, { minute: '33', apiStatus: 2 }, meta);
    await upsertMatch(ev(), 'l365_england__premier_league', 'LIVE', null, null, meta); // skipped
    expect(getLiveRow('l365-1')).toEqual({ home_team: 'A', away_team: 'B', live_home_score: 1, live_away_score: 0, live_minute: '33' });
  });
});
