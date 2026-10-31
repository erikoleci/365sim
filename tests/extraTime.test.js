import { describe, it, expect } from 'vitest';
import { regularTimeScoreFrom } from '../server/matchSettlement.js';
import { getMarketClosedReason } from '../server/marketPeriods.js';
import { getBetBlockReason, describeBlockReason } from '../server/marketRules.js';
import { halfSql } from '../server/eventHalf.js';

describe('extra time: settle on the regular-time score', () => {
  it('uses the score captured at the start of extra time', () => {
    expect(regularTimeScoreFrom({ rt_home: 1, rt_away: 1 }, { home: 0, away: 0 }, 2, 1)).toEqual({ home: 1, away: 1 });
  });
  it('without a capture, takes the extra-time goals off the final score', () => {
    expect(regularTimeScoreFrom({}, { home: 1, away: 0 }, 2, 1)).toEqual({ home: 1, away: 1 });
    expect(regularTimeScoreFrom({ rt_home: null, rt_away: null }, { home: 2, away: 1 }, 3, 1)).toEqual({ home: 1, away: 0 });
    expect(regularTimeScoreFrom({}, undefined, 2, 1)).toEqual({ home: 2, away: 1 }); // nothing known: unchanged
  });
  it('never goes above the live score (VAR) or below zero', () => {
    expect(regularTimeScoreFrom({ rt_home: 3, rt_away: 1 }, {}, 2, 1)).toEqual({ home: 2, away: 1 });
    expect(regularTimeScoreFrom({}, { home: 5, away: 5 }, 1, 1)).toEqual({ home: 0, away: 0 });
  });
});

describe('extra time: markets are closed', () => {
  const row = (st) => ({ home_team: 'A', away_team: 'B', status: 'LIVE', live_status: st, start_time: new Date(Date.now() - 100 * 60000).toISOString(), live_minute: '96:10', live_home_score: 1, live_away_score: 1 });
  it('closes everything in extra time and penalties, not in the second half', () => {
    for (const st of ['ET', 'EXTRA_TIME', 'PEN', 'PENALTIES', 'AET']) expect(getMarketClosedReason(row(st), 'Rezultat Final')).toBe('REGULAR_TIME_OVER');
    expect(getMarketClosedReason(row('2H'), 'Rezultat Final')).toBeNull();
    expect(getBetBlockReason(row('ET'), { id: 'x', name: 'Rezultat Final' }, { id: '1', name: '1' })).toBe('REGULAR_TIME_OVER');
    expect(describeBlockReason('REGULAR_TIME_OVER')).toMatch(/regular time is over/);
  });
  it('events logged in extra time get half 3', () => {
    expect(halfSql('$1')).toMatch(/IN \('ET', 'EXTRA_TIME'\) THEN 3/);
  });
  it('the first half is never ended by the game clock (stoppage time is unbounded: +15, +20)', () => {
    const sql = halfSql('$1');
    expect(sql).not.toMatch(/live_minute/);
    expect(sql).toMatch(/ht_home IS NOT NULL THEN 2/);
  });
});
