import { describe, it, expect, vi, beforeEach } from 'vitest';

// A goal must reach connected clients WITHOUT waiting on Postgres. The push is
// driven from memory the moment the provider tick arrives; persistence follows.
const mocks = vi.hoisted(function () {
  const store = new Map();
  let releaseUpdate = null;
  const query = vi.fn(function (sql, params) {
    const s = String(sql);
    if (s.indexOf('SELECT id, home_team') === 0) { const r = store.get(params[0]); return Promise.resolve({ rows: r ? [{ ...r }] : [] }); }
    if (s.indexOf('UPDATE matches_cache SET live_home_score') === 0) {
      // a slow database: the UPDATE does not complete until the test releases it
      return new Promise(function (resolve) { releaseUpdate = function () { resolve({ rows: [], rowCount: 1 }); }; });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
  return { store, query, release: () => releaseUpdate && releaseUpdate() };
});
vi.mock('../server/db.js', () => ({ default: { query: mocks.query } }));
vi.mock('../server/ws.js', () => ({
  pushCardEvent: vi.fn(), pushLiveTick: vi.fn(), pushGoal: vi.fn(), pushGoalDisallowed: vi.fn(),
}));
const recordGoalIfChanged = vi.fn().mockResolvedValue(undefined);
vi.mock('../server/london365.js', () => ({ recordGoalIfChanged, minuteToNumber: () => null }));

const { applyGameDetails, __resetLiveStateForTests } = await import('../server/london365GameDetails.js');
const { announceGoalIfChanged, clearGoalAnnounced, __resetGoalAnnouncerForTests } = await import('../server/goalAnnouncer.js');
const ws = await import('../server/ws.js');

const tag = (a) => '<Detaje ' + Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ') + ' />';
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mocks.store.clear(); mocks.query.mockClear(); vi.clearAllMocks();
  __resetLiveStateForTests(); __resetGoalAnnouncerForTests();
  mocks.store.set('l365-10', { id: 'l365-10', home_team: 'A', away_team: 'B', live_home_score: 0, live_away_score: 0, live_minute: '30' });
});

describe('applyGameDetails - goal is pushed before the database write completes', () => {
  it('pushGoal and the LIVE_TICK with the new score fire while the score UPDATE is still pending', async () => {
    await applyGameDetails(tag({ EID: '10', T: '1', SC: '0-0', H: 'A', A: 'B' })); // baseline tick
    ws.pushLiveTick.mockClear();
    recordGoalIfChanged.mockClear(); // it runs every tick; only the goal tick matters here
    recordGoalIfChanged.mockClear(); // it runs on every tick; only the goal tick matters here

    const pending = applyGameDetails(tag({ EID: '10', T: '2', SC: '1-0', H: 'A', A: 'B' }));
    await flush(); // let the synchronous part run; the UPDATE has NOT resolved

    expect(ws.pushGoal).toHaveBeenCalledTimes(1);
    expect(ws.pushGoal).toHaveBeenCalledWith('l365-10', expect.objectContaining({ homeScore: 1, awayScore: 0, scoringTeam: 'A' }));
    expect(ws.pushLiveTick).toHaveBeenCalledWith('l365-10', expect.objectContaining({ homeScore: 1, awayScore: 0 }));
    expect(recordGoalIfChanged).not.toHaveBeenCalled(); // persistence hasn't started yet

    mocks.release();
    await pending;
    expect(recordGoalIfChanged).toHaveBeenCalledTimes(1); // ...and still happens afterwards
    expect(ws.pushGoal).toHaveBeenCalledTimes(1);         // never announced twice
  });

  it('a card is pushed before its match_events row is written', async () => {
    await applyGameDetails(tag({ EID: '10', T: '1', SC: '0-0', H: 'A', A: 'B' }));
    const order = [];
    ws.pushCardEvent.mockImplementation(() => order.push('push'));
    mocks.query.mockImplementation((sql) => {
      if (String(sql).indexOf('INSERT INTO match_events') === 0) order.push('insert');
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    await applyGameDetails(tag({ EID: '10', T: '2', SC: '0-0', H: 'A', A: 'B', YC1: '1' }));
    expect(order).toEqual(['push', 'insert']);
  });
});

describe('announceGoalIfChanged', () => {
  const ev = { id: 'l365-1', home_team: 'A', away_team: 'B' };
  it('announces a home goal, an away goal and a disallowed goal', () => {
    announceGoalIfChanged(ev, { home: 1, away: 0 }, '10', { live_home_score: 0, live_away_score: 0 });
    announceGoalIfChanged(ev, { home: 1, away: 1 }, '20', { live_home_score: 1, live_away_score: 0 });
    announceGoalIfChanged(ev, { home: 0, away: 1 }, '25', { live_home_score: 1, live_away_score: 1 });
    expect(ws.pushGoal).toHaveBeenCalledTimes(2);
    expect(ws.pushGoal.mock.calls[1][1]).toEqual(expect.objectContaining({ scoringTeam: 'B' }));
    expect(ws.pushGoalDisallowed).toHaveBeenCalledTimes(1);
  });
  it('the same score change is announced once even if two paths detect it', () => {
    const prev = { live_home_score: 0, live_away_score: 0 };
    expect(announceGoalIfChanged(ev, { home: 1, away: 0 }, '10', prev)).toBe(true);
    expect(announceGoalIfChanged(ev, { home: 1, away: 0 }, '10', prev)).toBe(false);
    expect(ws.pushGoal).toHaveBeenCalledTimes(1);
  });
  it('a goal-disallowed-then-scored-again sequence is announced each time', () => {
    announceGoalIfChanged(ev, { home: 1, away: 0 }, '10', { live_home_score: 0, live_away_score: 0 });
    announceGoalIfChanged(ev, { home: 0, away: 0 }, '12', { live_home_score: 1, live_away_score: 0 });
    announceGoalIfChanged(ev, { home: 1, away: 0 }, '14', { live_home_score: 0, live_away_score: 0 });
    expect(ws.pushGoal).toHaveBeenCalledTimes(2);
    expect(ws.pushGoalDisallowed).toHaveBeenCalledTimes(1);
  });
  it('a reused id (different match) is not silenced by the previous match\'s last score', () => {
    announceGoalIfChanged(ev, { home: 1, away: 0 }, '10', { live_home_score: 0, live_away_score: 0 });
    clearGoalAnnounced(ev.id);
    announceGoalIfChanged(ev, { home: 1, away: 0 }, '10', { live_home_score: 0, live_away_score: 0 });
    expect(ws.pushGoal).toHaveBeenCalledTimes(2);
  });
  it('does nothing when the score did not change', () => {
    expect(announceGoalIfChanged(ev, { home: 2, away: 1 }, '80', { live_home_score: 2, live_away_score: 1 })).toBe(false);
    expect(ws.pushGoal).not.toHaveBeenCalled();
  });
});
