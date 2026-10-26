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
    if (s.startsWith('UPDATE matches_cache SET ht_home')) return Promise.resolve({ rows: [] });
    if (s.startsWith('UPDATE matches_cache SET live_status')) {
      const row = matches.get(params[1]);
      if (row) row.live_status = params[0];
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

  it('stays in HT for the whole break even when the provider status is an unknown numeric code', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-25T18:00:00Z'));
      seed('3');
      await applyGameDetails(tag({ ...base, VC: '1015', T: '2700' }));
      expect(lastTick().liveStatus).toBe('HT');
      // 10 minutes later: quiet ticks, REST still sends its numeric status
      vi.setSystemTime(new Date('2026-10-25T18:10:00Z'));
      mocks.matches.get('l365-' + EID).live_status = '3';
      await applyGameDetails(tag({ ...base, VC: '', T: '2700' }));
      expect(lastTick().liveStatus).toBe('HT');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a substitution during the break does not end it', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-25T18:00:00Z'));
      seed('3');
      await applyGameDetails(tag({ ...base, VC: '1015', T: '2700' }));
      vi.setSystemTime(new Date('2026-10-25T18:05:00Z'));
      await applyGameDetails(tag({ ...base, VC: '11013', T: '2700' }));
      expect(lastTick().liveStatus).toBe('HT');
    } finally {
      vi.useRealTimers();
    }
  });

  it('the first gameplay action after the break restarts the clock (2H)', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-25T18:00:00Z'));
      seed('3');
      await applyGameDetails(tag({ ...base, VC: '1015', T: '2700' }));
      vi.setSystemTime(new Date('2026-10-25T18:15:00Z'));
      await applyGameDetails(tag({ ...base, VC: '11001', T: '2705' }));
      expect(lastTick().liveStatus).toBe('2H');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a gameplay message right after the whistle (out of order) does not cancel HT', async () => {
    seed('1H');
    await applyGameDetails(tag({ ...base, VC: '1015', T: '2700' }));
    await applyGameDetails(tag({ ...base, VC: '21001', T: '2699' }));
    expect(lastTick().liveStatus).toBe('HT');
  });

  it('gives up after 20 minutes so a missed restart cannot leave HT on forever', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-25T18:00:00Z'));
      seed('2H');
      await applyGameDetails(tag({ ...base, VC: '1015', T: '2700' }));
      vi.setSystemTime(new Date('2026-10-25T18:21:00Z'));
      mocks.matches.get('l365-' + EID).live_status = '2H';
      await applyGameDetails(tag({ ...base, VC: '', T: '3900' }));
      expect(lastTick().liveStatus).toBe('2H');
    } finally {
      vi.useRealTimers();
    }
  });
});
