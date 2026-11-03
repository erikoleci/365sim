import { describe, it, expect } from 'vitest';
import { extraMarketOutcome } from '../server/extraMarkets.js';
import { determineLegOutcome } from '../server/matchSettlement.js';

const leg = (sel) => ({ selection_name: sel, selection_id: sel });
const final = (h, a) => ({ homeScore: h, awayScore: a });

describe('"Rezultati Final Gola N+" with the feed\'s real options ("2|3+", "1|4+")', () => {
  const m = 'rezultati final gola 3+';
  it('wins when the result matches and there are enough goals', () => {
    expect(extraMarketOutcome(leg('2|3+'), m, final(1, 3))).toBe('WON');
    expect(extraMarketOutcome(leg('1|3+'), m, final(3, 0))).toBe('WON');
  });
  it('loses on the wrong result or too few goals', () => {
    expect(extraMarketOutcome(leg('2|3+'), m, final(3, 1))).toBe('LOST');
    expect(extraMarketOutcome(leg('2|3+'), m, final(0, 2))).toBe('LOST');
    expect(extraMarketOutcome(leg('1|4+'), 'rezultati final gola 4+', final(2, 1))).toBe('LOST');
  });
  it('the plain 1 / X / 2 and Po / Jo options still work, and a missing score stays pending', () => {
    expect(extraMarketOutcome(leg('1'), m, final(3, 0))).toBe('WON');
    expect(extraMarketOutcome(leg('po'), m, final(2, 1))).toBe('WON');
    expect(extraMarketOutcome(leg('2|3+'), m, {})).toBeNull();
  });
});

describe('team card / corner totals use that side only', () => {
  const base = { winner: '2', totalGoals: 5, bothScored: true, homeScore: 2, awayScore: 3, htHome: 1, htAway: 1,
    stats: { cornersHome: 6, cornersAway: 5, cardsHome: 1, cardsAway: 4, yellowHome: 1, yellowAway: 4, redHome: 0, redAway: 0 } };
  const L = (name, sel) => ({ market_id: 'x', market_name: name, selection_id: sel, selection_name: sel, match_home: 'Home FC', match_away: 'Away FC' });
  it('Pritesi Total Kartona counts the home cards only (1), not 1 + 4', () => {
    expect(determineLegOutcome(L('Pritesi Total Kartona', 'Lart 1.5'), base)).toBe('LOST');
    expect(determineLegOutcome(L('Pritesi Total Kartona', 'Poshte 1.5'), base)).toBe('WON');
  });
  it('Udhetuesi Total Kartona counts the away cards only (4)', () => {
    expect(determineLegOutcome(L('Udhetuesi Total Kartona', 'Lart 3.5'), base)).toBe('WON');
  });
  it('a total over both teams is unchanged', () => {
    expect(determineLegOutcome(L('Shuma total e korneve', '10+'), base)).toBe('WON');
  });
});
