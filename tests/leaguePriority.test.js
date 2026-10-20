import { describe, it, expect } from 'vitest';
import { leaguePriority } from '../utils/leaguePriority.ts';
import { compareCountries } from '../utils/matchGrouping.ts';

describe('league display order', () => {
  it('ranks the big five, the cups, then the rest', () => {
    const order = [
      leaguePriority('Premier League', 'Anglia'),
      leaguePriority('Serie A', 'Italia'),
      leaguePriority('La Liga', 'Spanja'),
      leaguePriority('Ligue 1', 'Franca'),
      leaguePriority('Bundesliga', 'Gjermania'),
      leaguePriority('UEFA Champions League', 'Ndërkombëtare'),
      leaguePriority('UEFA Europa League', 'Ndërkombëtare'),
      leaguePriority('UEFA Conference League', 'Ndërkombëtare'),
      leaguePriority('Friendlies', 'Ndërkombëtare'),
      leaguePriority('Super Lig', 'Turqi'),
      leaguePriority('Championship', 'Anglia'),
    ];
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
  it('does not mistake other Premier Leagues or the 2. Bundesliga for the big five', () => {
    expect(leaguePriority('Premier League', 'Egjipt')).toBe(9);
    expect(leaguePriority('2. Bundesliga', 'Gjermania')).toBe(10);
  });
  it('orders countries England, Italy, Spain, France, Germany, international, others', () => {
    const list = ['Të tjera', 'Turqi', 'Ndërkombëtare', 'Gjermania', 'Franca', 'Spanja', 'Italia', 'Anglia'];
    expect(list.sort(compareCountries)).toEqual(['Anglia', 'Italia', 'Spanja', 'Franca', 'Gjermania', 'Ndërkombëtare', 'Turqi', 'Të tjera']);
  });
});
