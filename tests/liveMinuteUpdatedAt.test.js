import { describe, it, expect, vi, beforeEach } from 'vitest';

// upsertMatch must stamp live_minute_updated_at with the moment
// live_minute ACTUALLY CHANGES value, and leave it untouched on every poll
// that doesn't move the minute -- this is the server-side reference the
// frontend's ticking clock resyncs from (migrations/0002_live_minute_updated_at.sql).
const mocks = vi.hoisted(function () {
  const store = new Map();
  const query = vi.fn(function (sql, params) {
    const s = String(sql);
    if (s.startsWith('SELECT raw_json, status')) {
      const row = store.get(params[0]);
      return Promise.resolve({ rows: row ? [{ ...row }] : [] });
    }
    if (s.startsWith('INSERT INTO matches_cache')) {
      const [id, league, league_id, country_id, home_team, away_team, start_time, status,
        raw_json, fetched_at, lh, la, lm, ls, isDiff, newLmUpdatedAt] = params;
      const ex = store.get(id);
      const effLm = isDiff || !ex ? lm : (lm ?? ex.live_minute);
      const minuteChanged = !ex || effLm !== ex.live_minute; // IS DISTINCT FROM semantics
      store.set(id, {
        id, league, league_id, country_id, home_team, away_team, start_time, status,
        raw_json, fetched_at: String(fetched_at),
        live_home_score: lh, live_away_score: la,
        live_minute: effLm, live_status: ls,
        live_minute_updated_at: minuteChanged ? newLmUpdatedAt : (ex ? ex.live_minute_updated_at : newLmUpdatedAt),
      });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (s.startsWith('INSERT INTO odds_history')) return Promise.resolve({ rows: [], rowCount: 1 });
    throw new Error('unmocked query: ' + s);
  });
  return { store, query };
});
vi.mock('../server/db.js', () => ({ default: { query: mocks.query }, getKV: vi.fn(), setKV: vi.fn() }));
vi.mock('../server/ws.js', () => ({ pushOddsChanged: vi.fn(), pushGoal: vi.fn(), pushGoalDisallowed: vi.fn(), pushMatchEnded: vi.fn() }));
vi.mock('../server/matchSettlement.js', () => ({ settleMatch: vi.fn() }));

const { upsertMatch } = await import('../server/london365.js');
const { __resetLiveTrackerForTests } = await import('../server/liveTracker.js');
const { __resetFeedStatsForTests } = await import('../server/feedStats.js');

function ev() {
  return {
    id: 'l365-1', home_team: 'A', away_team: 'B', commence_time: '2026-09-30T18:00:00Z',
    bookmakers: [{ title: 'L365', markets: [{ key: 'h2h', outcomes: [
      { name: 'A', price: 1.9, id: '1' }, { name: 'Draw', price: 3.2, id: '2' }, { name: 'B', price: 2.8, id: '3' },
    ] }] }],
  };
}
const meta = { id: 11, countryId: 64 };
const liveScores = { home: 0, away: 0 };
function liveInfo(minute) { return { minute: String(minute), apiStatus: '1H' }; }

beforeEach(() => { mocks.store.clear(); mocks.query.mockClear(); __resetLiveTrackerForTests(); __resetFeedStatsForTests(); });

describe('upsertMatch - live_minute_updated_at (server-side clock reference)', () => {
  it('stamps live_minute_updated_at on first sight of a real minute', async () => {
    await upsertMatch(ev(), 'l365_italy__serie_a', 'LIVE', liveScores, liveInfo('40:00'), meta);
    const row = mocks.store.get('l365-1');
    expect(row.live_minute).toBe('40:00');
    expect(row.live_minute_updated_at).toBeTypeOf('number');
  });

  it('does NOT bump live_minute_updated_at on a poll where the minute did not change', async () => {
    await upsertMatch(ev(), 'l365_italy__serie_a', 'LIVE', liveScores, liveInfo('40:00'), meta);
    const firstStamp = mocks.store.get('l365-1').live_minute_updated_at;

    await new Promise((r) => setTimeout(r, 5));
    await upsertMatch(ev(), 'l365_italy__serie_a', 'LIVE', liveScores, liveInfo('40:00'), meta); // same minute again
    const secondStamp = mocks.store.get('l365-1').live_minute_updated_at;

    expect(secondStamp).toBe(firstStamp);
  });

  it('DOES bump live_minute_updated_at the moment the minute actually advances', async () => {
    await upsertMatch(ev(), 'l365_italy__serie_a', 'LIVE', liveScores, liveInfo('40:00'), meta);
    const firstStamp = mocks.store.get('l365-1').live_minute_updated_at;

    await new Promise((r) => setTimeout(r, 5));
    await upsertMatch(ev(), 'l365_italy__serie_a', 'LIVE', liveScores, liveInfo('41:00'), meta);
    const row = mocks.store.get('l365-1');

    expect(row.live_minute).toBe('41:00');
    expect(row.live_minute_updated_at).toBeGreaterThan(firstStamp);
  });
});
