// The order in which competitions are shown (live section, home page, match list):
// the five big leagues, then the UEFA cups, then other international matches, then every other
// top flight, and last the lower divisions.
//   0 Premier League  1 Serie A  2 La Liga  3 Ligue 1  4 Bundesliga
//   5 Champions League  6 Europa League  7 Conference League  8 other international
//   9 other top flights  10 lower divisions of any country
const BIG_FIVE: [country: string, test: RegExp][] = [
  ['Anglia', /^premier league$/],
  ['Italia', /^serie a$/],
  ['Spanja', /^(la ?liga|primera division)$/],
  ['Franca', /^ligue (1|one)$/],
  ['Gjermania', /^bundesliga$/],
];

const normalize = (label: string): string =>
  label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export const LOWER_DIVISION_RANK = 10;

/** Display priority of a league (smaller = earlier). `country` is the Albanian country group. */
export const leaguePriority = (label: string, country: string): number => {
  const name = normalize(label);
  const big = BIG_FIVE.findIndex(([c, test]) => c === country && test.test(name.replace(/^uefa /, '')));
  if (big !== -1) return big;
  if (country === 'Ndërkombëtare') {
    if (/champions league/.test(name) && !/women|youth|u\d\d/.test(name)) return 5;
    if (/conference league/.test(name)) return 7;
    if (/europa league/.test(name)) return 6;
    return 8;
  }
  if (country === 'Të tjera') return LOWER_DIVISION_RANK;
  // Inside the other countries the flagship league (first alphabetically-ranked by the caller)
  // counts as a top flight; second tiers and below are recognised by their usual names.
  if (/\b(2|ii|two|championship|segunda|serie b|ligue 2|division 2|second|b)\b|2\.|u ?\d\d|reserve|youth|women/.test(name)) return LOWER_DIVISION_RANK;
  return 9;
};

/** Country order matching the league priority: big five, international, other known, rest. */
export const COUNTRY_ORDER = ['Anglia', 'Italia', 'Spanja', 'Franca', 'Gjermania', 'Ndërkombëtare', 'Portugali', 'Holandë', 'Belgjikë'];
