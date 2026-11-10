import { useMemo } from 'react';
import { Match, MatchStatus } from '../types';
import { useI18n } from '../i18n';
import { albaniaDateKey, albaniaTodayKey, isSameAlbaniaDay } from '../utils/albaniaTime';
import { groupResultsByLeague, recentResults } from '../utils/results';
import { MAX_LIVE_AGE_MS } from '../utils/liveStatus';
import { countryFlag, leagueCountry } from '../utils/leagueGrouping';
import { ALL_LEAGUES, FAVORITES, countryFromFilter, isCountryFilter } from '../utils/leagueFilters';
import { leagueLabel as baseLeagueLabel, makeLeagueComparator } from '../utils/leagueLabels';
import {
  compareCountries, groupByCountryAndLeague, liveFirstByKickoff, sliceByRowBudget, toLeagueSections,
} from '../utils/matchGrouping';
import { leaguePriority } from '../utils/leaguePriority';
import { buildDateOptions } from '../utils/dateLabels';
import { matchWeight } from '../utils/topClubs';
import { favoriteLeaguesFirst, isFavoriteMatch } from '../utils/favoritesFirst';

interface Inputs {
  matches: Match[];
  leagueNames: Record<string, string>;
  searchQuery: string;
  currentLeague: string;
  selectedDate: string;
  rowBudget: number;
  favoriteTeams: Set<string>;
  favoriteLeagues: Set<string>;
  favoriteMatches: Set<string>;
  // Which screen the search belongs to: it only looks inside what that screen shows.
  showLiveOnly: boolean;
  showResults: boolean;
}

const FEATURED_LIMIT = 12;
const FAVORITE_LIMIT = 15;
const FEATURED_DAYS = 4; // headliners are picked from the next few days first
const SUGGESTION_LIMIT = 5;
const includes = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle);

/**
 * Everything the sportsbook screens show, derived from the match list and the current filters:
 * live / upcoming / today / featured / results, grouped country -> league -> day, the league menu
 * and the search suggestions. Pure derivation, no state of its own.
 */
export function useSportsbookViews({ matches, leagueNames, searchQuery, currentLeague, selectedDate, rowBudget, favoriteTeams, favoriteLeagues, favoriteMatches, showLiveOnly, showResults }: Inputs) {
  const { t, lang } = useI18n();

  // The Albanian internal label (used for ranking/sorting); only what is SHOWN goes through t().
  const leagueLabel = useMemo(() => (key: string) => baseLeagueLabel(key, leagueNames), [leagueNames]);
  const leagueText = useMemo(() => (key: string) => t(leagueLabel(key)), [leagueLabel, t]);
  const compareLeagues = useMemo(() => makeLeagueComparator(leagueLabel), [leagueLabel]);

  const dateOptions = useMemo(() => buildDateOptions(t, lang), [t, lang]);

  // Search applies everywhere.
  const searchFiltered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return matches.filter((m) => includes(m.homeTeam, q) || includes(m.awayTeam, q) || includes(m.league, q));
  }, [matches, searchQuery]);

  // LIVE has its own section; a match still "LIVE" long after kick-off is a stuck one and is hidden.
  const liveMatches = useMemo(() => searchFiltered
    .filter((m) => m.status === MatchStatus.LIVE && Date.now() - new Date(m.startTime).getTime() < MAX_LIVE_AGE_MS)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()),
  [searchFiltered]);

  // Within the current choice (all / favourites / country / league) WITHOUT the date filter. Live
  // matches are included only when a specific country/league is open: "all" means "all that is
  // coming", live has its own tab, but a live PSG-Monaco inside the France page must not vanish.
  const includeLiveInScope = isCountryFilter(currentLeague) || (currentLeague !== ALL_LEAGUES && currentLeague !== FAVORITES);
  const scopedUpcoming = useMemo(() => searchFiltered
    .filter((m) => m.status === MatchStatus.UPCOMING || (includeLiveInScope && m.status === MatchStatus.LIVE))
    .filter((m) => {
      if (currentLeague === ALL_LEAGUES) return true;
      if (currentLeague === FAVORITES) return favoriteMatches.has(m.id) || favoriteTeams.has(m.homeTeam) || favoriteTeams.has(m.awayTeam) || favoriteLeagues.has(m.league);
      if (isCountryFilter(currentLeague)) return leagueCountry(m.league) === countryFromFilter(currentLeague);
      return m.league === currentLeague;
    })
    .sort(liveFirstByKickoff),
  [searchFiltered, currentLeague, favoriteTeams, favoriteLeagues, favoriteMatches, includeLiveInScope]);

  const dateScopedUpcoming = useMemo(
    () => scopedUpcoming.filter((m) => selectedDate === 'ALL' || albaniaDateKey(m.startTime) === selectedDate),
    [scopedUpcoming, selectedDate],
  );

  // A league/country with nothing on the chosen date but matches on other days shows ALL its
  // upcoming matches under their own dates instead of an empty page.
  const dateFallbackActive = selectedDate !== 'ALL' && dateScopedUpcoming.length === 0 && scopedUpcoming.length > 0;
  const upcomingMatches = dateFallbackActive ? scopedUpcoming : dateScopedUpcoming;

  const selectedCountry = isCountryFilter(currentLeague) ? countryFromFilter(currentLeague) : null;
  // The user's favourite leagues (and the countries holding them) come first.
  const upcomingByCountry = useMemo(
    () => favoriteLeaguesFirst(groupByCountryAndLeague(upcomingMatches, leagueCountry, compareLeagues, selectedCountry), favoriteLeagues),
    [upcomingMatches, compareLeagues, selectedCountry, favoriteLeagues],
  );
  // The list is drawn in slices of rows so switching views never builds hundreds of rows at once.
  const { visibleGroups, hiddenRows } = useMemo(() => sliceByRowBudget(upcomingByCountry, rowBudget), [upcomingByCountry, rowBudget]);

  // The "Live Tani" section shows every live match grouped by league (European cups first).
  const liveLeagueSections = useMemo(
    () => toLeagueSections(
      groupByCountryAndLeague(liveMatches, leagueCountry, compareLeagues),
      (league, country) => (favoriteLeagues.has(league) ? -1 : leaguePriority(leagueLabel(league), country)),
    ),
    [liveMatches, compareLeagues, leagueLabel, favoriteLeagues],
  );

  // Same order everywhere: the big five and the UEFA cups first, then the rest, lower divisions last.
  const priorityOf = useMemo(() => (m: Match) => leaguePriority(leagueLabel(m.league), leagueCountry(m.league)), [leagueLabel]);
  const byPriorityThenKickoff = useMemo(() => (a: Match, b: Match) =>
    priorityOf(a) - priorityOf(b) || new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  [priorityOf]);

  // "Ndeshjet Kryesore": upcoming only (live matches have their own section). The biggest matches first -- two strong
  // clubs, a European night -- from the next few days; if those are too few, from everything that is coming.
  const featuredMatches = useMemo(() => {
    const upcoming = matches.filter((m) => m.status === MatchStatus.UPCOMING);
    const horizon = Date.now() + FEATURED_DAYS * 24 * 3600 * 1000;
    const weight = (m: Match) => matchWeight(m.homeTeam, m.awayTeam, priorityOf(m));
    const rank = (a: Match, b: Match) => weight(b) - weight(a) || byPriorityThenKickoff(a, b);
    const soon = upcoming.filter((m) => new Date(m.startTime).getTime() <= horizon).sort(rank);
    const picked = soon.length >= 6 ? soon : [...soon, ...upcoming.filter((m) => !soon.includes(m)).sort(rank)];
    return picked.slice(0, FEATURED_LIMIT);
  }, [matches, priorityOf, byPriorityThenKickoff]);

  // "★ Të preferuarat" on the home page: coming and live matches of the starred teams / matches, live first.
  const favoriteList = useMemo(() => {
    if (favoriteTeams.size === 0 && favoriteMatches.size === 0) return [] as Match[];
    const sets = { teams: favoriteTeams, leagues: favoriteLeagues, matches: favoriteMatches };
    return matches
      .filter((m) => (m.status === MatchStatus.UPCOMING || m.status === MatchStatus.LIVE) && isFavoriteMatch(m, sets))
      .sort(liveFirstByKickoff)
      .slice(0, FAVORITE_LIMIT);
  }, [matches, favoriteTeams, favoriteLeagues, favoriteMatches]);

  const todayMatches = useMemo(() => matches
    .filter((m) => (m.status === MatchStatus.UPCOMING || m.status === MatchStatus.LIVE) && isSameAlbaniaDay(m.startTime, albaniaTodayKey()))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === MatchStatus.LIVE ? -1 : 1) || byPriorityThenKickoff(a, b)),
  [matches, byPriorityThenKickoff]);

  // Results: finished within 48h, newest first, grouped by league.
  const resultsList = useMemo(() => recentResults(matches, searchQuery), [matches, searchQuery]);
  // The strongest competitions first (big five, UEFA cups), the rest after; inside a tier the most recent first.
  const resultsSections = useMemo(
    () => {
      const rank = (league: string) => (favoriteLeagues.has(league) ? -1 : leaguePriority(leagueLabel(league), leagueCountry(league)));
      return groupResultsByLeague(resultsList).sort((a, b) =>
      rank(a.league) - rank(b.league));
    },
    [resultsList, leagueLabel, favoriteLeagues],
  );

  // The league menu: leagues grouped by country, flagship leagues first.
  const leaguesByCountry = useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const league of new Set(matches.map((m) => m.league))) {
      (groups[leagueCountry(league)] ??= []).push(league);
    }
    Object.values(groups).forEach((list) => list.sort(compareLeagues));
    return Object.keys(groups).sort(compareCountries).map((country) => [country, groups[country]] as [string, string[]]);
  }, [matches, compareLeagues]);

  // What the search looks into: only the live matches on the live screen, only the results on the results screen,
  // everything on the others.
  const suggestionPool = useMemo(() => {
    if (showLiveOnly) return matches.filter((m) => m.status === MatchStatus.LIVE && Date.now() - new Date(m.startTime).getTime() < MAX_LIVE_AGE_MS);
    if (showResults) return recentResults(matches, '');
    return matches;
  }, [matches, showLiveOnly, showResults]);

  // Autocomplete: teams / leagues / direct match hits, filtered from data already loaded.
  const searchSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return { teams: [] as string[], leagues: [] as string[], matches: [] as Match[] };
    const teams = new Set<string>();
    const leagues = new Set<string>();
    for (const m of suggestionPool) {
      if (includes(m.homeTeam, q)) teams.add(m.homeTeam);
      if (includes(m.awayTeam, q)) teams.add(m.awayTeam);
      if (includes(leagueLabel(m.league), q) || includes(leagueText(m.league), q)) leagues.add(m.league);
    }
    const direct = suggestionPool.filter((m) => includes(m.homeTeam, q) || includes(m.awayTeam, q)).slice(0, SUGGESTION_LIMIT);
    return { teams: [...teams].slice(0, SUGGESTION_LIMIT), leagues: [...leagues].slice(0, SUGGESTION_LIMIT), matches: direct };
  }, [searchQuery, suggestionPool, leagueLabel, leagueText]);

  return {
    leagueLabel, leagueText, dateOptions,
    liveMatches, liveLeagueSections, upcomingByCountry, visibleGroups, hiddenRows, dateFallbackActive,
    featuredMatches, favoriteList, todayMatches, resultsList, resultsSections,
    leaguesByCountry, searchSuggestions, countryFlag, leagueCountry,
  };
}
