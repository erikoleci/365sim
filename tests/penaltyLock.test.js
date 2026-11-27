import { describe, it, expect, beforeEach } from 'vitest';
import { setPenaltyLock, clearPenaltyLock, isPenaltyLocked, __resetPenaltyLockForTests } from '../server/penaltyLock.js';
import { getBetBlockReason, describeBlockReason } from '../server/marketRules.js';

const row = { id: 'l365-555', home_team: 'A', away_team: 'B', start_time: '2020-01-01T00:00:00Z', status: 'LIVE', live_status: '2H', live_home_score: 0, live_away_score: 1 };
const market = { id: 'ft', name: 'Fulltime Result' };
const sel = { id: '1', name: '1' };
const T0 = Date.parse('2026-11-03T20:00:00Z');

describe('penalty betting pause', () => {
  beforeEach(() => __resetPenaltyLockForTests());
  it('locks and releases a match (with or without the l365- prefix)', () => {
    setPenaltyLock('l365-555', T0);
    expect(isPenaltyLocked('555', T0 + 1000)).toBe(true);
    clearPenaltyLock('555');
    expect(isPenaltyLocked('l365-555', T0 + 1000)).toBe(false);
  });
  it('never stays locked for good: the safety cap releases it', () => {
    setPenaltyLock('555', T0);
    expect(isPenaltyLocked('555', T0 + 299000)).toBe(true);
    expect(isPenaltyLocked('555', T0 + 301000)).toBe(false);
  });
  it('closes every market of that match only, with its own reason', () => {
    setPenaltyLock('l365-555', T0);
    expect(getBetBlockReason(row, market, sel, T0 + 1000)).toBe('PENALTY_PAUSE');
    expect(getBetBlockReason(row, { id: 'dc', name: 'Double Chance' }, { id: '1X', name: '1X' }, T0 + 1000)).toBe('PENALTY_PAUSE');
    expect(getBetBlockReason({ ...row, id: 'l365-999' }, market, sel, T0 + 1000)).not.toBe('PENALTY_PAUSE');
    expect(describeBlockReason('PENALTY_PAUSE')).toMatch(/penalty/);
  });
  it('opens again once released', () => {
    setPenaltyLock('555', T0);
    clearPenaltyLock('555');
    expect(getBetBlockReason(row, market, sel, T0 + 1000)).not.toBe('PENALTY_PAUSE');
  });
});

import { releasesPenaltyLock } from '../server/penaltyLock.js';
describe('which codes lift the penalty pause', () => {
  it('goal, throw-in, corner, dangerous attack, goal kick and the whistles lift it', () => {
    for (const k of ['goal', 'throw_in', 'corner', 'dangerous_attack', 'back_line_restart', 'half_time', 'full_time']) expect(releasesPenaltyLock(k)).toBe(true);
  });
  it('possession, plain attack, free kick, offside, substitution, unknown do NOT', () => {
    for (const k of ['possession', 'attack', 'free_kick', 'offside', 'substitution', 'injury', 'shot_on_target', 'penalty', undefined]) expect(releasesPenaltyLock(k)).toBe(false);
  });
});
