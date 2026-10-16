import { Match, MatchStatus } from '../types';
import { albaniaDateKey } from './albaniaTime';

export type LeagueGroup = [league: string, matches: Match[]];
export type CountryGroup = [country: string, leagues: LeagueGroup[]];

const PRIORITY_COUNTRIES = ['Anglia', 'Spanja', 'Italia', 'Gjermania', 'Franca', 'Portugali', 'Holandë', 'Belgjikë'];

/**
 * Country order: the big European leagues first, then every other country alphabetically, then
 * the continental/international competitions, then "Të tjera".
 */
export const compareCountries = (a: string, b: string): number => {
  if (a === 'Të tjera') return 1;
  if (b === 'Të tjera') return -1;
  if (a === 'Ndërkombëtare') return 1;
  if (b === 'Ndërkombëtare') return -1;
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

/** One section per league (European cups first), flattened out of the country grouping. */
export const toLeagueSections = (groups: CountryGroup[], isEuropeanCup: (league: string) => boolean) =>
  groups
    .flatMap(([country, leagues]) => leagues.map(([league, matches]) => ({ country, league, matches })))
    .sort((a, b) => Number(isEuropeanCup(b.league)) - Number(isEuropeanCup(a.league)));

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
