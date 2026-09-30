import { describe, it, expect, vi, beforeEach } from 'vitest';

// Focused unit test for the live-flow bug fix in applyGameDetails:
// matches_cache.live_home_score/live_away_score must be updated
// immediately from the fast gamedetails socket (not only the separate
// live_statistics table), and a LIVE_TICK broadcast must fire on every
// processed update so connected clients resync minute/score at the
// feed's real ~1/sec cadence instead of only on a goal.
const mocks = vi.hoisted(function () {
  const store = new Map();
  const stats = new Map(); // match_id -> { cards_home, cards_away }
  let selectCount = 0;
  function query(sql, params) {
    const s = String(sql);
    if (s.indexOf('SELECT id, home_team') === 0) {
      selectCount++;
      const row = store.get(params[0]);
      return Promise.resolve({ rows: row ? [row] : [] });
    }
    if (s.indexOf('UPDATE matches_cache SET live_home_score') === 0) {
      const row = store.get(params[2]);
      if (row) { row.live_home_score = params[0]; row.live_away_score = params[1]; }
      return Promise.resolve({ rows: [], rowCount: row ? 1 : 0 });
    }
    if (s.indexOf('INSERT INTO match_events') === 0) return Promise.resolve({ rows: [], rowCount: 1 });
    if (s.indexOf('INSERT INTO live_statistics') === 0) {
      const [matchId, cardsHome, cardsAway] = params;
      stats.set(matchId, { cards_home: cardsHome, cards_away: cardsAway });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  }
  return { store, stats, query, getSelectCount: function () { return selectCount; }, resetSelectCount: function () { selectCount = 0; } };
});

vi.mock('../server/db.js', function () {
  return { default: { query: mocks.query } };
});
vi.mock('../server/ws.js', function () {
  return { pushCardEvent: vi.fn(), pushLiveTick: vi.fn(), pushGoal: vi.fn(), pushGoalDisallowed: vi.fn() };
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
  mocks.stats.clear();
  mocks.resetSelectCount();
  vi.clearAllMocks();
  __resetLiveStateForTests();
  mocks.store.set('l365-62628037', {
    id: 'l365-62628037', home_team: 'Mohun Bagan SG II', away_team: 'Coal India',
    live_home_score: 3, live_away_score: 0, live_minute: '62',
  });
});

describe('applyGameDetails — live flow fix', function () {
  it('writes the new score straight into matches_cache the instant it changes', async function () {
    await applyGameDetails(tag({ EID: '62628037', T: '2288', SC: '4-0', H: 'Mohun Bagan SG II', A: 'Coal India' }));
    const row = mocks.store.get('l365-62628037');
    expect(row.live_home_score).toBe(4);
    expect(row.live_away_score).toBe(0);
  });

  it('broadcasts LIVE_TICK on the first update even with no score change (dedup baseline)', async function () {
    await applyGameDetails(tag({ EID: '62628037', T: '2290', SC: '3-0', H: 'Mohun Bagan SG II', A: 'Coal India' }));
    expect(pushLiveTick).toHaveBeenCalledTimes(1);
    expect(pushLiveTick).toHaveBeenCalledWith('l365-62628037', expect.objectContaining({
      minute: '62', homeScore: 3, awayScore: 0,
    }));
  });

  it('broadcasts the updated score on LIVE_TICK the same tick it changes', async function () {
    await applyGameDetails(tag({ EID: '62628037', T: '2291', SC: '4-0', H: 'Mohun Bagan SG II', A: 'Coal India' }));
    expect(pushLiveTick).toHaveBeenCalledWith('l365-62628037', expect.objectContaining({
      homeScore: 4, awayScore: 0,
    }));
  });

  it('still dedupes on a non-increasing T (no DB write, no broadcast)', async function () {
    await applyGameDetails(tag({ EID: '62628037', T: '2292', SC: '4-0', H: 'Mohun Bagan SG II', A: 'Coal India' }));
    vi.clearAllMocks();
    await applyGameDetails(tag({ EID: '62628037', T: '2292', SC: '4-0', H: 'Mohun Bagan SG II', A: 'Coal India' }));
    expect(pushLiveTick).not.toHaveBeenCalled();
  });

  it('never writes to matches_cache when the score is unchanged', async function () {
    await applyGameDetails(tag({ EID: '62628037', T: '2293', SC: '3-0', H: 'Mohun Bagan SG II', A: 'Coal India' }));
    // Still 3-0 in the store (no spurious UPDATE), but LIVE_TICK still fired
    // (first tick for this match in this test — see dedup test below for
    // the repeat-tick case).
    const row = mocks.store.get('l365-62628037');
    expect(row.live_home_score).toBe(3);
    expect(pushLiveTick).toHaveBeenCalledTimes(1);
  });

  it('skips the WS broadcast on a second tick with no change (bandwidth throttle)', async function () {
    await applyGameDetails(tag({ EID: '62628037', T: '2300', SC: '3-0', H: 'Mohun Bagan SG II', A: 'Coal India' }));
    expect(pushLiveTick).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();
    // Same score/minute, T still increases (real new provider tick) — must
    // NOT re-broadcast immediately; that's the whole point of the throttle.
    await applyGameDetails(tag({ EID: '62628037', T: '2301', SC: '3-0', H: 'Mohun Bagan SG II', A: 'Coal India' }));
    expect(pushLiveTick).not.toHaveBeenCalled();
  });
});

describe('applyGameDetails — DB-skip for already-confirmed-unmatched EIDs (fast-OOM fix)', function () {
  // A GLOBAL provider feed pushes updates for every live match worldwide;
  // most never match anything we imported. A virtual/simulated fixture
  // observed in production sent updates several times a SECOND for an EID
  // that was never going to match matches_cache — every one of those still
  // cost a full DB round-trip before this fix. Once we've confirmed an EID
  // is unmatched, further updates for it must not touch the DB at all.
  it('only queries the DB once for an EID never in matches_cache, no matter how many updates arrive', async function () {
    for (let t = 1; t <= 5; t++) {
      await applyGameDetails(tag({ EID: '999999', T: String(t), SC: '0-0' }));
    }
    expect(mocks.getSelectCount()).toBe(1);
  });

  it('resumes real DB lookups for an EID once its T counter decreases (provider reused the id for a new session)', async function () {
    await applyGameDetails(tag({ EID: '888888', T: '100', SC: '0-0' }));
    expect(mocks.getSelectCount()).toBe(1);
    // Same EID, T went backwards -- most plausibly reused for a new match
    // we might actually track. Must not still be treated as "confirmed
    // unmatched" from the old session.
    await applyGameDetails(tag({ EID: '888888', T: '5', SC: '0-0' }));
    expect(mocks.getSelectCount()).toBe(2);
  });

  it('drops a hard-blocked EID before any tracking or DB work at all', async function () {
    await applyGameDetails(tag({ EID: '58729560', T: '1', SC: '0-0' }));
    expect(mocks.getSelectCount()).toBe(0);
  });

  // 52628036 specifically: a longer capture of this EID's raw feed showed
  // AT LEAST 5 distinct, unrelated real matches (different team pairs)
  // all sharing this one EID, cycling within the same few seconds -- the
  // provider multiplexes several real matches onto it. Our data model can
  // only ever attach updates to a single matches_cache row per id, so this
  // EID can never be correctly attributed to any one of them no matter how
  // it's handled -- hence hard-blocked rather than merely "unmatched".
  it('drops 52628036 specifically (multiple real matches multiplexed onto one EID upstream)', async function () {
    await applyGameDetails(tag({ EID: '52628036', T: '500', SC: '0-0', H: 'China PR (W)', A: 'Philippines (W)' }));
    await applyGameDetails(tag({ EID: '52628036', T: '4700', SC: '3-7', H: 'FC Agniputhra', A: 'South United' }));
    expect(mocks.getSelectCount()).toBe(0);
  });
});

describe('applyGameDetails — card totals reach live_statistics (the "kartona nuk vijne" fix)', function () {
  beforeEach(function () {
    mocks.store.set('l365-71000001', {
      id: 'l365-71000001', home_team: 'Home FC', away_team: 'Away FC',
      live_home_score: 0, live_away_score: 0, live_minute: '10',
    });
  });

  it('writes the aggregate cards_home/cards_away the first time a card is seen', async function () {
    await applyGameDetails(tag({ EID: '71000001', T: '100', SC: '0-0', YC1: '1', YC2: '0', RC1: '0', RC2: '0' }));
    expect(mocks.stats.get('l365-71000001')).toEqual({ cards_home: 1, cards_away: 0 });
  });

  it('keeps totals in step as more cards arrive, combining yellow + red per side', async function () {
    await applyGameDetails(tag({ EID: '71000001', T: '100', SC: '0-0', YC1: '1', YC2: '0', RC1: '0', RC2: '0' }));
    await applyGameDetails(tag({ EID: '71000001', T: '200', SC: '0-0', YC1: '2', YC2: '1', RC1: '1', RC2: '0' }));
    // home: 2 yellow + 1 red = 3, away: 1 yellow + 0 red = 1
    expect(mocks.stats.get('l365-71000001')).toEqual({ cards_home: 3, cards_away: 1 });
  });

  it('does not write live_statistics again when the card counts have not changed', async function () {
    await applyGameDetails(tag({ EID: '71000001', T: '100', SC: '0-0', YC1: '1', YC2: '0', RC1: '0', RC2: '0' }));
    mocks.stats.clear(); // if the second call writes again, the assertion below would still pass with the same numbers,
    // so instead spy on the write count directly.
    let writes = 0;
    const origSet = mocks.stats.set.bind(mocks.stats);
    mocks.stats.set = function (...args) { writes++; return origSet(...args); };
    await applyGameDetails(tag({ EID: '71000001', T: '200', SC: '0-0', YC1: '1', YC2: '0', RC1: '0', RC2: '0' })); // same counts
    expect(writes).toBe(0);
    mocks.stats.set = origSet;
  });
});
