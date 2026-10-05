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

describe('applyGameDetails - half time reaches clients through the live tick', () => {
  const EID = '52628036-test';
  const base = { EID, SC: '2-1', H: 'Odd 2', A: 'Viking 2' };

  function seed(live_status) {
    mocks.matches.set('l365-' + EID, {
      id: 'l365-' + EID, home_team: 'Odd 2', away_team: 'Viking 2',
      live_home_score: 2, live_away_score: 1, live_minute: '44:59', live_status,
    });
  }
  const lastTick = () => wsModule.pushLiveTick.mock.calls.at(-1)[1];

  it('VC=1015 (pushim) is sent as liveStatus HT even while REST still says 1H', async () => {
    seed('1H');
    await applyGameDetails(tag({ ...base, VC: '1015', T: '2700' }));
    expect(lastTick()).toMatchObject({ liveStatus: 'HT', action: { kind: 'half_time', side: null } });
  });

  it('keeps HT for the next quiet tick (a single empty VC must not restart the clock)', async () => {
    seed('1H');
    await applyGameDetails(tag({ ...base, VC: '1015', T: '2700' }));
    await applyGameDetails(tag({ ...base, VC: '', T: '2701' }));
    expect(lastTick().liveStatus).toBe('HT');
  });

  it("passes the provider's own status through, so the second half restarts the clock", async () => {
    seed('2H');
    await applyGameDetails(tag({ ...base, VC: '', T: '2760' }));
    expect(lastTick().liveStatus).toBe('2H');
  });

  it("passes the provider's HT status through without any VC", async () => {
    seed('HT');
    await applyGameDetails(tag({ ...base, VC: '', T: '2760' }));
    expect(lastTick().liveStatus).toBe('HT');
  });
});
