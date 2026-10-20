import { Match, MatchStatus } from '../types';
import { albaniaDateKey } from './albaniaTime';
import { COUNTRY_ORDER } from './leaguePriority';

export type LeagueGroup = [league: string, matches: Match[]];
export type CountryGroup = [country: string, leagues: LeagueGroup[]];

const PRIORITY_COUNTRIES = COUNTRY_ORDER;

/**
 * Country order: England, Italy, Spain, France, Germany, then the international (UEFA)
 * competitions, then the other known leagues, every other country alphabetically, "Të tjera" last.
 */
export const compareCountries = (a: string, b: string): number => {
  if (a === 'Të tjera') return 1;
  if (b === 'Të tjera') return -1;
  const pa = PRIORITY_COUNTRIES.indexOf(a);
  const pb = PRIORITY_COUNTRIES.indexOf(b);
  if (pa !== -1 || pb !== -1) return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
  return a.localeCompare(b);
};

/** Live matches first, then by kick-off time. */
export const liveFirstByKickoff = (a: Match, b: Match): number => {
  if (a.status !== b.status) return a.status === MatchStatus.LIVE ? -1 : 1;
  return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
};

/** country -> league -> matches, ordered for display. */
export const groupByCountryAndLeague = (
  matches: Match[],
  countryOf: (league: string) => string,
  compareLeagues: (a: string, b: string) => number,
  onlyCountry?: string | null,
): CountryGroup[] => {
  const byCountry: Record<string, Record<string, Match[]>> = {};
  for (const match of matches) {
    const country = countryOf(match.league);
    if (onlyCountry && country !== onlyCountry) continue;
    (byCountry[country] ??= {});
    (byCountry[country][match.league] ??= []).push(match);
  }
  return Object.keys(byCountry)
    .sort(compareCountries)
    .map((country) => [
      country,
      Object.keys(byCountry[country])
        .sort(compareLeagues)
        .map((league): LeagueGroup => [league, byCountry[country][league]]),
    ]);
};

/** One section per league, flattened out of the country grouping and ordered by `priority`. */
export const toLeagueSections = (groups: CountryGroup[], priority: (league: string, country: string) => number) =>
  groups
    .flatMap(([country, leagues]) => leagues.map(([league, matches]) => ({ country, league, matches })))
    .sort((a, b) => priority(a.league, a.country) - priority(b.league, b.country));

/** Number of match rows in a country group. */
const rowsIn = (group: CountryGroup): number => group[1].reduce((n, l) => n + l[1].length, 0);

/** The slice of country groups that is drawn for a given row budget, and how many rows stay hidden. */
export const sliceByRowBudget = (groups: CountryGroup[], rowBudget: number) => {
  const visible: CountryGroup[] = [];
  let rows = 0;
  let total = 0;
  for (const g of groups) total += rowsIn(g);
  for (const g of groups) {
    if (visible.length && rows >= rowBudget) break;
    visible.push(g);
    rows += rowsIn(g);
  }
  return { visibleGroups: visible, hiddenRows: Math.max(0, total - rows) };
};

/** Matches of one league grouped by Albanian calendar day, oldest day first. */
export const groupMatchesByDate = (list: Match[]): [string, Match[]][] => {
  const byDate = new Map<string, Match[]>();
  for (const m of list) {
    const key = albaniaDateKey(m.startTime);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(m);
  }
  return Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));
};
