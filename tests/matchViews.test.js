import { describe, it, expect } from 'vitest';
import { patchMarketsOdds } from '../utils/matchPatches';
import { compareCountries, groupByCountryAndLeague, sliceByRowBudget, toLeagueSections } from '../utils/matchGrouping';
import { makeLeagueComparator } from '../utils/leagueLabels';

const m = (id, league) => ({ id, league, status: 'UPCOMING', startTime: '2026-10-16T10:00:00Z' });
const country = (league) => (league.startsWith('en') ? 'Anglia' : league.startsWith('es') ? 'Spanja' : 'Të tjera');

describe('patchMarketsOdds', () => {
  const markets = [{ id: 'm-h2h', name: '1X2', options: [{ id: 'HOME', odds: 2 }, { id: 'AWAY', odds: 3 }] }];
  it('changes only the price that moved', () => {
    const next = patchMarketsOdds(markets, [{ marketId: 'm-h2h', selectionId: 'HOME', newOdds: 2.2 }]);
    expect(next[0].options[0].odds).toBe(2.2);
    expect(next[0].options[1].odds).toBe(3);
  });
  it('returns the same array when nothing was touched (no re-render)', () => {
    expect(patchMarketsOdds(markets, [{ marketId: 'other', selectionId: 'HOME', newOdds: 9 }])).toBe(markets);
    expect(patchMarketsOdds(markets, [{ marketId: 'm-h2h', selectionId: 'HOME' }])).toBe(markets);
  });
});

describe('country / league grouping', () => {
  it('puts big leagues first and "Të tjera" last', () => {
    expect(['Të tjera', 'Spanja', 'Anglia', 'Zvicër'].sort(compareCountries)).toEqual(['Anglia', 'Spanja', 'Zvicër', 'Të tjera']);
  });
  it('groups by country then league and can keep a single country', () => {
    const cmp = makeLeagueComparator((k) => k);
    const groups = groupByCountryAndLeague([m(1, 'en1'), m(2, 'es1'), m(3, 'en1'), m(4, 'xx')], country, cmp);
    expect(groups.map(([c]) => c)).toEqual(['Anglia', 'Spanja', 'Të tjera']);
    expect(groups[0][1][0][1].map((x) => x.id)).toEqual([1, 3]);
    expect(groupByCountryAndLeague([m(1, 'en1'), m(2, 'es1')], country, cmp, 'Spanja').map(([c]) => c)).toEqual(['Spanja']);
  });
  it('slices by row budget and reports the rest', () => {
    const cmp = makeLeagueComparator((k) => k);
    const groups = groupByCountryAndLeague([m(1, 'en1'), m(2, 'en1'), m(3, 'es1'), m(4, 'es1')], country, cmp);
    const { visibleGroups, hiddenRows } = sliceByRowBudget(groups, 2);
    expect(visibleGroups).toHaveLength(1);
    expect(hiddenRows).toBe(2);
  });
  it('flattens to league sections ordered by priority', () => {
    const cmp = makeLeagueComparator((k) => k);
    const groups = groupByCountryAndLeague([m(1, 'en1'), m(2, 'cup')], country, cmp);
    expect(toLeagueSections(groups, (l) => (l === 'cup' ? 0 : 1))[0].league).toBe('cup');
  });
});
