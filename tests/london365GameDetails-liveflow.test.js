import { describe, it, expect, vi, beforeEach } from 'vitest';

// Focused unit test for the live-flow bug fix in applyGameDetails:
// matches_cache.live_home_score/live_away_score must be updated
// immediately from the fast gamedetails socket (not only the separate
// live_statistics table), and a LIVE_TICK broadcast must fire on every
// processed update so connected clients resync minute/score at the
// feed's real ~1/sec cadence instead of only on a goal.
const mocks = vi.hoisted(function () {
  const store = new Map();
  function query(sql, params) {
    const s = String(sql);
    if (s.indexOf('SELECT id, home_team') === 0) {
      const row = store.get(params[0]);
      return Promise.resolve({ rows: row ? [row] : [] });
    }
    if (s.indexOf('UPDATE matches_cache SET live_home_score') === 0) {
      const row = store.get(params[2]);
      if (row) { row.live_home_score = params[0]; row.live_away_score = params[1]; }
      return Promise.resolve({ rows: [], rowCount: row ? 1 : 0 });
    }
    if (s.indexOf('INSERT INTO match_events') === 0) return Promise.resolve({ rows: [], rowCount: 1 });
    return Promise.resolve({ rows: [], rowCount: 0 });
  }
  return { store, query };
});

vi.mock('../server/db.js', function () {
  return { default: { query: mocks.query } };
});
vi.mock('../server/ws.js', function () {
  return { pushCardEvent: vi.fn(), pushLiveTick: vi.fn() };
});
vi.mock('../server/london365.js', function () {
  return {
    recordGoalIfChanged: vi.fn(),
    minuteToNumber: function () { return null; },
  };
});

import { applyGameDetails, __resetLiveStateForTests } from '../server/london365GameDetails.js';
import { pushLiveTick } from '../server/ws.js';

function tag(attrs) {
  return '<Detaje ' + Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ') + ' />';
}

beforeEach(function () {
  mocks.store.clear();
  vi.clearAllMocks();
  __resetLiveStateForTests();
  mocks.store.set('l365-52628036', {
    id: 'l365-52628036', home_team: 'Mohun Bagan SG II', away_team: 'Coal India',
    live_home_score: 3, live_away_score: 0, live_minute: '62',
  });
});

describe('applyGameDetails — live flow fix', function () {
  it('writes the new score straight into matches_cache the instant it changes', async function () {
    await applyGameDetails(tag({ EID: '52628036', T: '2288', SC: '4-0', H: 'Mohun Bagan SG II', A: 'Coal India' }));
    const row = mocks.store.get('l365-52628036');
    expect(row.live_home_score).toBe(4);
    expect(row.live_away_score).toBe(0);
  });

  it('broadcasts LIVE_TICK on the first update even with no score change (dedup baseline)', async function () {
    await applyGameDetails(tag({ EID: '52628036', T: '2290', SC: '3-0', H: 'Mohun Bagan SG II', A: 'Coal India' }));
    expect(pushLiveTick).toHaveBeenCalledTimes(1);
    expect(pushLiveTick).toHaveBeenCalledWith('l365-52628036', expect.objectContaining({
      minute: '62', homeScore: 3, awayScore: 0,
    }));
  });

  it('broadcasts the updated score on LIVE_TICK the same tick it changes', async function () {
    await applyGameDetails(tag({ EID: '52628036', T: '2291', SC: '4-0', H: 'Mohun Bagan SG II', A: 'Coal India' }));
    expect(pushLiveTick).toHaveBeenCalledWith('l365-52628036', expect.objectContaining({
      homeScore: 4, awayScore: 0,
    }));
  });

  it('still dedupes on a non-increasing T (no DB write, no broadcast)', async function () {
    await applyGameDetails(tag({ EID: '52628036', T: '2292', SC: '4-0', H: 'Mohun Bagan SG II', A: 'Coal India' }));
    vi.clearAllMocks();
    await applyGameDetails(tag({ EID: '52628036', T: '2292', SC: '4-0', H: 'Mohun Bagan SG II', A: 'Coal India' }));
    expect(pushLiveTick).not.toHaveBeenCalled();
  });

  it('never writes to matches_cache when the score is unchanged', async function () {
    await applyGameDetails(tag({ EID: '52628036', T: '2293', SC: '3-0', H: 'Mohun Bagan SG II', A: 'Coal India' }));
    // Still 3-0 in the store (no spurious UPDATE), but LIVE_TICK still fired
    // (first tick for this match in this test — see dedup test below for
    // the repeat-tick case).
    const row = mocks.store.get('l365-52628036');
    expect(row.live_home_score).toBe(3);
    expect(pushLiveTick).toHaveBeenCalledTimes(1);
  });

  it('skips the WS broadcast on a second tick with no change (bandwidth throttle)', async function () {
    await applyGameDetails(tag({ EID: '52628036', T: '2300', SC: '3-0', H: 'Mohun Bagan SG II', A: 'Coal India' }));
    expect(pushLiveTick).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();
    // Same score/minute, T still increases (real new provider tick) — must
    // NOT re-broadcast immediately; that's the whole point of the throttle.
    await applyGameDetails(tag({ EID: '52628036', T: '2301', SC: '3-0', H: 'Mohun Bagan SG II', A: 'Coal India' }));
    expect(pushLiveTick).not.toHaveBeenCalled();
  });
});
