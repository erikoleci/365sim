import { describe, it, expect } from 'vitest';
import { classifyMarket, getBetBlockReason, describeMarket } from '../server/marketRules.js';
import { determineLegOutcome } from '../server/matchSettlement.js';
import { marketPeriod, getMarketClosedReason } from '../server/marketPeriods.js';

// The provider's own labels: "Total Gola P1" / "Total Gola P2" (Lart / Poshte on lines 1.5, 2.5, 3.5 ...)
const home = 'Venezia FC', away = 'Inter Milano';
// FT 1-3, HT 1-0 -> first half: 1 goal, second half: 3 goals
const ctx = { winner: 'AWAY', totalGoals: 4, bothScored: true, homeScore: 1, awayScore: 3, htHome: 1, htAway: 0, stats: {}, htStats: {} };
const settle = (market, option) => determineLegOutcome({ market_id: 'x_m1', market_name: market, selection_id: option, selection_name: option, match_home: home, match_away: away }, ctx);
const row = (over = {}) => ({ id: 'm1', home_team: home, away_team: away, start_time: new Date(Date.now() - 30 * 60000).toISOString(), status: 'LIVE', live_status: '1H', live_minute: '30:00', live_home_score: 1, live_away_score: 0, ht_home: null, ht_away: null, live_minute_updated_at: Date.now(), ...over });
const live = (market, option, r = row()) => getBetBlockReason(r, { id: 'x_' + market, name: market }, { id: option, name: option });

describe('"Total Gola P1 / P2" (provider labels)', () => {
  it('are totals of the right half, and the plain "Total Gola" is the full match', () => {
    expect(classifyMarket('x', 'Total Gola P1', {})).toEqual({ kind: 'totals', period: 'H1' });
    expect(classifyMarket('x', 'Total Gola P2', {})).toEqual({ kind: 'totals', period: 'H2' });
    expect(classifyMarket('x', 'Total Gola', {})).toEqual({ kind: 'totals', period: null });
    expect(describeMarket('x', 'Total Gola P1').kind).toBe('totals'); // no longer mistaken for a team total
    expect(marketPeriod('Total Gola P1')).toBe('H1');
    expect(marketPeriod('Total Gola P2')).toBe('H2');
  });
  it('settle from the goals of that half', () => {
    expect(settle('Total Gola P1', 'Lart 0.5')).toBe('WON');
    expect(settle('Total Gola P1', 'Lart 1.5')).toBe('LOST');
    expect(settle('Total Gola P1', 'Poshte 1.5')).toBe('WON');
    expect(settle('Total Gola P1', 'Poshte 0.5')).toBe('LOST');
    expect(settle('Total Gola P2', 'Lart 2.5')).toBe('WON');   // 3 goals in the second half
    expect(settle('Total Gola P2', 'Poshte 2.5')).toBe('LOST');
    expect(settle('Total Gola P2', 'Lart 3.5')).toBe('LOST');
    expect(settle('Total Gola', 'Lart 3.5')).toBe('WON');      // 4 goals in the match
    expect(settle('Total Gola', 'Poshte 3.5')).toBe('LOST');
  });
  it('can be bet in play: closed once decided, P1 closes at the break, P2 uses the second-half goals', () => {
    expect(live('Total Gola P1', 'Lart 0.5')).toBe('OUTCOME_DECIDED');   // 1-0: already won
    expect(live('Total Gola P1', 'Lart 1.5')).toBeNull();
    expect(live('Total Gola P1', 'Poshte 1.5')).toBeNull();
    expect(live('Total Gola P1', 'Poshte 0.5')).toBe('OUTCOME_DECIDED'); // already lost
    const second = row({ live_status: '2H', live_minute: '60:00', live_home_score: 2, live_away_score: 1, ht_home: 1, ht_away: 0 });
    expect(live('Total Gola P1', 'Lart 1.5', second)).toBe('FIRST_HALF_OVER');
    expect(getMarketClosedReason(second, 'Total Gola P1')).toBe('FIRST_HALF_OVER');
    expect(live('Total Gola P2', 'Lart 2.5', second)).toBeNull();            // 2 goals so far in this half
    expect(live('Total Gola P2', 'Lart 1.5', second)).toBe('OUTCOME_DECIDED');
    expect(live('Total Gola P2', 'Poshte 1.5', second)).toBe('OUTCOME_DECIDED');
  });
});

describe('"P1+P2" is both halves together, not the first half', () => {
  it('has no period of its own', () => {
    expect(marketPeriod('Shuma e korneve P1+P2')).toBeNull();
    expect(marketPeriod('Total Gola P1 + P2')).toBeNull();
    expect(marketPeriod('Total Gola P1/P2')).toBeNull();
    expect(classifyMarket('x', 'Shuma e korneve P1+P2', {}).period).toBeNull();
    expect(marketPeriod('Korne P2')).toBe('H2');
  });
});
