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

const { applyGameDetails, __resetLiveStateForTests, getGameDetailsMemoryDiagnostics } = await import('../server/london365GameDetails.js');
const wsModule = await import('../server/ws.js');

beforeEach(() => {
  mocks.reset();
  __resetLiveStateForTests();
  recordGoalIfChanged.mockClear();
  wsModule.pushLiveTick.mockClear();
  wsModule.pushCardEvent.mockClear();
});



describe('applyGameDetails - cost per message must not grow with the number of live matches', () => {
  it('with 6,000 tracked matches the stale-state sweep runs at most once, not once per message', async () => {
    const N = 6000;
    for (let i = 0; i < N; i++) {
      mocks.matches.set('l365-' + (700000 + i), { id: 'l365-' + (700000 + i), home_team: 'H' + i, away_team: 'A' + i, live_home_score: 0, live_away_score: 0, live_minute: null, live_status: '1H' });
    }
    for (let r = 0; r < 3; r++) {
      await Promise.all(Array.from({ length: N }, (_, i) => applyGameDetails(tag({ EID: String(700000 + i), SC: '0-0', H: 'H' + i, A: 'A' + i, T: String(600 + r) }))));
    }
    // 18,000 messages went through; the sweep (a full pass over every tracked match)
    // used to run for each message once >5,000 were tracked.
    expect(getGameDetailsMemoryDiagnostics().pruneRuns).toBeLessThanOrEqual(1);
  }, 60000);
});
