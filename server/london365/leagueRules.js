// Which leagues/competitions are wanted: international allow-list, minor/youth/lower-division and second-tier exclusion.
import { ALL_MATCHES, EXCLUDE_SECOND_TIER, MAJOR_LEAGUES_ONLY, EXCLUDED_COUNTRIES, ONLY_COUNTRIES, SPORTS_RAW, LEAGUE_LIMIT, FULL_DETAIL, PRIORITY_COUNTRIES } from './config.js';
import { leagueCountryToken } from './leagueKeys.js';

// The "International" country bucket covers ALL continental/international
// competitions the provider carries — UEFA Champions/Europa/Conference
// League and Nations League, but also things like Copa Libertadores,
// Copa Sudamericana, AFC competitions, and CONMEBOL World Cup qualifiers.
// Blanket-allowing the whole "International" bucket (the line above) meant
// someone scoping LONDON365_ONLY_COUNTRIES down to European leagues still
// got South American club competitions in their Live tab (reported: Sao
// Paulo FC vs Boca Juniors showing up despite a europe-only country list)
// — not a bug in the country filter itself, just too broad a carve-out.
// Narrow it to league NAMES that are actually UEFA/European competitions.
export const EUROPEAN_INTERNATIONAL_COMPETITION_RE =
  /\b(uefa|euro(?:pean)?\s*(?:championship|qualif))/i;
// "Champions/Europa/Conference League" alone (no "UEFA" prefix) is also
// common in feeds for the European competitions specifically, but AFC/CAF/
// CONCACAF/OFC run their own "Champions League" too — so only match the
// bare name when it is NOT prefixed by another confederation's acronym.
// "Nations League" moved in here (it used to be unguarded in the regex above)
// so CONCACAF / AFC / CAF Nations Leagues are no longer accepted as European.
export const BARE_EUROPEAN_CUP_RE = /(?<!\b(?:afc|caf|concacaf|ofc|conmebol)\s)\b(champions league|europa league|conference league|nations league)\b/i;
export function isEuropeanInternationalCompetition(leagueName) {
  const name = String(leagueName || '');
  return EUROPEAN_INTERNATIONAL_COMPETITION_RE.test(name) || BARE_EUROPEAN_CUP_RE.test(name);
}
// OPT-IN extras for the International bucket (default: none). The three
// competitions this project is scoped to -- UEFA Champions League, UEFA Europa
// League, UEFA Nations League -- plus the other UEFA/Euro competitions the
// existing regexes above already treat as major are always kept; anything else
// (e.g. 'fifa|world cup') must be requested explicitly through
// LONDON365_INTERNATIONAL_EXTRA (a case-insensitive regex source).
export let INTERNATIONAL_EXTRA_RE = null;
if (process.env.LONDON365_INTERNATIONAL_EXTRA) {
  try { INTERNATIONAL_EXTRA_RE = new RegExp(process.env.LONDON365_INTERNATIONAL_EXTRA, 'i'); }
  catch (err) { console.error('[london365] invalid LONDON365_INTERNATIONAL_EXTRA, ignoring it:', err.message); }
}
// The single predicate for "is this International-bucket competition one we
// want?" -- used by the prematch import, the live REST loop, the socket
// handlers and the purge, so they can no longer disagree with each other.
// Youth / reserve / women's / amateur / friendly / virtual variants are
// rejected HERE, unconditionally (not only when MAJOR_ONLY=1), so "UEFA Youth
// League" or "UEFA Women's Champions League" can never ride in on the word UEFA.
export function isAllowedInternationalCompetition(leagueName) {
  const name = String(leagueName || '');
  if (MINOR_LEAGUE_PATTERN.test(name)) return false;
  return isEuropeanInternationalCompetition(name) || (INTERNATIONAL_EXTRA_RE ? INTERNATIONAL_EXTRA_RE.test(name) : false);
}
export const MINOR_LEAGUE_PATTERN = /\bu-?1[0-9]\b|\bu-?2[0-3]\b|\byouth\b|\bjunior\b|\breserves?\b|\bwomen'?s?\b|\bfemale\b|\bfeminin[ao]?\b|\bamateur\b|\bacademy\b|\bfriendl(y|ies)\b|\besoccer\b|\be-?soccer\b|\bsimulated\b|\bvirtual\b/i;
// Brazil specifically has ~25 STATE championships running in parallel
// (Serie A/B/C/D are the national ones worth keeping; everything named
// after a state — Gaucho, Carioca, Paulista, Mineiro, Baiano, Amazonense,
// Catarinense, Cearense, Potiguar, Goiano, Alagoano, Capixaba, Sergipano,
// Paraense, Matogrossense, Pernambucano, Brasilia — is a minor regional
// league). Copa do Brasil (the national cup) is always kept.
export const BRAZIL_STATE_LEAGUE_PATTERN = /gaucho|carioca|paulista|mineiro|baiano|amazonense|catarinense|cearense|potiguar|goiano|alagoano|capixaba|sergipano|paraense|matogrossense|pernambucano|brasilia(?!ns)/i;
// Clearly regional / amateur / semi-pro tiers inside the five whitelisted
// countries (Germany Regionalliga+, Spain Tercera / RFEF tiers, Italy Serie D
// and below, France National 2/3, England National League and below). The
// professional tiers (Championship, League One/Two, 2. Bundesliga, 3. Liga,
// Serie B/C, La Liga 2, Ligue 2) are NOT matched and stay. Extend with
// LONDON365_EXCLUDE_LEAGUE_PATTERN (regex source, case-insensitive).
export const LOWER_DIVISION_PATTERN = /\bregionalliga\b|\boberliga\b|\bverbandsliga\b|\blandesliga\b|\bkreisliga\b|\bbezirksliga\b|\bgruppenliga\b|\btercera\b|\bsegunda b\b|\brfef\b|\bpreferente\b|\bserie d\b|\beccellenza\b|\bpromozione\b|\bnational [23]\b|\bnational league\b|\bnorthern premier\b|\bsouthern (?:premier|league)\b|\bisthmian\b|\bnon[- ]league\b/i;
export let EXTRA_EXCLUDE_RE = null;
if (!ALL_MATCHES && process.env.LONDON365_EXCLUDE_LEAGUE_PATTERN) {
  try { EXTRA_EXCLUDE_RE = new RegExp(process.env.LONDON365_EXCLUDE_LEAGUE_PATTERN, 'i'); }
  catch (err) { console.error('[london365] invalid LONDON365_EXCLUDE_LEAGUE_PATTERN, ignoring it:', err.message); }
}
export const DOMESTIC_SECOND_TIER_PATTERNS = {
  england: /\bchampionship\b/i,
  france: /\bligue\s*2\b/i,
  spain: /\b(la\s*liga|laliga)\s*(2|smartbank)\b|\bsegunda\s*divisi[oó]n\b/i,
  italy: /\bserie\s*b\b/i,
  germany: /\b2\.?\s*bundesliga\b/i,
};
export function isSecondTierDomesticLeague(name, countryToken) {
  if (!EXCLUDE_SECOND_TIER || !countryToken) return false;
  const pattern = DOMESTIC_SECOND_TIER_PATTERNS[countryToken];
  if (!pattern) return false; // no built-in second-tier pattern for this country -> unaffected
  return pattern.test(String(name || ''));
}
export function isMinorLeague(name, countryName) {
  if (!MAJOR_LEAGUES_ONLY) return false;
  const n = String(name || '');
  if (MINOR_LEAGUE_PATTERN.test(n)) return true;
  if (LOWER_DIVISION_PATTERN.test(n)) return true;
  if (EXTRA_EXCLUDE_RE && EXTRA_EXCLUDE_RE.test(n)) return true;
  // The country bucket itself can be amateur/youth-only (e.g. "Austria
  // Amateur", "Germany Amateur", "England Amateur", "International Youth"
  // from CONFIRMED_COUNTRY_IDS) even when a league's own name inside it
  // doesn't contain any of those words (e.g. "Regionalliga West").
  if (MINOR_LEAGUE_PATTERN.test(String(countryName || ''))) return true;
  if ((countryName || '').toLowerCase() === 'brazil' && BRAZIL_STATE_LEAGUE_PATTERN.test(n) && !/copa do brasil/i.test(n)) return true;
  return false;
}
// THE catalogue rule, in one place. Returns null when a league is wanted, or a
// short reason string when it is not. Every entry point uses it -- the prematch
// import (twice: when the league list is built, so an LEAGUE cap can never be
// spent on unwanted leagues, and again per league as a guard), the live REST
// loop and the socket handlers -- so they cannot disagree.
//   excluded-country      LONDON365_EXCLUDE_COUNTRIES
//   country-not-allowed   not in LONDON365_ONLY_COUNTRIES (or country unknown)
//   international-not-major  inside "International" but not a whitelisted
//                         competition (UCL / UEL / Conference / Nations League /
//                         other UEFA-Euro ones; youth/women's/friendlies never)
//   minor-league          youth / reserve / women's / amateur / friendly /
//                         virtual / regional lower tier (needs MAJOR_ONLY=1)
// LONDON365_FULL is deliberately NOT an input: it only decides how much detail
// is fetched for a league that already passed.
export function leagueRejectionReason(leagueName, countryName) {
  const c = countryName ? String(countryName).toLowerCase() : null;
  if (c && EXCLUDED_COUNTRIES.has(c)) return 'excluded-country';
  if (ONLY_COUNTRIES.size) {
    if (!(c && ONLY_COUNTRIES.has(c))) return 'country-not-allowed';
    if (c === 'international') {
      if (!isAllowedInternationalCompetition(leagueName)) return 'international-not-major';
    }
  }
  if (isMinorLeague(leagueName, countryName)) return 'minor-league';
  // Second-tier exclusion runs LAST and only for a non-International,
  // whitelisted country: cups/super cups/top-flight of an allowed country
  // pass through untouched, only that country's known second-tier name is
  // rejected here.
  if (c && c !== 'international' && isSecondTierDomesticLeague(leagueName, c)) return 'second-tier-excluded';
  return null;
}
export function getLondon365FilterConfig() {
  return {
    sports: SPORTS_RAW,
    allMatches: ALL_MATCHES,
    onlyCountries: Array.from(ONLY_COUNTRIES),
    whitelistActive: ONLY_COUNTRIES.size > 0,
    majorOnly: MAJOR_LEAGUES_ONLY,
    excludeCountries: Array.from(EXCLUDED_COUNTRIES),
    internationalExtra: INTERNATIONAL_EXTRA_RE ? INTERNATIONAL_EXTRA_RE.source : null,
    excludeSecondTier: EXCLUDE_SECOND_TIER,
    excludeLeaguePattern: EXTRA_EXCLUDE_RE ? EXTRA_EXCLUDE_RE.source : null,
    leagueLimit: LEAGUE_LIMIT,
    fullDetail: FULL_DETAIL,
    priorityCountries: Array.from(PRIORITY_COUNTRIES),
  };
}
export function logLondon365FilterConfig() {
  const c = getLondon365FilterConfig();
  console.log('[london365] catalogue filter: ' + JSON.stringify(c));
  if (!c.whitelistActive) console.warn('[london365] WARNING: LONDON365_ONLY_COUNTRIES is disabled (\'*\') -> importing EVERY country worldwide');
}
export function isAllowedByCountryFilter(g, resolvedLeague) {
  if (!ONLY_COUNTRIES.size) return true; // whitelist explicitly disabled ('*')
  // League known (from the import's own country/league data): the exact same
  // rule the import applied.
  if (resolvedLeague && resolvedLeague.countryName) {
    return leagueRejectionReason(resolvedLeague.name || (g && g.league) || '', resolvedLeague.countryName) === null;
  }
  // League not (yet) known: judge on the payload's league text. A youth /
  // reserve / women's / lower-tier name, or (for a whitelisted country) a cup
  // / non-top-flight competition, is rejected even when the country token is
  // whitelisted ("England U23", "Spain Reserves", "Germany Regionalliga",
  // "Italy Coppa Italia").
  const rawName = (g && g.league) || '';
  const token = leagueCountryToken(rawName);
  if (ONLY_COUNTRIES.has(token)) return !isMinorLeague(rawName, token) && !isSecondTierDomesticLeague(rawName, token);
  return ONLY_COUNTRIES.has('international') && isAllowedInternationalCompetition(rawName);
}
