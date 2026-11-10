import { describe, it, expect } from 'vitest';
import { favoriteLeaguesFirst, isFavoriteMatch } from '../utils/favoritesFirst';

const m = (id, home, away, league) => ({ id, homeTeam: home, awayTeam: away, league });
const groups = [
  ['Anglia', [['pl', [m('1', 'A', 'B', 'pl')]], ['ch', [m('2', 'C', 'D', 'ch')]]]],
  ['Italia', [['sa', [m('3', 'E', 'F', 'sa')]], ['sb', [m('4', 'G', 'H', 'sb')]]]],
];

describe('favourites first', () => {
  it('leaves the order alone without favourite leagues', () => {
    expect(favoriteLeaguesFirst(groups, new Set())).toBe(groups);
  });
  it('lifts a favourite league inside its country and its country to the top', () => {
    const out = favoriteLeaguesFirst(groups, new Set(['sb']));
    expect(out.map((g) => g[0])).toEqual(['Italia', 'Anglia']);
    expect(out[0][1].map((l) => l[0])).toEqual(['sb', 'sa']);
    expect(out[1][1].map((l) => l[0])).toEqual(['pl', 'ch']);
  });
  it('a match is a favourite by its id or by either team', () => {
    const f = { teams: new Set(['B']), leagues: new Set(), matches: new Set(['9']) };
    expect(isFavoriteMatch(m('1', 'A', 'B', 'x'), f)).toBe(true);
    expect(isFavoriteMatch(m('9', 'X', 'Y', 'x'), f)).toBe(true);
    expect(isFavoriteMatch(m('5', 'X', 'Y', 'x'), f)).toBe(false);
  });
});
