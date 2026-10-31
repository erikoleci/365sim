// Same rule as utils/majorResults.ts (keep them in step): the competitions whose finished matches we keep.
const MINOR = /(^|_)(u\d\d|youth|women|womens|reserves?|amateur|friendlies|friendly|virtual|simulated|2|ii|b|3)(_|$)|second|segunda|championship_?(?!$)|serie_b|ligue_2/;
const DOMESTIC = {
  england: /^(english_)?premier_league$/,
  italy: /^(italian_)?serie_a$/,
  spain: /^(spanish_)?(la_?liga|primera_division)$/,
  germany: /^(german_)?bundesliga$/,
  france: /^(french_)?ligue_1$/,
  portugal: /^(portuguese_)?(primeira_liga|liga_portugal(_betclic|_bwin)?|liga_nos)$/,
};
const INTERNATIONAL = /(champions_league|europa_league|world_cup|european_championship|euro_\d{4}|^euro$|^euros$)/;

export function isMajorResultLeague(leagueKey) {
  const key = String(leagueKey || '').toLowerCase();
  const m = /^l365_([a-z0-9-]+)__(.+)$/.exec(key);
  if (!m) return false;
  const [, country, comp] = m;
  if (country === 'international') return INTERNATIONAL.test(comp) && !MINOR.test(comp.replace(/world_cup|champions_league|europa_league/g, ''));
  const rule = DOMESTIC[country];
  return !!rule && rule.test(comp);
}
