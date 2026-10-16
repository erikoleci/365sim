import { ALL_LEAGUES } from './leagueFilters';

// Raw sport keys (e.g. "soccer_brazil_campeonato") are what the app stores and compares; people
// should see readable names. Known keys map to a display label; anything unmapped falls back to
// a prettified version of the key so a new league never shows a raw slug.
const LEAGUE_LABELS: Record<string, string> = {
  soccer_epl: 'Premier League',
  soccer_spain_la_liga: 'La Liga',
  soccer_italy_serie_a: 'Serie A',
  soccer_germany_bundesliga: 'Bundesliga',
  soccer_france_ligue_one: 'Ligue 1',
  soccer_uefa_champs_league: 'UEFA Champions League',
  soccer_uefa_champs_league_qualification: 'UEFA Champions League - Kualifikuese',
  soccer_uefa_europa_league: 'UEFA Europa League',
  soccer_uefa_europa_conference_league: 'UEFA Conference League',
  soccer_fifa_world_cup: 'Kampionati Botëror',
  soccer_fifa_world_cup_qualifiers_europe: 'Kualifikueset Botërore - Evropa',
  soccer_usa_mls: 'MLS',
  soccer_brazil_campeonato: 'Serie A',
  oddsapiio_albania_superiore: 'Kategoria Superiore',
};

// Within a country most people only care about the flagship top-flight league (and, for the
// international group, the big UEFA competitions): those sort first, the rest alphabetically.
const FLAGSHIP_LEAGUE_NAMES = [
  'premier league', 'laliga', 'la liga', 'serie a', 'bundesliga', 'ligue 1',
  'primeira liga', 'eredivisie', 'jupiler pro league', 'super lig',
  'uefa champions league', 'champions league',
  'uefa europa league', 'europa league',
  'uefa europa conference league', 'conference league',
  'uefa nations league',
];

/**
 * The (Albanian) internal label of a league. `leagueNames` holds the names exactly as the provider
 * returns them and wins over everything; the fallback strips "<provider>_<country>__" so a row does
 * not repeat the country already shown in its group header.
 */
export const leagueLabel = (key: string, leagueNames: Record<string, string>): string =>
  key === ALL_LEAGUES
    ? 'Të Gjitha Kampionatet'
    : leagueNames[key] || LEAGUE_LABELS[key] ||
      key
        .replace(/^(soccer|l365)_[a-z0-9-]+__/, '')
        .replace(/^(soccer|l365)_/, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());

/** Comparator: flagship leagues first, then by label. */
export const makeLeagueComparator = (labelOf: (key: string) => string) => {
  const rank = (key: string) => {
    const label = labelOf(key).toLowerCase();
    const idx = FLAGSHIP_LEAGUE_NAMES.findIndex((name) => label === name || label.includes(name));
    return idx === -1 ? 999 : idx;
  };
  return (a: string, b: string) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra !== rb ? ra - rb : labelOf(a).localeCompare(labelOf(b));
  };
};
