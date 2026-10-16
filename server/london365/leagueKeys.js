// League keys and country tokens: how a provider league name becomes the key the app stores.
import { getKV } from '../db.js';

export function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
// Same as slug() but joins words with a dash — used ONLY for the country
// segment of a league key, so a multi-word country ("Costa Rica", "Hong
// Kong", "Czech Republic") survives intact. leagueKey() then separates the
// country segment from the competition slug with a DOUBLE underscore, so
// the frontend can recover the full country name (dashes -> spaces)
// instead of a single-underscore split that only ever grabbed the first
// word and silently truncated every multi-word country to something like
// "Costa" or "Czech".
export function slugDash(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
// League name -> country token, using the SAME vocabulary as App.tsx's
// COUNTRY_TOKEN_LABELS/COUNTRY_TOKEN_ISO so a LondonPro365 league gets the
// correct flag and sidebar grouping instead of falling into "Të tjera".
//
// Reality (confirmed against the live provider): league names come back
// "clean" with NO reliable delimiter — sometimes "Country Competition" with
// no punctuation at all ("Spain La Liga", "Poland Cup"), sometimes just the
// bare competition/state name with NO country word whatsoever ("Amazonense",
// "Gaucho Serie A2", "Carioca Serie A" — Brazilian STATE championships), and
// occasionally "Country: Competition" with a colon. There is no single
// separator to rely on, so we layer several strategies:
//   1. Name literally starts with a known country name -> use it directly.
//   2. "Country: Competition" colon prefix -> use it directly.
//   3. Distinctive competition-name keywords -> mapped country. IMPORTANT:
//      more specific patterns (e.g. Brazilian state leagues, which contain
//      the substring "serie a"/"serie b" just like Italy's Serie A/B) are
//      checked BEFORE the broader ones they'd otherwise collide with.
//   4. Otherwise 'other' (grouped as "Të tjera" on the frontend).
export const COUNTRY_NAMES_BY_LENGTH_DESC = [
  'united arab emirates', 'south africa', 'south korea', 'saudi arabia', 'czech republic',
  'costa rica', 'el salvador', 'hong kong', 'united states', 'bahrain',
  'england', 'spain', 'italy', 'germany', 'france', 'brazil', 'argentina', 'portugal',
  'netherlands', 'holland', 'belgium', 'turkey', 'greece', 'scotland', 'switzerland',
  'austria', 'denmark', 'sweden', 'norway', 'russia', 'poland', 'mexico', 'japan',
  'china', 'australia', 'chile', 'colombia', 'albania', 'croatia', 'serbia', 'romania',
  'ukraine', 'kosovo', 'iceland', 'hungary', 'finland', 'peru', 'slovakia', 'slovenia',
  'ireland', 'uruguay', 'israel', 'bulgaria', 'malaysia', 'belarus', 'estonia', 'wales',
  'malta', 'lithuania', 'latvia', 'ecuador', 'luxembourg', 'georgia', 'armenia',
  'azerbaijan', 'algeria', 'egypt', 'jordan', 'kuwait', 'bahrain', 'qatar', 'guatemala',
  'vietnam', 'indonesia', 'andorra', 'bolivia', 'uzbekistan', 'montenegro', 'canada',
  'nicaragua', 'honduras', 'thailand', 'iraq', 'panama', 'tanzania', 'botswana',
  'zimbabwe', 'uganda', 'paraguay', 'venezuela', 'kazakhstan', 'moldova', 'cyprus',
  'india', 'myanmar', 'nigeria', 'ghana', 'kenya', 'morocco', 'tunisia', 'iran',
];
export const COUNTRY_NAME_TO_TOKEN = {
  england: 'england', spain: 'spain', italy: 'italy', germany: 'germany', france: 'france',
  usa: 'usa', 'united states': 'usa', brazil: 'brazil', argentina: 'argentina', portugal: 'portugal',
  netherlands: 'netherlands', holland: 'netherlands', belgium: 'belgium', turkey: 'turkey', greece: 'greece',
  scotland: 'scotland', switzerland: 'switzerland', austria: 'austria', denmark: 'denmark', sweden: 'sweden',
  norway: 'norway', russia: 'russia', poland: 'poland', mexico: 'mexico', japan: 'japan',
  'south korea': 'korea', korea: 'korea', china: 'china', australia: 'australia', chile: 'chile',
  colombia: 'colombia', albania: 'albania', croatia: 'croatia', serbia: 'serbia', romania: 'romania',
  ukraine: 'ukraine', 'saudi arabia': 'saudi', kosovo: 'kosovo', bahrain: 'bahrain', 'hong kong': 'hong-kong-china',
  world: 'fifa', europe: 'uefa', international: 'uefa',
  india: 'india', indonesia: 'indonesia', malaysia: 'malaysia', myanmar: 'myanmar',
};
// Specific -> broad. Anything that could collide with a broader pattern
// below it (Brazilian state leagues vs. Italy's "Serie A/B") MUST come
// first, since leagueCountryToken() returns on the FIRST match. The
// international/regional-body hints (UEFA/FIFA/CONMEBOL/AFC/ASEAN) MUST
// also come before the bare national-competition-name hints (e.g. "premier
// league" -> england, "championship" -> england) — those are dangerously
// generic and match plenty of OTHER countries' domestic top flights
// ("Bahrain Premier League", "Hong Kong Premier League") and regional
// qualifiers ("ASEAN Championship Qualifying") that have nothing to do
// with England.
export const LEAGUE_COUNTRY_HINTS = [
  // Brazilian state championships — contain "serie a"/"serie b" just like
  // Italy's, so this MUST be checked before the generic Italy pattern.
  [/brasileiro|brasileirao|amazonense|gaucho|carioca|paulista|catarinense|mineiro|baiano|pernambucano|cearense|potiguar|goiano|alagoano|capixaba|sergipano|paraense|matogrossense|brasilia|copa do brasil/, 'brazil'],
  [/champions league|europa league|conference league|uefa|super cup/, 'uefa'],
  [/world cup|fifa|nations league/, 'fifa'],
  [/copa america|conmebol|libertadores|sudamericana/, 'conmebol'],
  [/afc|asian cup|asean/, 'afc'],
  // NOTE: a bare "premier league"/"championship" hint used to sit here,
  // defaulting to England. Removed — it's exactly the kind of dangerously
  // generic match the comment above warns about: it silently mis-bucketed
  // "Dominica Premier League" and "Singapore Premier League 2" as English
  // competitions (confirmed from the live sidebar). Real English top-flight
  // leagues always resolve via the authoritative country_id path (or the
  // "starts with country name" / colon-prefix rules above); an unresolved
  // league with a generic name is far safer left in "other" than
  // confidently mislabeled.
  [/la liga|copa del rey|segunda/, 'spain'],
  [/serie a|serie b|coppa italia/, 'italy'],
  [/bundesliga|dfb.?pokal/, 'germany'],
  [/ligue 1|ligue 2|coupe de france/, 'france'],
  [/eredivisie/, 'netherlands'],
  [/primeira liga|liga portugal/, 'portugal'],
  [/jupiler|belgi/, 'belgium'],
  [/super lig|turk/, 'turkey'],
  [/super league.*greece|greek/, 'greece'],
  [/scottish|premiership/, 'scotland'],
  [/superliga.*shqip|kategoria superiore|albania/, 'albania'],
  [/mls|major league soccer/, 'usa'],
  [/liga mx/, 'mexico'],
];
export function leagueCountryToken(name) {
  const raw = String(name || '');
  const n = raw.toLowerCase();

  // 1. Name literally starts with a known country name, no punctuation
  //    needed ("Spain La Liga", "Poland Cup", "England U21").
  for (const countryName of COUNTRY_NAMES_BY_LENGTH_DESC) {
    if (n === countryName || n.startsWith(countryName + ' ')) {
      if (COUNTRY_NAME_TO_TOKEN[countryName]) return COUNTRY_NAME_TO_TOKEN[countryName];
      const slugged = slugDash(countryName);
      if (slugged) return slugged;
    }
  }

  // 2. "Country: Competition" colon prefix.
  const colonIdx = raw.indexOf(':');
  if (colonIdx > 0) {
    const countryRaw = raw.slice(0, colonIdx).trim().toLowerCase();
    if (COUNTRY_NAME_TO_TOKEN[countryRaw]) return COUNTRY_NAME_TO_TOKEN[countryRaw];
    for (const [re, token] of LEAGUE_COUNTRY_HINTS) if (re.test(n)) return token;
    const slugged = slugDash(countryRaw);
    if (slugged) return slugged;
  }

  // 3. Distinctive competition-name keywords (Brazil-before-Italy etc.).
  for (const [re, token] of LEAGUE_COUNTRY_HINTS) if (re.test(n)) return token;

  return 'other';
}
// Preferred key builder: resolves the country from the provider's REAL
// country name (via country.id <- league.country_id), falling back to the
// name-heuristic above only when that real name isn't available.
// Strip a leading "<country> " word-sequence from a raw league name before
// it becomes the competition-slug half of a key — SAFELY (word-by-word
// compare, not a blind string replace) — so a provider name like "England
// Premier League" produces the same grouping key as "Premier League" would
// (l365_england__premier_league either way), instead of baking the country
// in twice (l365_england__england_premier_league). The raw name itself is
// never mutated — this only affects the derived grouping key.
export function stripRedundantCountryWords(countryName, leagueName) {
  const name = String(leagueName || '');
  if (!countryName) return name;
  const countryWords = String(countryName).toLowerCase().split(/\s+/).filter(Boolean);
  const nameWords = name.split(/\s+/).filter(Boolean);
  if (!countryWords.length || nameWords.length <= countryWords.length) return name;
  const matches = countryWords.every((w, i) => (nameWords[i] || '').toLowerCase() === w);
  return matches ? nameWords.slice(countryWords.length).join(' ') : name;
}
export function leagueKeyFromCountry(countryName, leagueName) {
  const token = countryName ? (slugDash(countryName) || 'other') : leagueCountryToken(leagueName);
  const competitionName = countryName ? stripRedundantCountryWords(countryName, leagueName) : leagueName;
  return 'l365_' + token + '__' + (slug(competitionName) || 'league');
}
// Build the same provider_country_slug league key format The Odds API uses
// (e.g. soccer_italy_serie_a), so App.tsx's existing flag/grouping regex
// picks these up automatically with no frontend changes needed.
// Country segment first, THEN a double underscore, THEN the competition
// slug — the double underscore is the unambiguous boundary App.tsx uses to
// recover the full (possibly multi-word/dashed) country segment, instead
// of the old single-underscore format that only ever kept the country's
// first word.
export function leagueKey(name) {
  return 'l365_' + leagueCountryToken(name) + '__' + (slug(name) || 'league');
}
// Diagnostic helper: shows exactly how leagueCountryToken() classifies every
// raw league name we've actually seen from the provider, so mapping issues
// (a league landing in the wrong country, or in "other") can be inspected
// directly instead of guessed at.
export async function getLondon365CountryDebug() {
  const names = await getKV('l365_leagues', []);
  const byCountry = {};
  for (const name of names) {
    const token = leagueCountryToken(name);
    (byCountry[token] = byCountry[token] || []).push(name);
  }
  const summary = Object.entries(byCountry)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([token, leagueNames]) => ({ token, count: leagueNames.length, leagueNames }));
  return { totalLeagues: names.length, otherCount: (byCountry.other || []).length, summary };
}
