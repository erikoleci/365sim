import { describe, it, expect, vi, beforeEach } from 'vitest';

// recordGoalIfChanged is the shared goal-detection logic used by both the
// live-sync loop and the fast gamedetails socket. This test exists because
// the original implementation treated ANY score change as a new goal —
// including the score going DOWN (VAR overturns an earlier goal, or the
// provider corrects a miskeyed score) — and attributed it to the WRONG
// team (a home-goal retraction fell through to "away scored"), pushing a
// fabricated GOAL event to every connected client. See the fix + comment
// in server/london365.js.

const mocks = vi.hoisted(function () {
  const events = []; // match_events rows, in insertion order
  let nextId = 1;
  const query = vi.fn((sql, params) => {
    const s = String(sql);
    if (s.indexOf('INSERT INTO match_events') === 0) {
      // Columns: (match_id, minute, type, team, detail, created_at) — but
      // type is the literal 'GOAL' in the SQL, not a bound param, so params
      // are [match_id, minute, team, detail, created_at].
      events.push({ id: nextId++, match_id: params[0], minute: params[1], type: 'GOAL', team: params[2], detail: params[3] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (s.indexOf('SELECT id FROM match_events') === 0) {
      const [matchId, team] = params;
      const match = events
        .filter((e) => e.match_id === matchId && e.type === 'GOAL' && e.team === team)
        .sort((a, b) => b.id - a.id)[0];
      return Promise.resolve({ rows: match ? [{ id: match.id }] : [] });
    }
    if (s.indexOf('DELETE FROM match_events') === 0) {
      const idx = events.findIndex((e) => e.id === params[0]);
      if (idx !== -1) events.splice(idx, 1);
      return Promise.resolve({ rows: [], rowCount: idx !== -1 ? 1 : 0 });
    }
    if (s.indexOf('INSERT INTO live_statistics') === 0) return Promise.resolve({ rows: [], rowCount: 1 });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  return { events, query };
});

vi.mock('../server/db.js', function () {
  return { default: { query: mocks.query }, getKV: vi.fn(), setKV: vi.fn() };
});
vi.mock('../server/ws.js', function () {
  return { pushOddsChanged: vi.fn(), pushGoal: vi.fn(), pushGoalDisallowed: vi.fn(), pushMatchEnded: vi.fn() };
});
vi.mock('../server/matchSettlement.js', function () {
  return { settleMatch: vi.fn() };
});

import { recordGoalIfChanged } from '../server/london365.js';
import { pushGoal, pushGoalDisallowed } from '../server/ws.js';

const ev = { id: 'l365-1', home_team: 'Home FC', away_team: 'Away FC' };

beforeEach(function () {
  mocks.events.length = 0;
  vi.clearAllMocks();
});

describe('recordGoalIfChanged', function () {
  it('logs a real home goal and pushes GOAL attributed to the home team', async function () {
    await recordGoalIfChanged(ev, { home: 1, away: 0 }, '23', { live_home_score: 0, live_away_score: 0 });
    expect(pushGoal).toHaveBeenCalledWith('l365-1', expect.objectContaining({ scoringTeam: 'Home FC', homeScore: 1, awayScore: 0 }));
    expect(pushGoalDisallowed).not.toHaveBeenCalled();
    expect(mocks.events).toEqual([expect.objectContaining({ team: 'Home FC' })]);
  });

  it('a disallowed HOME goal pushes GOAL_DISALLOWED for the HOME team, never a fabricated away goal', async function () {
    // Home scored (1-0), then VAR overturns it back to 0-0.
    await recordGoalIfChanged(ev, { home: 1, away: 0 }, '23', { live_home_score: 0, live_away_score: 0 });
    vi.clearAllMocks();
    await recordGoalIfChanged(ev, { home: 0, away: 0 }, '24', { live_home_score: 1, live_away_score: 0 });

    expect(pushGoal).not.toHaveBeenCalled();
    expect(pushGoalDisallowed).toHaveBeenCalledWith('l365-1', expect.objectContaining({ team: 'Home FC', homeScore: 0, awayScore: 0 }));
    // The earlier fabricated-goal bug would have left the bogus event
    // behind; the fix retracts it instead.
    expect(mocks.events).toEqual([]);
  });

  it('a disallowed AWAY goal is attributed to the away team, not silently dropped or misattributed', async function () {
    await recordGoalIfChanged(ev, { home: 0, away: 1 }, '60', { live_home_score: 0, live_away_score: 0 });
    vi.clearAllMocks();
    await recordGoalIfChanged(ev, { home: 0, away: 0 }, '61', { live_home_score: 0, live_away_score: 1 });

    expect(pushGoalDisallowed).toHaveBeenCalledWith('l365-1', expect.objectContaining({ team: 'Away FC', homeScore: 0, awayScore: 0 }));
    expect(mocks.events).toEqual([]);
  });

  it('does nothing when the score has not actually changed', async function () {
    await recordGoalIfChanged(ev, { home: 1, away: 1 }, '50', { live_home_score: 1, live_away_score: 1 });
    expect(pushGoal).not.toHaveBeenCalled();
    expect(pushGoalDisallowed).not.toHaveBeenCalled();
    expect(mocks.events).toEqual([]);
  });
});
