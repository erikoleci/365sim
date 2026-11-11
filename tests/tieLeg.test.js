import { describe, it, expect } from 'vitest';
import { tieInfo, hasToQualify } from '../server/tieLeg.js';

const coupon = JSON.stringify({ markets: [{ name: 'To qualify' }] });
const m = { id: 'b', home_team: 'Benfica', away_team: 'Ajax', start_time: '2026-10-28T19:00:00Z', raw_json: coupon };
const first = { id: 'a', home_team: 'Ajax', away_team: 'Benfica', start_time: '2026-10-21T19:00:00Z', result_home: 2, result_away: 1, status: 'FINISHED' };

describe('first / second leg from the coupon', () => {
  it('second leg: first leg score + aggregate with the score now (Benfica 2-0 now, Ajax 2-1 before => 3-2)', () => {
    expect(tieInfo(m, [first], { home: 2, away: 0 })).toMatchObject({ leg: 2, firstLeg: '2-1', aggregate: '3-2' });
  });
  it('a league pair without the To qualify market is NEVER called a leg', () => {
    expect(tieInfo({ ...m, raw_json: JSON.stringify({ markets: [{ name: '1X2' }] }) }, [first], { home: 0, away: 0 })).toBeNull();
    expect(hasToQualify('Skuadra qe kualifikohet')).toBe(true);
  });
  it('first leg: the same pair is scheduled later', () => {
    const second = { id: 'c', home_team: 'Ajax', away_team: 'Benfica', start_time: '2026-11-04T19:00:00Z', result_home: null, result_away: null, status: 'UPCOMING' };
    expect(tieInfo({ ...m, id: 'x', home_team: 'Benfica', away_team: 'Ajax', start_time: '2026-10-28T19:00:00Z' }, [{ ...second, home_team: 'Ajax', away_team: 'Benfica' }], null)).toMatchObject({ leg: 1 });
  });
  it('nothing is invented when no other leg is known, or it is months away, or same order', () => {
    expect(tieInfo(m, [], null)).toBeNull();
    expect(tieInfo(m, [{ ...first, start_time: '2026-05-01T19:00:00Z' }], null)).toBeNull();
    expect(tieInfo(m, [{ ...first, home_team: 'Benfica', away_team: 'Ajax' }], null)).toBeNull();
  });
  it('unfinished earlier match is not a first leg score', () => {
    expect(tieInfo(m, [{ ...first, result_home: null, result_away: null }], null)).toBeNull();
  });
});
