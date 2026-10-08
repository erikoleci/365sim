import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    if (s.startsWith('UPDATE matches_cache SET live_minute')) {
      const row = matches.get(params[2]);
      if (row) { row.live_minute = params[0]; }
      return Promise.resolve({ rows: [] });
    }
    if (s.startsWith('SELECT 1 FROM match_events')) {
      return Promise.resolve({ rows: [] });
    }
    if (s.startsWith('INSERT INTO match_events')) {
      return Promise.resolve({ rows: [] });
    }
    if (s.startsWith('INSERT INTO live_statistics')) {
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


describe('applyGameDetails - LIVE_TICK volume (80 live matches must not flood clients)', () => {
  const EID = '880001';
  const base = { EID, SC: '0-0', H: 'Home FC', A: 'Away FC' };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T15:00:00Z'));
    // No REST minute: the common case, the clock is derived from T (mm:ss).
    mocks.matches.set('l365-' + EID, {
      id: 'l365-' + EID, home_team: 'Home FC', away_team: 'Away FC',
      live_home_score: 0, live_away_score: 0, live_minute: null, live_status: '1H',
    });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('a clock that only ticks seconds does not produce a broadcast per second', async () => {
    for (let t = 600; t < 610; t++) {
      await applyGameDetails(tag({ ...base, T: String(t) }));
      vi.advanceTimersByTime(1000);
    }
    // 10 seconds of play, nothing happened: first tick only (clients tick the clock themselves).
    expect(wsModule.pushLiveTick.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('still resyncs the clock periodically so client clocks cannot drift', async () => {
    for (let t = 600; t < 640; t++) {
      await applyGameDetails(tag({ ...base, T: String(t) }));
      vi.advanceTimersByTime(1000);
    }
    const n = wsModule.pushLiveTick.mock.calls.length;
    expect(n).toBeGreaterThanOrEqual(2); // 40s => at least a couple of 15s resyncs
    expect(n).toBeLessThanOrEqual(4);
  });

  it('a new whole minute is broadcast immediately', async () => {
    await applyGameDetails(tag({ ...base, T: '658' }));
    const before = wsModule.pushLiveTick.mock.calls.length;
    vi.advanceTimersByTime(1000);
    await applyGameDetails(tag({ ...base, T: '659' }));
    expect(wsModule.pushLiveTick.mock.calls.length).toBe(before);
    vi.advanceTimersByTime(1000);
    await applyGameDetails(tag({ ...base, T: '660' }));
    expect(wsModule.pushLiveTick.mock.calls.length).toBe(before + 1);
  });

  it('a score change is broadcast at once', async () => {
    await applyGameDetails(tag({ ...base, T: '700' }));
    const before = wsModule.pushLiveTick.mock.calls.length;
    vi.advanceTimersByTime(1000);
    await applyGameDetails(tag({ ...base, T: '701', SC: '1-0' }));
    expect(wsModule.pushLiveTick.mock.calls.length).toBeGreaterThan(before);
    const last = wsModule.pushLiveTick.mock.calls.at(-1)[1];
    expect(last.homeScore).toBe(1);
  });
});
