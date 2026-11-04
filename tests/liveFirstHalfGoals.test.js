import { describe, it, expect, beforeEach } from 'vitest';
import { getBetBlockReason, nextEventKind } from '../server/marketRules.js';
import { setGoalPause, noteOddsUpdate, isGoalPaused, __resetGoalPauseForTests } from '../server/goalPause.js';
import { isPureFirstHalfMarket } from '../server/matchSettlement.js';

const now = Date.now();
const row = (h, a, minute, extra = {}) => ({ id: 'l365-77', home_team: 'Home FC', away_team: 'Away FC', start_time: new Date(now - 30 * 60000).toISOString(), live_home_score: h, live_away_score: a, live_minute: minute, status: 'LIVE', live_status: null, ...extra });
const reason = (r, name, opt) => getBetBlockReason(r, { id: name, name }, { id: opt, name: opt }, now);

describe('first-half goal markets in play ("Shenon Golin e N Pjesa1")', () => {
  it('goal 1 is offered at 0-0 in the first half, for 1, 2 and X', () => {
    for (const o of ['1', '2', 'X']) expect(reason(row(0, 0, "20'"), 'Shenon Golin e 1 Pjesa1', o)).toBeNull();
  });
  it('closes once that goal is in (the outcome is known)', () => {
    expect(reason(row(1, 0, "30'"), 'Shenon Golin e 1 Pjesa1', '1')).toBe('OUTCOME_DECIDED');
    expect(reason(row(0, 1, "30'"), 'Shenon Golin e 1 Pjesa1', 'X')).toBe('OUTCOME_DECIDED');
  });
  it('goal 2 opens only while exactly one goal is in', () => {
    expect(reason(row(0, 0, "20'"), 'Shenon Golin e 2 Pjesa1', '1')).toBe('OUTCOME_DECIDED');
    expect(reason(row(1, 0, "30'"), 'Shenon Golin e 2 Pjesa1', '2')).toBeNull();
    expect(reason(row(1, 1, "40'"), 'Shenon Golin e 2 Pjesa1', '2')).toBe('OUTCOME_DECIDED');
  });
  it('closes in the last minutes before the break and after it', () => {
    expect(reason(row(0, 0, "43'"), 'Shenon Golin e 1 Pjesa1', '1')).toBeNull();
    expect(reason(row(0, 0, "44'"), 'Shenon Golin e 1 Pjesa1', '1')).toBe('HALF_CLOSING');
    expect(reason(row(0, 0, "46'", { live_status: 'HT' }), 'Shenon Golin e 1 Pjesa1', '1')).toBe('FIRST_HALF_OVER');
  });
  it('a player name is never an option', () => {
    expect(reason(row(0, 0, "20'"), 'Shenon Golin e 1 Pjesa1', 'Haaland')).not.toBeNull();
  });
  it('is decided at the whistle, not at full time', () => {
    expect(isPureFirstHalfMarket('Shenon Golin e 1 Pjesa1')).toBe(true);
    expect(isPureFirstHalfMarket('Shenon Golin e 3 (skuadra)')).toBe(false);
  });
});

describe('first-half over/under lines', () => {
  it('a line the first-half goals already passed is closed, the others stay open', () => {
    expect(reason(row(1, 0, "30'"), 'Lart/Poshte Pjesa 1', 'Lart 0.5')).toBe('OUTCOME_DECIDED');
    expect(reason(row(1, 0, "30'"), 'Lart/Poshte Pjesa 1', 'Poshte 0.5')).toBe('OUTCOME_DECIDED');
    expect(reason(row(1, 0, "30'"), 'Lart/Poshte Pjesa 1', 'Lart 1.5')).toBeNull();
  });
});

describe('next goal in a half is never treated as the next goal of the match', () => {
  it('abbreviated half names fall outside the whole-match next-goal market', () => {
    expect(nextEventKind('Gol i radhes 1H')).toBeNull();
    expect(nextEventKind('Goli i radhes')).toBe('goal');
  });
});

describe('goal pause', () => {
  beforeEach(() => __resetGoalPauseForTests());
  it('holds every market for 10 s, then until fresh odds arrive, at most 30 s', () => {
    const t0 = 1_000_000;
    setGoalPause('l365-5', t0);
    expect(isGoalPaused('l365-5', t0 + 1000)).toBe(true);
    noteOddsUpdate('l365-5', t0 + 2000);
    expect(isGoalPaused('l365-5', t0 + 9000)).toBe(true);   // odds came but 10 s have not passed
    expect(isGoalPaused('l365-5', t0 + 10500)).toBe(false); // both conditions met
    setGoalPause('l365-6', t0);
    expect(isGoalPaused('l365-6', t0 + 20000)).toBe(true);  // no new odds yet: still paused
    expect(isGoalPaused('l365-6', t0 + 30500)).toBe(false); // safety cap
  });
  it('shows up as a closed reason for every market of that match only', () => {
    setGoalPause('l365-77', now);
    expect(reason(row(1, 0, "30'"), 'Rezultati Final', '1')).toBe('GOAL_PAUSE');
    expect(getBetBlockReason(row(1, 0, "30'", { id: 'l365-99' }), { id: 'Rezultati Final', name: 'Rezultati Final' }, { id: '1', name: '1' }, now)).not.toBe('GOAL_PAUSE');
  });
});
