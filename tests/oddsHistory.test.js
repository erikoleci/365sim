import { describe, it, expect } from 'vitest';
import { diffOddsChanges } from '../server/oddsUtils.js';

function ev(price) {
  return {
    id: 'm1',
    home_team: 'A', away_team: 'B',
    bookmakers: [{
      title: 'Bk1',
      markets: [{ key: 'h2h', outcomes: [
        { name: 'A', price },
        { name: 'Draw', price: 3.2 },
        { name: 'B', price: 2.8 },
      ] }],
    }],
  };
}

describe('diffOddsChanges (odds history engine)', () => {
  it('records no changes when odds are identical', () => {
    expect(diffOddsChanges('m1', ev(1.9), ev(1.9))).toEqual([]);
  });

  it('detects a moved outcome', () => {
    const changes = diffOddsChanges('m1', ev(1.9), ev(2.1));
    const home = changes.find((c) => c.newOdds === 2.1);
    expect(home).toBeTruthy();
    expect(home.oldOdds).toBe(1.9);
  });

  it('treats a brand new match (no previous odds) as no history to compare, but still reports current prices as changes from null', () => {
    const changes = diffOddsChanges('m1', null, ev(1.9));
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c.oldOdds === null)).toBe(true);
  });

  it('ignores tiny floating point noise below 0.001', () => {
    expect(diffOddsChanges('m1', ev(1.900001), ev(1.900002))).toEqual([]);
  });
});
