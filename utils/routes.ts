import { Nav } from './navHistory';
import { ALL_LEAGUES, FAVORITES, countryFilterKey, countryFromFilter, isCountryFilter } from './leagueFilters';

// URL <-> screen. Every screen of the sportsbook has an address people can open directly, share or
// bookmark:
//   /koeficientet            odds list ("all matches")
//   /ndeshjelive             live matches
//   /rezultate               results of the last 48 hours
//   /te-preferuarat          favourites
//   /shteti/<country>        one country
//   /liga/<league key>       one league
//   /ndeshje/<match id>      one match with all its markets
//   /kuponi                  the bet slip (small screens)
// "/" and unknown addresses open the odds list.
export const PATHS = {
  odds: '/koeficientet',
  live: '/ndeshjelive',
  results: '/rezultate',
  favorites: '/te-preferuarat',
  slip: '/kuponi',
  country: '/shteti/',
  league: '/liga/',
  match: '/ndeshje/',
} as const;

export const HOME_NAV: Nav = {
  detailMatchId: null,
  isMobileSlipOpen: false,
  showLiveOnly: false,
  showResults: false,
  currentLeague: ALL_LEAGUES,
};

/** The address of a screen. When several flags are set the most specific one wins. */
export function navToPath(nav: Nav): string {
  if (nav.detailMatchId) return PATHS.match + encodeURIComponent(nav.detailMatchId);
  if (nav.isMobileSlipOpen) return PATHS.slip;
  if (nav.showLiveOnly) return PATHS.live;
  if (nav.showResults) return PATHS.results;
  if (nav.currentLeague === FAVORITES) return PATHS.favorites;
  if (isCountryFilter(nav.currentLeague)) return PATHS.country + encodeURIComponent(countryFromFilter(nav.currentLeague));
  if (nav.currentLeague !== ALL_LEAGUES) return PATHS.league + encodeURIComponent(nav.currentLeague);
  return PATHS.odds;
}

const decode = (s: string): string => {
  try { return decodeURIComponent(s); } catch { return s; }
};

/** The screen an address opens. Unknown addresses open the odds list. */
export function pathToNav(pathname: string): Nav {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';
  if (path === PATHS.live) return { ...HOME_NAV, showLiveOnly: true };
  if (path === PATHS.results) return { ...HOME_NAV, showResults: true };
  if (path === PATHS.favorites) return { ...HOME_NAV, currentLeague: FAVORITES };
  if (path === PATHS.slip) return { ...HOME_NAV, isMobileSlipOpen: true };
  if (path.startsWith(PATHS.match)) {
    const id = decode(path.slice(PATHS.match.length));
    if (id) return { ...HOME_NAV, detailMatchId: id };
  }
  if (path.startsWith(PATHS.country)) {
    const country = decode(path.slice(PATHS.country.length));
    if (country) return { ...HOME_NAV, currentLeague: countryFilterKey(country) };
  }
  if (path.startsWith(PATHS.league)) {
    const league = decode(path.slice(PATHS.league.length));
    if (league) return { ...HOME_NAV, currentLeague: league };
  }
  return HOME_NAV;
}
