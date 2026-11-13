import { describe, it, expect } from 'vitest';
import { isPastFirstHalf, getMarketClosedReason, FIRST_HALF_MAX_WALL_MIN } from '../server/marketPeriods.js';
import { halfSql } from '../server/eventHalf.js';
const now = Date.parse('2026-11-12T21:00:00Z');
const row = (minAgo, minute, extra = {}) => ({ status: 'LIVE', start_time: new Date(now - minAgo * 60000).toISOString(), live_status: '1H', live_minute: minute, ht_home: null, ...extra });
describe('first half when the provider never signalled half time: the break shows as a gap between real time and the game clock', () => {
  it('Albania-Finland case: game minute 51 of the 2nd half, 66 real minutes after kick-off -> past the first half, first-half markets closed', () => {
    expect(isPastFirstHalf(row(66, '51:10'), now)).toBe(true);
    expect(getMarketClosedReason(row(66, '51:10'), 'Rezultati Pjesa e Parë', now)).toBe('FIRST_HALF_OVER');
    expect(getMarketClosedReason(row(66, '51:10'), 'Rezultat Final', now)).toBeNull();
  });
  it('first-half stoppage time (even +18) never looks like the break: real time and game clock differ only by the kick-off delay', () => {
    expect(isPastFirstHalf(row(52, '46:10'), now)).toBe(false);
    expect(isPastFirstHalf(row(58, '52:30'), now)).toBe(false);
    expect(isPastFirstHalf(row(68, '63:00'), now)).toBe(false);
    expect(isPastFirstHalf(row(57, '46:30'), now)).toBe(false); // 11 min late kick-off, minute 46 -> gap 11
  });
  it('a delayed kick-off early in the first half is never mistaken for the break', () => {
    expect(isPastFirstHalf(row(30, '15:00'), now)).toBe(false);
    expect(isPastFirstHalf(row(35, '20:00'), now)).toBe(false);
  });
  it('a real half-time signal still wins, and the 80 minute wall cap stays', () => {
    expect(FIRST_HALF_MAX_WALL_MIN).toBe(80);
    expect(isPastFirstHalf(row(50, '46:00', { live_status: 'HT' }), now)).toBe(true);
    expect(isPastFirstHalf(row(50, '46:00', { ht_home: 1 }), now)).toBe(true);
    expect(isPastFirstHalf(row(85, '38:00'), now)).toBe(true);
  });
  it('the event half (SQL) uses the same break rule: a 2nd-half goal is not filed as 45+6', () => {
    const q = halfSql('$1');
    expect(q).toContain('>= 12 THEN 2');
    expect(q).toContain('BETWEEN 46 AND 130');
  });
});
