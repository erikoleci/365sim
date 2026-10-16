import { describe, it, expect } from 'vitest';
import { navToPath, pathToNav, HOME_NAV } from '../utils/routes.ts';

const nav = (o) => ({ ...HOME_NAV, ...o });

describe('routes - every screen has an address', () => {
  it('maps screens to the agreed paths', () => {
    expect(navToPath(HOME_NAV)).toBe('/koeficientet');
    expect(navToPath(nav({ showLiveOnly: true }))).toBe('/ndeshjelive');
    expect(navToPath(nav({ showResults: true }))).toBe('/rezultate');
    expect(navToPath(nav({ currentLeague: 'FAVORITES' }))).toBe('/te-preferuarat');
    expect(navToPath(nav({ isMobileSlipOpen: true }))).toBe('/kuponi');
    expect(navToPath(nav({ detailMatchId: 'l365-12' }))).toBe('/ndeshje/l365-12');
  });
  it('round-trips country and league filters, including special characters', () => {
    for (const league of ['COUNTRY:Shqipëri', 'l365_brazil__serie_b', 'soccer_epl']) {
      const n = nav({ currentLeague: league });
      expect(pathToNav(navToPath(n))).toEqual(n);
    }
  });
  it('round-trips live, results, slip and match screens', () => {
    for (const n of [nav({ showLiveOnly: true }), nav({ showResults: true }), nav({ isMobileSlipOpen: true }), nav({ detailMatchId: 'a b/c' })]) {
      expect(pathToNav(navToPath(n))).toEqual(n);
    }
  });
  it('opens the odds list for / and for unknown or broken addresses', () => {
    expect(pathToNav('/')).toEqual(HOME_NAV);
    expect(pathToNav('')).toEqual(HOME_NAV);
    expect(pathToNav('/asgje/tjeter')).toEqual(HOME_NAV);
    expect(pathToNav('/ndeshje/')).toEqual(HOME_NAV);
    expect(pathToNav('/liga/%E0%A4%A')).toEqual(nav({ currentLeague: '%E0%A4%A' }));
  });
  it('ignores a trailing slash', () => {
    expect(pathToNav('/ndeshjelive/')).toEqual(nav({ showLiveOnly: true }));
  });
  it('the most specific screen wins when several flags are set', () => {
    expect(navToPath(nav({ detailMatchId: '1', isMobileSlipOpen: true, showLiveOnly: true }))).toBe('/ndeshje/1');
  });
});
