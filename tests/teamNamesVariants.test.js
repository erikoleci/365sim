import { describe, it, expect } from 'vitest';
import { sameTeam, sameFixture } from '../server/fixtureDedupe.js';

describe('team names written differently by the two feeds', () => {
  it('Praha and Prague are the same club', () => {
    expect(sameTeam('SK Slavia Prague C', 'Slavia Praha C')).toBe(true);
    expect(sameFixture({ homeTeam: 'SK Slavia Prague C', awayTeam: 'SK Dynamo Ceske Budejovice' }, { homeTeam: 'Slavia Praha C', awayTeam: 'Dynamo České Budějovice' })).toBe(true);
  });
  it('a C team is not the first team, nor the B team', () => {
    expect(sameTeam('SK Slavia Prague C', 'SK Slavia Prague')).toBe(false);
    expect(sameTeam('SK Slavia Prague C', 'SK Slavia Prague B')).toBe(false);
  });
  it('letters NFD does not decompose still match their plain form', () => {
    expect(sameTeam('Lyngby Bøldklub', 'Lyngby Boldklub')).toBe(true);
  });
});

describe('spelling and word order', () => {
  it('matches the same club written differently', () => {
    for (const [a, b] of [['HB Koege', 'HB Køge'], ['AGF Aarhus', 'Aarhus GF'], ['1. FC Koeln', 'FC Köln'], ['Aarhus GF', 'GF Aarhus'], ['Bayern Munich', 'Bayern Munchen']]) expect(sameTeam(a, b), a + ' / ' + b).toBe(true);
  });
  it('never merges two different clubs', () => {
    for (const [a, b] of [['Sheffield Utd', 'Sheffield Wed'], ['Real Madrid', 'Real Betis'], ['Manchester City', 'Manchester United'], ['Inter', 'Inter Miami'], ['AC Milan', 'Inter Milan'], ['Bristol City', 'Bristol Rovers'], ['FK Pribram B', 'FK Pribram'], ['Borussia Dortmund', 'Borussia Monchengladbach'], ['Aarhus GF', 'Aalborg BK']]) expect(sameTeam(a, b), a + ' / ' + b).toBe(false);
  });
});
