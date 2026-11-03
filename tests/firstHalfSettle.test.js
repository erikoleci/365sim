import { describe, it, expect } from 'vitest';
import { isPureFirstHalfMarket, determineLegOutcome } from '../server/matchSettlement.js';

const ht = (h, a) => ({ winner: h > a ? 'HOME' : a > h ? 'AWAY' : 'DRAW', totalGoals: h + a, bothScored: h > 0 && a > 0, homeScore: h, awayScore: a, htHome: h, htAway: a });
const leg = (market_name, selection_id) => ({ market_id: '', market_name, selection_id, selection_name: selection_id, match_home: 'A', match_away: 'B' });

describe('first-half markets settle at the whistle', () => {
  it('only markets that depend on the first half alone are picked', () => {
    for (const n of ['Rezultati Pjesa e Parë', 'Numri i Golave Pjesa e Parë', 'Gol / Jo Gol Ne P1', 'Total Gola P1']) expect(isPureFirstHalfMarket(n)).toBe(true);
    for (const n of ['Rezultat Final', '45/90', 'Rezultati pjesa e pare / rezultati final', 'Rezultati Pjesa e Parë & Totali', 'Rezultati Pjesa e Dytë', 'Rezultati P1/P2']) expect(isPureFirstHalfMarket(n)).toBe(false);
  });
  it('"first half = 1" is lost at 0-0 and won at 1-0, decided with the half-time score alone', () => {
    expect(determineLegOutcome(leg('Rezultati Pjesa e Parë', '1'), ht(0, 0))).toBe('LOST');
    expect(determineLegOutcome(leg('Rezultati Pjesa e Parë', '1'), ht(1, 0))).toBe('WON');
    expect(determineLegOutcome(leg('Rezultati Pjesa e Parë', 'X'), ht(0, 0))).toBe('WON');
  });
});
