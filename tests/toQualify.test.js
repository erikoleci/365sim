import { describe, it, expect } from 'vitest';
import { determineLegOutcome, pickOtherLeg, aggregateFrom } from '../server/matchSettlement.js';

// Second leg: Benfica (home) v Ajax (away). First leg in Amsterdam: Ajax 2-1 Benfica.
const leg = (sel) => ({ market_id: '', market_name: 'To qualify', selection_id: sel, selection_name: sel, match_home: 'Benfica', match_away: 'Ajax' });
const out = (sel, aggregate) => determineLegOutcome(leg(sel), { winner: 'HOME', totalGoals: 2, bothScored: false, homeScore: 2, awayScore: 0, htHome: 1, htAway: 0, aggregate });

describe('To qualify: the sum of the two legs', () => {
  it('the other leg is the same teams the other way round, nearest in time', () => {
    const first = { start_time: '2026-10-21T19:00:00Z', result_home: 2, result_away: 1 }; // Ajax 2-1 Benfica
    const far = { start_time: '2026-05-01T19:00:00Z', result_home: 0, result_away: 0 };
    const unfinished = { start_time: '2026-10-22T19:00:00Z', result_home: null, result_away: null };
    expect(pickOtherLeg('2026-10-28T19:00:00Z', [far, unfinished, first])).toBe(first);
    expect(pickOtherLeg('2026-10-28T19:00:00Z', [far])).toBeNull();      // months apart: not the same tie
    expect(pickOtherLeg('2026-10-28T19:00:00Z', [])).toBeNull();
  });
  it('adds the goals each side scored in the other leg', () => {
    // Benfica 2-0 Ajax now; Ajax 2-1 Benfica before: Benfica 2 + 1 = 3, Ajax 0 + 2 = 2
    expect(aggregateFrom(2, 0, { result_home: 2, result_away: 1 })).toEqual({ home: 3, away: 2 });
    expect(aggregateFrom(2, 0, null)).toBeUndefined();
  });
  it('is decided by the aggregate', () => {
    const agg = { home: 3, away: 2 };
    expect(out('1', agg)).toBe('WON');
    expect(out('2', agg)).toBe('LOST');
    expect(out('Benfica', agg)).toBe('WON');
    expect(out('Ajax', agg)).toBe('LOST');
    expect(out('1', { home: 2, away: 3 })).toBe('LOST');
    expect(out('2', { home: 2, away: 3 })).toBe('WON');
  });
  it('stays open when the aggregate is level (extra time / penalties) or the other leg is unknown', () => {
    expect(out('1', { home: 2, away: 2 })).toBeNull();
    expect(out('1', undefined)).toBeNull();
    expect(out('diçka', { home: 3, away: 2 })).toBeNull();
  });
});
