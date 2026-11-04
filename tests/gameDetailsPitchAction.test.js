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


describe('applyGameDetails - the pitch action reaches (and stays on) the client', () => {
  const EID = '777001';
  const base = { EID, SC: '0-0', H: 'Home FC', A: 'Away FC' };
  const lastAction = () => {
    const calls = wsModule.pushLiveTick.mock.calls;
    return calls.length ? calls[calls.length - 1][1].action : undefined;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T15:00:00Z'));
    mocks.matches.set('l365-' + EID, {
      id: 'l365-' + EID, home_team: 'Home FC', away_team: 'Away FC',
      live_home_score: 0, live_away_score: 0, live_minute: '10:00', live_status: '1H',
    });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('a corner is shown, and still shown on the next messages that carry no VC', async () => {
    await applyGameDetails(tag({ ...base, T: '600', VC: '11004' }));
    expect(lastAction()).toMatchObject({ side: 'home', kind: 'corner' });
    vi.advanceTimersByTime(1000);
    await applyGameDetails(tag({ ...base, T: '601' })); // no VC at all
    vi.advanceTimersByTime(1000);
    await applyGameDetails(tag({ ...base, T: '602', VC: '99999' })); // undecodable code
    expect(lastAction()).toMatchObject({ side: 'home', kind: 'corner' });
  });

  it('the held action stays on the pitch until the next action arrives (not just a few seconds), and only a long silence clears it', async () => {
    await applyGameDetails(tag({ ...base, T: '600', VC: '21000' }));
    expect(lastAction()).toMatchObject({ side: 'away', kind: 'dangerous_attack' });
    vi.advanceTimersByTime(60000);
    await applyGameDetails(tag({ ...base, T: '660' }));
    expect(lastAction()).toMatchObject({ side: 'away', kind: 'dangerous_attack' });
    vi.advanceTimersByTime(125000); // past the safety cap with nothing newer
    await applyGameDetails(tag({ ...base, T: '785' }));
    expect(lastAction()).toBeNull();
  });

  it('a free kick / "goditje dënimi" (VC 11236) stays on screen until the next action', async () => {
    await applyGameDetails(tag({ ...base, T: '4827', VC: '11236' }));
    expect(lastAction()).toEqual({ side: 'home', kind: 'free_kick', label: 'Gjuajtje e lirë' });
    vi.advanceTimersByTime(30000);
    await applyGameDetails(tag({ ...base, T: '4857' }));
    expect(lastAction()).toMatchObject({ side: 'home', kind: 'free_kick' });
    vi.advanceTimersByTime(1000);
    await applyGameDetails(tag({ ...base, T: '4858', VC: '21002' }));
    expect(lastAction()).toMatchObject({ side: 'away', kind: 'possession' });
  });

  it('the final whistle (VC 1017) shows "Ndeshja mbaroi" with no side and the old action does not come back', async () => {
    await applyGameDetails(tag({ ...base, T: '5300', VC: '11004' }));
    vi.advanceTimersByTime(1000);
    await applyGameDetails(tag({ ...base, T: '5400', TT: '0', VC: '1017' }));
    expect(lastAction()).toEqual({ side: null, kind: 'full_time', label: 'Ndeshja mbaroi' });
    vi.advanceTimersByTime(1000);
    await applyGameDetails(tag({ ...base, T: '5401' }));
    expect(lastAction()).toBeNull();
  });

  it('a decoded action that is newer than a counter-derived one is the one held on quiet messages', async () => {
    await applyGameDetails(tag({ ...base, T: '600', C1: '0', C2: '0' })); // baseline
    vi.advanceTimersByTime(1000);
    await applyGameDetails(tag({ ...base, T: '601', C1: '1', C2: '0' })); // home corner read from the counter
    expect(lastAction()).toMatchObject({ side: 'home', kind: 'corner' });
    vi.advanceTimersByTime(1000);
    await applyGameDetails(tag({ ...base, T: '602', C1: '1', C2: '0', VC: '21024' })); // then an away throw-in
    expect(lastAction()).toMatchObject({ side: 'away', kind: 'throw_in' });
    vi.advanceTimersByTime(1000);
    await applyGameDetails(tag({ ...base, T: '603', C1: '1', C2: '0' })); // quiet message
    expect(lastAction()).toMatchObject({ side: 'away', kind: 'throw_in' });
  });

  it('a newer action replaces the held one', async () => {
    await applyGameDetails(tag({ ...base, T: '600', VC: '11004' }));
    vi.advanceTimersByTime(1000);
    await applyGameDetails(tag({ ...base, T: '601', VC: '21001' }));
    expect(lastAction()).toMatchObject({ side: 'away', kind: 'attack' });
  });

  it('a message with the SAME clock but a new VC is processed, not dropped as a duplicate', async () => {
    await applyGameDetails(tag({ ...base, T: '600' }));
    wsModule.pushLiveTick.mockClear();
    await applyGameDetails(tag({ ...base, T: '600', VC: '11004' }));
    expect(lastAction()).toMatchObject({ side: 'home', kind: 'corner' });
  });

  it('a truly identical repeat (same clock, same VC, same counters) is still skipped', async () => {
    await applyGameDetails(tag({ ...base, T: '600', VC: '11004' }));
    const n = wsModule.pushLiveTick.mock.calls.length;
    await applyGameDetails(tag({ ...base, T: '600', VC: '11004' }));
    expect(wsModule.pushLiveTick.mock.calls.length).toBe(n);
  });

  it('an unmapped VC code is logged once so it can be labelled', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await applyGameDetails(tag({ ...base, T: '600', VC: '31337' }));
    vi.advanceTimersByTime(1000);
    await applyGameDetails(tag({ ...base, T: '601', VC: '31337' }));
    const hits = log.mock.calls.filter((c) => String(c[0]).includes('unmapped VC code "31337"'));
    log.mockRestore();
    expect(hits.length).toBe(1);
  });
});
