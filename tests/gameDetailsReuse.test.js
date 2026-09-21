import { describe, it, expect, vi, beforeEach } from 'vitest';

function tag(attrs) {
  return '<Detaje ' + Object.entries(attrs).map(([k, v]) => k + '="' + v + '"').join(' ') + ' />';
}

const mocks = vi.hoisted(function () {
  const matches = new Map();
  function reset() {
    matches.clear();
  }
  reset();
  function query(sql, params = []) {
    const s = String(sql);
    if (s.startsWith('SELECT id, home_team, away_team, live_home_score')) {
      const row = matches.get(params[0]);
      return Promise.resolve({ rows: row ? [{ ...row }] : [] });
    }
    if (s.startsWith('UPDATE matches_cache SET live_home_score')) {
      const row = matches.get(params[2]);
      if (row) { row.live_home_score = params[0]; row.live_away_score = params[1]; }
      return Promise.resolve({ rows: [] });
    }
    if (s.startsWith('INSERT INTO match_events')) {
      return Promise.resolve({ rows: [] });
    }
    throw new Error('unmocked query: ' + s);
  }
  const pool = { query };
  return { matches, reset, pool };
});

vi.mock('../server/db.js', () => ({ default: mocks.pool, pool: mocks.pool }));
vi.mock('../server/ws.js', () => ({
  pushCardEvent: vi.fn(),
  pushLiveTick: vi.fn(),
  pushGoal: vi.fn(),
  pushGoalDisallowed: vi.fn(),
  pushMatchEnded: vi.fn(),
  pushOddsChanged: vi.fn(),
}));

const recordGoalIfChanged = vi.fn().mockResolvedValue(undefined);
vi.mock('../server/london365.js', () => ({
  recordGoalIfChanged,
  minuteToNumber: (m) => (m ? Number(String(m).replace(/[^\d]/g, '')) || null : null),
}));

const { applyGameDetails, __resetLiveStateForTests } = await import('../server/london365GameDetails.js');
const wsModule = await import('../server/ws.js');

beforeEach(() => {
  mocks.reset();
  __resetLiveStateForTests();
  recordGoalIfChanged.mockClear();
  wsModule.pushLiveTick.mockClear();
  wsModule.pushCardEvent.mockClear();
});

describe('applyGameDetails - T going backwards (EID reuse) must not permanently freeze the new match', () => {
  it('processes a normal update with an increasing T (baseline case)', async () => {
    mocks.matches.set('l365-62628037', {
      id: 'l365-62628037', home_team: 'Team A', away_team: 'Team B',
      live_home_score: 0, live_away_score: 0, live_minute: '10',
    });
    await applyGameDetails(tag({ EID: '62628037', T: '100', SC: '0-0', H: 'Team A', A: 'Team B' }));
    expect(wsModule.pushLiveTick).toHaveBeenCalledTimes(1);
  });

  it('skips an EXACT repeat of the same T (genuine duplicate resend)', async () => {
    mocks.matches.set('l365-1', { id: 'l365-1', home_team: 'A', away_team: 'B', live_home_score: 1, live_away_score: 0, live_minute: '20' });
    await applyGameDetails(tag({ EID: '1', T: '500', SC: '1-0', H: 'A', A: 'B' }));
    wsModule.pushLiveTick.mockClear();
    await applyGameDetails(tag({ EID: '1', T: '500', SC: '1-0', H: 'A', A: 'B' }));
    expect(wsModule.pushLiveTick).not.toHaveBeenCalled();
  });

  it('does NOT freeze forever once T decreases -- resumes processing instead of silently dropping every future update', async () => {
    mocks.matches.set('l365-1', { id: 'l365-1', home_team: 'A', away_team: 'B', live_home_score: 3, live_away_score: 1, live_minute: '88' });
    await applyGameDetails(tag({ EID: '1', T: '9000', SC: '3-1', H: 'A', A: 'B' }));
    mocks.matches.get('l365-1').live_home_score = 0;
    mocks.matches.get('l365-1').live_away_score = 0;
    wsModule.pushLiveTick.mockClear();
    await applyGameDetails(tag({ EID: '1', T: '50', SC: '0-0', H: 'A', A: 'B' }));
    expect(wsModule.pushLiveTick).toHaveBeenCalledTimes(1);

    wsModule.pushLiveTick.mockClear();
    await applyGameDetails(tag({ EID: '1', T: '51', SC: '1-0', H: 'A', A: 'B' }));
    expect(wsModule.pushLiveTick).toHaveBeenCalledTimes(1);
  });

  it('does not fabricate/miss a card event using the OLD match leftover card counts after a T-decrease reset', async () => {
    mocks.matches.set('l365-1', { id: 'l365-1', home_team: 'A', away_team: 'B', live_home_score: 1, live_away_score: 0, live_minute: '85' });
    await applyGameDetails(tag({ EID: '1', T: '9000', SC: '1-0', H: 'A', A: 'B', YC1: '3' }));
    wsModule.pushCardEvent.mockClear();
    await applyGameDetails(tag({ EID: '1', T: '10', SC: '0-0', H: 'A', A: 'B', YC1: '1' }));
    expect(wsModule.pushCardEvent).toHaveBeenCalledTimes(1);
  });
});
