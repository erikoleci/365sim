import { describe, it, expect } from 'vitest';
import { getBetBlockReason, goalCountOption } from '../server/marketRules.js';

const row = (over = {}) => ({
  id: 'm1', home_team: 'Venezia FC', away_team: 'Inter Milano', start_time: new Date(Date.now() - 30 * 60000).toISOString(),
  status: 'LIVE', live_status: '1H', live_minute: '30:00', live_home_score: 1, live_away_score: 0, ht_home: null, ht_away: null,
  live_minute_updated_at: Date.now(), ...over,
});
const reason = (market, option, r = row()) => getBetBlockReason(r, { id: 'x_' + market, name: market }, { id: option, name: option });

describe('goalCountOption', () => {
  it('reads exactly N, a-b and N+', () => {
    expect(goalCountOption('2')).toEqual({ lo: 2, hi: 2 });
    expect(goalCountOption('1-2')).toEqual({ lo: 1, hi: 2 });
    expect(goalCountOption('3+')).toEqual({ lo: 3, hi: Infinity });
    expect(goalCountOption('Mbi 2.5')).toBeNull();
  });
});

describe('"Numri i Golave" in play (live score 1-0)', () => {
  it('stays open while the option can still win or lose, closes once decided', () => {
    expect(reason('Numri i Golave', '0')).toBe('OUTCOME_DECIDED');   // already lost
    expect(reason('Numri i Golave', '1')).toBeNull();                // still open (win if no more goals)
    expect(reason('Numri i Golave', '1-2')).toBeNull();
    expect(reason('Numri i Golave', '2')).toBeNull();
    expect(reason('Numri i Golave', '2+')).toBeNull();               // not reached yet
    expect(reason('Numri i Golave', '1+')).toBe('OUTCOME_DECIDED');  // already won
    expect(reason('Numri i Golave', '0-0')).toBe('OUTCOME_DECIDED');
  });
  it('uses the goals of the half for the half markets, and closes them after the break', () => {
    expect(reason('Numri i Golave Pjesa I', '0')).toBe('OUTCOME_DECIDED');
    expect(reason('Numri i Golave Pjesa I', '2')).toBeNull();
    expect(reason('Numri i Golave Pjesa I', '1+')).toBe('OUTCOME_DECIDED');
    const second = row({ live_status: '2H', live_minute: '60:00', live_home_score: 2, live_away_score: 1, ht_home: 1, ht_away: 0 });
    expect(reason('Numri i Golave Pjesa I', '1', second)).toBe('FIRST_HALF_OVER');
    expect(reason('Numri i Golave Pjesa II', '2', second)).toBeNull();                  // 2 goals in this half so far: still open
    expect(reason('Numri i Golave Pjesa II', '1', second)).toBe('OUTCOME_DECIDED');     // 2 > 1: lost
    expect(reason('Numri i Golave Pjesa II', '2', row({ ...second, live_home_score: 3 }))).toBe('OUTCOME_DECIDED'); // 3 > 2
  });
  it('is not verifiable without a half-time snapshot in the second half', () => {
    const noHt = row({ live_status: '2H', live_minute: '60:00', ht_home: null, ht_away: null });
    expect(reason('Numri i Golave Pjesa II', '1', noHt)).toBe('NOT_VERIFIABLE_LIVE');
  });
});
