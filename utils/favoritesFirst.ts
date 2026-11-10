import { Match } from '../types';
import { CountryGroup } from './matchGrouping';

export interface FavoriteSets { teams: Set<string>; leagues: Set<string>; matches: Set<string> }

/** The user starred this match itself, or one of its teams. */
export const isFavoriteMatch = (m: Match, f: FavoriteSets): boolean =>
  f.matches.has(m.id) || f.teams.has(m.homeTeam) || f.teams.has(m.awayTeam);

/** Favourite leagues rise to the top of their country, and countries holding one rise to the top; order is otherwise unchanged. */
export const favoriteLeaguesFirst = (groups: CountryGroup[], favoriteLeagues: Set<string>): CountryGroup[] => {
  if (favoriteLeagues.size === 0) return groups;
  const withFavs = groups.map(([country, leagues]) => [country, [...leagues].sort((a, b) => Number(favoriteLeagues.has(b[0])) - Number(favoriteLeagues.has(a[0])))] as CountryGroup);
  const hasFav = (g: CountryGroup) => g[1].some(([l]) => favoriteLeagues.has(l));
  return [...withFavs].sort((a, b) => Number(hasFav(b)) - Number(hasFav(a)));
};
