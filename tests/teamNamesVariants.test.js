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
