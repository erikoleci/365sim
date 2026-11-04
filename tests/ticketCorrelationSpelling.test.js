import { describe, it, expect } from 'vitest';
import { findCorrelatedSelections } from '../server/ticketCorrelation.js';

const sel = (id, home, away, marketName, optionName, t = '2026-11-03T20:00:00Z') => ({ matchId: id, home, away, startTime: t, marketId: 'm' + id + marketName, marketName, optionName });

describe('one result per match, even when the two provider records spell the teams differently', () => {
  const same = [
    [['Feyenoord', 'Inter Milan'], ['Feyenoord Rotterdam', 'Inter Milano']],
    [['Villarreal', 'PSG'], ['Villarreal CF', 'Paris Saint-Germain']],
    [['Barcelona', 'Aston Villa'], ['FC Barcelona', 'Aston Villa']],
    [['Man Utd', 'Roma'], ['Manchester United', 'AS Roma']],
    [['LASK Linz', 'Slovan Bratislava'], ['LASK Linz', 'SK Slovan Bratislava']],
  ];
  for (const [a, b] of same) {
    it(`${a.join(' v ')}  =  ${b.join(' v ')}: a result and a goals selection are refused together`, () => {
      const r = findCorrelatedSelections([sel('A', a[0], a[1], 'Rezultat Final', '1'), sel('B', b[0], b[1], 'Numri i Golave', 'Lart 2.5')]);
      expect(r && r.family).toBe('score');
    });
  }
  it('corners and cards of the same match stay allowed next to one result', () => {
    expect(findCorrelatedSelections([
      sel('A', 'Feyenoord', 'Inter Milan', 'Rezultat Final', '1'),
      sel('B', 'Feyenoord Rotterdam', 'Inter Milano', 'Shuma total e korneve', '10+'),
      sel('C', 'Feyenoord', 'Inter Milan', 'Total bookings', 'Over 5.5'),
    ])).toBeNull();
  });
  it('different matches are never merged', () => {
    const t = '2026-11-03T20:00:00Z';
    expect(findCorrelatedSelections([sel('A', 'Villarreal', 'PSG', 'Rezultat Final', '1'), sel('B', 'Barcelona', 'Aston Villa', 'Rezultat Final', '1')])).toBeNull();
    expect(findCorrelatedSelections([sel('A', 'Real Madrid', 'Roma', 'Rezultat Final', '1', t), sel('B', 'Real Madrid', 'Sevilla', 'Rezultat Final', '1', '2026-11-06T20:00:00Z')])).toBeNull();
    expect(findCorrelatedSelections([sel('A', 'Chelsea', 'Arsenal', 'Rezultat Final', '1'), sel('B', 'Chelsea W', 'Arsenal W', 'Rezultat Final', '1')])).toBeNull();
  });
});
