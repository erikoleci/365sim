import { describe, it, expect, vi, beforeEach } from 'vitest';

function tag(attrs) {
  return '<Detaje ' + Object.entries(attrs).map(([k, v]) => k + '="' + v + '"').join(' ') + ' />';
}

const mocks = vi.hoisted(function () {
  const matches = new Map();
  const log = [];
  function query(sql, params = []) {
    const s = String(sql);
    log.push({ s, params });
    if (s.startsWith('SELECT id, home_team, away_team, live_home_score')) {
      const row = matches.get(params[0]);
      return Promise.resolve({ rows: row ? [{ ...row }] : [] });
    }
    return Promise.resolve({ rows: [] });
  }
  return { matches, log, pool: { query } };
});

vi.mock('../server/db.js', () => ({ default: mocks.pool, pool: mocks.pool }));
vi.mock('../server/ws.js', () => ({
  pushCardEvent: vi.fn(), pushLiveTick: vi.fn(), pushGoal: vi.fn(), pushGoalDisallowed: vi.fn(),
  pushMatchEnded: vi.fn(), pushOddsChanged: vi.fn(),
}));
vi.mock('../server/london365.js', () => ({
  recordGoalIfChanged: vi.fn().mockResolvedValue(undefined),
  minuteToNumber: (m) => (m ? Number(String(m).replace(/[^\d]/g, '')) || null : null),
}));

const { applyGameDetails, __resetLiveStateForTests } = await import('../server/london365GameDetails.js');

const EID = '777-test';
const frame = (o = {}) => tag({ EID, SC: '0-0', H: 'A', A: 'B', T: '1200', C1: '0', C2: '0', YC1: '0', YC2: '0', RC1: '0', RC2: '0', ...o });
const stats = () => mocks.log.filter((q) => q.s.includes('live_statistics'));

beforeEach(() => {
  mocks.matches.clear();
  mocks.log.length = 0;
  __resetLiveStateForTests();
  mocks.matches.set('l365-' + EID, {
    id: 'l365-' + EID, home_team: 'A', away_team: 'B', live_home_score: 0, live_away_score: 0,
    live_status: '1H', live_minute: "20:00", live_minute_updated_at: Date.now(), status: 'LIVE',
  });
});

describe('live_statistics keeps corners alive while nothing changes', () => {
  it('writes explicit 0-0 corners on the first message of a match', async () => {
    await applyGameDetails(frame());
    const w = stats().find((q) => q.s.includes('corners_home'));
    expect(w).toBeTruthy();
    expect(w.params.slice(1, 3)).toEqual([0, 0]);
  });

  it('touches updated_at every ~20 s even when no counter changed (so the stats are never judged stale)', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-26T15:00:00Z'));
      await applyGameDetails(frame());
      mocks.log.length = 0;
      vi.setSystemTime(new Date('2026-10-26T15:00:05Z'));
      await applyGameDetails(frame({ T: '1205' }));
      expect(stats().filter((q) => q.s.startsWith('UPDATE live_statistics SET updated_at'))).toHaveLength(0); // throttled
      vi.setSystemTime(new Date('2026-10-26T15:00:25Z'));
      await applyGameDetails(frame({ T: '1225' }));
      const touch = stats().filter((q) => q.s.startsWith('UPDATE live_statistics SET updated_at'));
      expect(touch).toHaveLength(1);
      expect(touch[0].params[0]).toBe('l365-' + EID);
    } finally {
      vi.useRealTimers();
    }
  });
});
