// LondonPro365 data provider for 365sim.
//
// Pulls every match, market, and coefficient from the londonpro365.com
// backend API (real host: eccoplay365.com) and stores it in matches_cache
// using the canonical The-Odds-API event shape the rest of the app consumes,
// so listing, match detail, bet verification, odds history, and settlement
// all work on this data without changes. A background loop syncs in-play
// scores and real-time odds movement from the livegames endpoint.
//
// Env:
//   LONDON365_ENABLED            1 (default) or 0
//   LONDON365_API                default https://eccoplay365.com
//   LONDON365_ORIGIN             default https://londonpro365.com
//   LONDON365_SPORTS             csv sport ids, or 'all' (default) to
//                                discover every sport the provider exposes
//   LONDON365_LEAGUES            league cap per sport, 0 = all
//   LONDON365_PRIORITY_COUNTRIES csv of real country names (as returned by
//                                /ajax/countries, e.g. "England,France,Spain,
//                                Italy,Germany") — when set, ONLY these
//                                countries get the expensive full-detail
//                                fetch (every market/coefficient); every
//                                other country still imports (basic 1X2 +
//                                whatever the list endpoint already includes)
//                                but skips the extra per-game detail request.
//                                Lets you keep full depth for the leagues
//                                that matter most while running "all sports,
//                                no league cap" on limited server memory.
//                                Empty/unset (default) = full detail for
//                                everyone, same as before this option existed.
//   LONDON365_FULL                1 = fetch every market via detail endpoint
//   LONDON365_LIVE_INTERVAL_MS   default 30000 (min 10000)
//   LONDON365_IMPORT_THROTTLE_MS default 600000

import pool, { getKV, setKV } from './db.js';
import { diffOddsChanges } from './oddsUtils.js';
import { pushOddsChanged, pushGoal } from './ws.js';
import { settleMatch } from './matchSettlement.js';

const ENABLED = (process.env.LONDON365_ENABLED || '1') === '1';
const API_BASE = process.env.LONDON365_API || 'https://eccoplay365.com';
const SITE_ORIGIN = process.env.LONDON365_ORIGIN || 'https://londonpro365.com';
// 'all' (default) discovers every sport the provider exposes so no match is
// hidden; a csv like "1,2,5" restricts the import to those sport ids.
const SPORTS_RAW = (process.env.LONDON365_SPORTS || 'all').trim();
let resolvedSports = null;

export async function resolveSports() {
  if (resolvedSports) return resolvedSports;
  if (SPORTS_RAW !== 'all') {
    resolvedSports = SPORTS_RAW.split(',').map(Number).filter(Boolean);
    return resolvedSports;
  }
  try {
    const sports = await api('/ajax/sports');
    const ids = Array.isArray(sports) ? sports.map((s) => Number(s.id)).filter(Boolean) : [];
    resolvedSports = ids.length ? ids : [1];
  } catch (err) {
    console.error('[london365] sports discovery failed, falling back to Soccer:', err.message);
    resolvedSports = [1];
  }
  return resolvedSports;
}
const LEAGUE_LIMIT = Number(process.env.LONDON365_LEAGUES || 0);
// Empty set = no restriction = full detail for every country (old behavior).
const PRIORITY_COUNTRIES = new Set(
  (process.env.LONDON365_PRIORITY_COUNTRIES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);
const wantsFullDetailFor = (countryName) =>
  !PRIORITY_COUNTRIES.size ||
  (countryName && (PRIORITY_COUNTRIES.has(countryName.toLowerCase()) || TOP_PRIORITY_COUNTRIES.has(countryName.toLowerCase())));
// Skip minor/youth/regional leagues so the import spends its time+requests
// on what people actually check (top flight + main cup per country) instead
// of burning through e.g. Brazil's dozens of state championships (Gaucho,
// Carioca, Paulista, Amazonense...) or U20/women/amateur competitions for
// every single country. LONDON365_MAJOR_ONLY=0 disables this (full catalog,
// old/slower behavior).
const MAJOR_LEAGUES_ONLY = (process.env.LONDON365_MAJOR_ONLY || '1') === '1';
// Countries excluded entirely (no leagues, no matches at all) — csv of real
// country names, comma-separated, case-insensitive. Brazil is excluded by
// default per explicit request: its huge volume of state/regional
// competitions was cluttering the feed and it isn't a priority market.
const EXCLUDED_COUNTRIES = new Set(
  (process.env.LONDON365_EXCLUDE_COUNTRIES || 'brazil')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);
// Opposite of EXCLUDED_COUNTRIES: when set, ONLY these countries are
// imported at all — everything else is skipped outright (not just
// deprioritized like PRIORITY_COUNTRIES, and not just missing full detail).
// This is the real fix for "too much load"/"too many countries" — every
// other lever (leagueCap, MAJOR_ONLY, PRIORITY_COUNTRIES) still walks every
// country's leagues, it just trims what happens per league. This one skips
// the country's leagues entirely before any games/detail requests happen,
// which is what actually cuts import time+request volume down when running
// on a constrained host. Empty = no restriction (import every country, old
// behavior). A league whose country can't be resolved at all is skipped
// when this allowlist is active, since there's no way to know if it belongs.
const ONLY_COUNTRIES = new Set(
  (process.env.LONDON365_ONLY_COUNTRIES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);
// International/continental competitions (Champions League, Europa League,
// Nations League, World Cup qualifiers...) are never excludable via
// LONDON365_ONLY_COUNTRIES — someone listing "england,spain,italy,..." to
// trim the domestic-league catalog down almost certainly still wants
// Champions League etc, which live under their own "International" country
// bucket, not under any single nation.
if (ONLY_COUNTRIES.size) ONLY_COUNTRIES.add('international');
const MINOR_LEAGUE_PATTERN = /\bu-?1[0-9]\b|\bu-?2[0-3]\b|\byouth\b|\bjunior\b|\breserves?\b|\bwomen'?s?\b|\bfemale\b|\bfeminin[ao]?\b|\bamateur\b|\bacademy\b|\bfriendl(y|ies)\b|\besoccer\b|\be-?soccer\b|\bsimulated\b|\bvirtual\b/i;
// Brazil specifically has ~25 STATE championships running in parallel
// (Serie A/B/C/D are the national ones worth keeping; everything named
// after a state — Gaucho, Carioca, Paulista, Mineiro, Baiano, Amazonense,
// Catarinense, Cearense, Potiguar, Goiano, Alagoano, Capixaba, Sergipano,
// Paraense, Matogrossense, Pernambucano, Brasilia — is a minor regional
// league). Copa do Brasil (the national cup) is always kept.
const BRAZIL_STATE_LEAGUE_PATTERN = /gaucho|carioca|paulista|mineiro|baiano|amazonense|catarinense|cearense|potiguar|goiano|alagoano|capixaba|sergipano|paraense|matogrossense|pernambucano|brasilia(?!ns)/i;
function isMinorLeague(name, countryName) {
  if (!MAJOR_LEAGUES_ONLY) return false;
  const n = String(name || '');
  if (MINOR_LEAGUE_PATTERN.test(n)) return true;
  // The country bucket itself can be amateur/youth-only (e.g. "Austria
  // Amateur", "Germany Amateur", "England Amateur", "International Youth"
  // from CONFIRMED_COUNTRY_IDS) even when a league's own name inside it
  // doesn't contain any of those words (e.g. "Regionalliga West").
  if (MINOR_LEAGUE_PATTERN.test(String(countryName || ''))) return true;
  if ((countryName || '').toLowerCase() === 'brazil' && BRAZIL_STATE_LEAGUE_PATTERN.test(n) && !/copa do brasil/i.test(n)) return true;
  return false;
}
// Used ONLY to decide sort order before an optional LEAGUE_LIMIT cap is
// applied, so a cap (if configured) can never cut off the leagues people
// actually check. Falls back to the obvious big leagues even when
// LONDON365_PRIORITY_COUNTRIES isn't set, unlike PRIORITY_COUNTRIES above
// (which intentionally means "no restriction" when empty for the
// full-detail-vs-list-only decision — a separate, unrelated concern).
const SORT_PRIORITY_COUNTRIES = PRIORITY_COUNTRIES.size
  ? PRIORITY_COUNTRIES
  : new Set(['international', 'uefa', 'england', 'spain', 'italy', 'germany', 'france', 'brazil', 'portugal', 'netherlands']);
// International/continental competitions (Champions League, Europa League,
// World Cup qualifiers, Nations League...) go EVEN BEFORE the top domestic
// leagues — checked first in the priority comparator below.
const TOP_PRIORITY_COUNTRIES = new Set(['international', 'uefa', 'world', 'europe']);
const FULL_DETAIL = (process.env.LONDON365_FULL || '1') === '1';
const LIVE_INTERVAL_MS = Math.max(10000, Number(process.env.LONDON365_LIVE_INTERVAL_MS || 30000));
const IMPORT_THROTTLE_MS = Number(process.env.LONDON365_IMPORT_THROTTLE_MS || 600000);
const DETAIL_DELAY_MS = Math.max(0, Number(process.env.LONDON365_DETAIL_DELAY_MS || 150));
// How many games' detail fetches run in flight at once (each still paced by
// its own DETAIL_DELAY_MS). Default 4 — a meaningful speedup over strictly
// sequential without meaningfully raising per-provider request rate (this
// host has been redeployed often enough that a fully sequential pass rarely
// finished even the priority countries before being interrupted).
const DETAIL_CONCURRENCY = Math.max(1, Number(process.env.LONDON365_DETAIL_CONCURRENCY || 4));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Origin: SITE_ORIGIN,
  Referer: SITE_ORIGIN + '/',
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

export function isLondon365Enabled() {
  return ENABLED;
}

// HTTP with gentle retry; the API intermittently answers "Something went wrong".
async function api(pathname, opts) {
  opts = opts || {};
  const retries = opts.retries || 3;
  let lastErr = null;
  for (let attempt = 1; attempt !== retries + 1; attempt++) {
    try {
      const resp = await fetch(API_BASE + pathname, {
        method: opts.method || 'GET',
        headers: HEADERS,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      const text = await resp.text();
      if (resp.ok === false) throw new Error('HTTP ' + resp.status);
      if (text.trim().toLowerCase().indexOf('something went wrong') === 0) throw new Error('API transient error');
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
      if (attempt !== retries) await new Promise(function (r) { setTimeout(r, 500 * attempt); });
    }
  }
  throw new Error('london365 api ' + pathname + ' failed: ' + (lastErr ? lastErr.message : 'unknown'));
}

// Packed odds string on list responses (livegames omit the market name):
// coefId | coef | option | marketId | MarketName , ...
export function parseOddString(s) {
  if (!s) return [];
  return String(s).split(',').map(function (part) {
    const f = part.split('|');
    const coefId = f[0];
    const coef = parseFloat(f[1]);
    if (!coefId || Number.isNaN(coef)) return null;
    return {
      coefId: coefId.trim(),
      coef: coef,
      option: (f[2] || '').trim(),
      marketId: (f[3] || '').trim(),
      marketName: (f[4] || '').trim() || null,
    };
  }).filter(Boolean);
}

function slug(s) {
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
function slugDash(s) {
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
const COUNTRY_NAMES_BY_LENGTH_DESC = [
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
const COUNTRY_NAME_TO_TOKEN = {
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
const LEAGUE_COUNTRY_HINTS = [
  // Brazilian state championships — contain "serie a"/"serie b" just like
  // Italy's, so this MUST be checked before the generic Italy pattern.
  [/brasileiro|brasileirao|amazonense|gaucho|carioca|paulista|catarinense|mineiro|baiano|pernambucano|cearense|potiguar|goiano|alagoano|capixaba|sergipano|paraense|matogrossense|brasilia|copa do brasil/, 'brazil'],
  [/champions league|europa league|conference league|uefa|super cup/, 'uefa'],
  [/world cup|fifa|nations league/, 'fifa'],
  [/copa america|conmebol|libertadores|sudamericana/, 'conmebol'],
  [/afc|asian cup|asean/, 'afc'],
  [/premier league|championship|league one|league two|fa cup|efl/, 'england'],
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
function leagueCountryToken(name) {
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

// --- Real country identification (country.id / league.country_id) --------
// The provider exposes an authoritative id-based mapping:
//   GET /ajax/countries/{sportId}  -> [{ id, name, sport_id, ... }, ...]
//   GET /ajax/leagues/{sportId}    -> [{ id, name, country_id, ... }, ...]
// league.country_id links directly to country.id. This is the PRIMARY
// source of truth for a league's country — leagueCountryToken() above
// (name/regex guessing) is kept ONLY as a last-resort fallback for the rare
// league whose country_id we can't resolve (missing from the countries
// list, or the provider omitted the field), never as the primary path.
const COUNTRY_MAP_CACHE_MS = 6 * 60 * 60 * 1000; // matches the provider catalog's own refresh cadence
const countryMapCache = new Map(); // sportId -> { fetchedAt, countryMap }
// provider league id (string) -> { key, name, countryId, countryName } —
// lets live/socket payloads that carry a league_id resolve the SAME
// country-accurate key the import pass computed, instead of falling back
// to a raw league name string.
const leagueById = new Map();
// Reverse index for the live/socket fallback path: normalized league text
// (with or without a leading country name — see registerLeagueName) -> the
// same {key, name, countryId, countryName} entry as leagueById. Needed
// because the live feed and the prematch list endpoint don't always agree
// on league naming for the exact same competition — the live feed's
// g.league has been observed as "England Premier League" while the
// prematch import (which has the real league_id) knows it as plain
// "Premier League". Without this, those two strings produced two different
// keys (l365_england__england_premier_league vs l365_england__premier_league)
// — same league, split into two sidebar entries, one of them always empty.
const leagueNameIndex = new Map();
function normalizeLeagueText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function registerLeagueName(entry) {
  const plain = normalizeLeagueText(entry.name);
  if (plain) leagueNameIndex.set(plain, entry);
  if (entry.countryName) {
    const withCountry = normalizeLeagueText(entry.countryName + ' ' + entry.name);
    if (withCountry) leagueNameIndex.set(withCountry, entry);
  }
}
// Looks up a raw league string (as the live feed sends it) against every
// league name/alias seen during the last full import — before falling back
// to pure name-guessing (leagueCountryToken). Exact-normalized match only
// (no fuzzy matching): safe, since a miss just falls through to the
// existing fallback behavior rather than risking a wrong merge.
function resolveLeagueByName(rawName) {
  return leagueNameIndex.get(normalizeLeagueText(rawName)) || null;
}
let leagueByIdLoaded = false;
// Loads the persisted leagueById map (saved at the end of every completed
// import — see importLondon365) so it's populated immediately on boot,
// before the live loop's first event ever needs it, instead of starting
// empty and only filling in as the slow full-import loop happens to reach
// each league again.
export async function loadPersistedLeagueMap() {
  if (leagueByIdLoaded) return;
  leagueByIdLoaded = true;
  try {
    const saved = await getKV('l365_league_map', {});
    for (const [id, entry] of Object.entries(saved || {})) { leagueById.set(id, entry); registerLeagueName(entry); }
    if (leagueById.size) console.log('[london365] restored ' + leagueById.size + ' league->country mappings from a previous import');
  } catch (err) {
    console.error('[london365] failed loading persisted league map:', err.message);
  }
}

// Key -> the league name EXACTLY as the provider's API returned it
// (league.name, untouched — no slugging, no re-titlecasing, no prefix
// stripping). The frontend uses this verbatim wherever a name is available
// instead of re-deriving a display label from the slugified key, which is
// lossy (e.g. "LaLiga" -> slug "laliga" -> re-titlecased "Laliga").
export function getLondon365LeagueNames() {
  const names = {};
  for (const entry of leagueById.values()) {
    if (entry && entry.key && entry.name) names[entry.key] = entry.name;
  }
  return names;
}

// Confirmed directly against the live provider — the FULL /ajax/countries/1
// response, pasted verbatim by the site owner (not partial, not guessed).
// Used as a hard override on top of whatever /ajax/countries/{sportId}
// returns, so classification for these countries is always by id, never by
// name-guessing a league's own name (which is what caused the Spain
// pollution bug: id 85 alone is clean, so any wrong-country leagues were a
// classification bug on our side, not a provider data issue).
const CONFIRMED_COUNTRY_IDS = {
  64: 'England', 57: 'Italy', 85: 'Spain', 34: 'Germany', 32: 'France',
  // country_id 13 and 19 are both continental/international competition
  // buckets (UEFA Champions/Europa/Conference League, Nations League, Copa
  // Libertadores/Sudamericana, CONCACAF, AFC) — not a single country, so
  // both fold into the same "International" token.
  13: 'International', 19: 'International',
  73: 'Belgium', 55: 'Norway', 95: 'Denmark', 42: 'Sweden', 45: 'Iceland',
  35: 'Mexico', 1: 'Brazil', 53: 'Croatia', 65: 'Austria', 70: 'Czech Republic',
  41: 'Finland', 56: 'Peru', 22: 'Russia', 111: 'Scotland', 84: 'Slovakia',
  89: 'Slovenia', 102: 'Switzerland', 21: 'USA', 91: 'Australia', 44: 'Netherlands',
  93: 'Portugal', 246: 'Singapore', 81: 'Turkey', 63: 'Poland', 259: 'Argentina',
  23: 'Chile', 24: 'Ireland', 50: 'Japan', 2: 'Uruguay', 39: 'Israel',
  97: 'Greece', 54: 'Romania', 31: 'Bulgaria', 163: 'Malaysia', 110: 'Ukraine',
  100: 'Belarus', 68: 'Estonia', 76: 'Austria Amateur', 130: 'Cyprus', 103: 'Germany Amateur',
  241: 'Northern Ireland', 156: 'Wales', 121: 'Serbia', 139: 'Bosnia & Herzegovina', 122: 'Lithuania',
  129: 'Latvia', 25: 'Ecuador', 141: 'Faroe Islands', 66: 'England Amateur', 118: 'Georgia',
  92: 'Colombia', 114: 'Kazakhstan', 36: 'Paraguay', 46: 'Costa Rica', 62: 'Republic of Korea',
  105: 'Armenia', 227: 'United Arab Emirates', 279: 'Algeria', 40: 'Egypt', 245: 'Saudi Arabia',
  115: 'South Africa', 37: 'Qatar', 51: 'Guatemala', 235: 'El Salvador', 341: 'Indonesia',
  281: 'Bolivia', 151: 'Montenegro', 149: 'San Marino', 80: 'Canada', 28: 'International Youth',
  394: 'Iraq', 29: 'Tanzania', 286: 'Uganda',
};

async function getCountryMap(sportId) {
  const cached = countryMapCache.get(sportId);
  if (cached && Date.now() - cached.fetchedAt < COUNTRY_MAP_CACHE_MS) return cached.countryMap;

  const countries = await api('/ajax/countries/' + sportId);
  const countryMap = new Map(
    (Array.isArray(countries) ? countries : []).map((c) => [String(c.id), c.name])
  );
  if (String(sportId) === '1') {
    for (const [id, name] of Object.entries(CONFIRMED_COUNTRY_IDS)) countryMap.set(String(id), name);
  }
  console.log('[london365] loaded ' + countryMap.size + ' countries for sport ' + sportId);
  countryMapCache.set(sportId, { fetchedAt: Date.now(), countryMap: countryMap });
  return countryMap;
}

// Preferred key builder: resolves the country from the provider's REAL
// country name (via country.id <- league.country_id), falling back to the
// name-heuristic above only when that real name isn't available.
export function leagueKeyFromCountry(countryName, leagueName) {
  const token = countryName ? (slugDash(countryName) || 'other') : leagueCountryToken(leagueName);
  return 'l365_' + token + '__' + (slug(leagueName) || 'league');
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

// Decode the HTML entities the provider embeds in market names. Built with
// String.fromCharCode so no raw ampersand appears in this source file.
export function decodeMarketName(s) {
  const amp = String.fromCharCode(38);
  return String(s || '')
    .split(amp + 'amp;').join(amp)
    .split(amp + 'quot;').join(String.fromCharCode(34))
    .split(amp + '#039;').join(String.fromCharCode(39))
    .split(amp + '#39;').join(String.fromCharCode(39));
}

// Canonical keys are reserved ONLY for the exact match-level main markets
// whose settlement and Albanian translation logic we understand. Every other
// provider market gets its OWN unique key (name + provider marketId) so all
// ~100 markets and 900+ coefficients survive to the frontend instead of being
// collapsed by a loose keyword match and then deduplicated away — the old
// rules merged e.g. "Rezultati Pjeses se Pare", "Booking 1x2" and the final
// 1X2 into one h2h bucket, silently dropping most of their coefficients.
const CANONICAL_MARKETS = {
  'rezultat final': 'h2h',
  'rezultati final': 'h2h',
  '1x2': 'h2h',
  'dopio shans': 'double_chance',
  'double chance': 'double_chance',
  'totali i golave': 'totals',
  'gol/jogol': 'btts',
  'gol-jogol': 'btts',
  'handikap': 'spreads',
  'home no bet': 'draw_no_bet',
  'away no bet': 'draw_no_bet',
};

// The set of canonical keys, used by buildEvent to detect when two DIFFERENT
// provider market ids claim the same canonical name — the second one is then
// given its own unique key instead of being merged (and deduplicated) away.
export const CANONICAL_KEYS = new Set(Object.values(CANONICAL_MARKETS));

export function mapMarketKey(name, marketId) {
  const n = decodeMarketName(name).toLowerCase().trim();
  if (CANONICAL_MARKETS[n]) return CANONICAL_MARKETS[n];
  if (!n) return 'other';
  return slug(n) + (marketId ? '_m' + marketId : '');
}

// A cached event is "sparse" when its detail fetch failed and we only have
// the few list-level markets (or unnamed "Market <id>" fallbacks). These are
// the rows the repair pass re-fetches with full detail so every market and
// coefficient finally reaches the frontend.
export function isSparseEvent(ev) {
  const markets = (ev && ev.bookmakers && ev.bookmakers[0] && ev.bookmakers[0].markets) || [];
  if (!markets.length) return true;
  let outcomes = 0;
  for (const m of markets) {
    outcomes += (m.outcomes || []).length;
    if (!m.label || /^Market \d+$/.test(m.label)) return true;
  }
  return outcomes < 10;
}

// Fetch every market of one game from the detail endpoint. Shared by the
// main import and the repair pass. Extra retries because the provider
// intermittently answers "Something went wrong" under load — a failed
// detail fetch is exactly what silently drops ~90 markets per match.
export async function fetchDetailRows(gameId) {
  const detail = await api('/ajax/prematchgame/' + gameId, { retries: 5 });
  const rows = [];
  if (Array.isArray(detail)) {
    for (const market of detail) {
      if (!Array.isArray(market)) continue;
      for (const m of market) {
        rememberMarketName(m.market_id, m.market);
        rows.push({
          coefId: String(m.id),
          coef: parseFloat(m.odd),
          option: (m.market_option || '').trim(),
          marketId: String(m.market_id),
          marketName: m.market || null,
          category: m.mainCategory ? decodeMarketName(m.mainCategory) : null,
        });
      }
    }
  }
  return rows;
}

// Live games expose their full market catalog on a different endpoint:
// /ajax/livegame/{id} returns every market (with real names, live prices,
// current minute and score) for an in-play game — /ajax/prematchgame/{id}
// returns zero rows once a game kicks off. Same row shape as
// fetchDetailRows so buildEvent, the repair pass and the live loop share it.
export async function fetchLiveRows(gameId) {
  const detail = await api('/ajax/livegame/' + gameId, { retries: 4 });
  const rows = [];
  const groups = Array.isArray(detail) ? detail : [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const m of group) {
      if (!m) continue;
      rememberMarketName(m.market_id, m.market);
      rows.push({
        coefId: String(m.id),
        coef: parseFloat(m.odd),
        option: (m.market_option || '').trim(),
        marketId: String(m.market_id),
        marketName: m.market || null,
        category: m.mainCategory ? decodeMarketName(m.mainCategory) : null,
      });
    }
  }
  return rows;
}

function totalsOutcome(option) {
  const m = String(option || '').trim().match(/^(mbi|over|nen|under)\s*([0-9.]+)/i);
  if (!m) return null;
  const side = /^(mbi|over)$/i.test(m[1]) ? 'Over' : 'Under';
  const point = parseFloat(m[2]);
  if (Number.isNaN(point)) return null;
  return { name: side, point: point };
}

function outcomeFromOption(marketKey, option, ev) {
  const o = String(option || '').trim();
  if (marketKey === 'h2h') {
    if (o === '1') return { name: ev.home_team };
    if (o === 'X') return { name: 'Draw' };
    if (o === '2') return { name: ev.away_team };
    return { name: o };
  }
  if (marketKey === 'totals') {
    const t = totalsOutcome(o);
    if (t) return t;
    return { name: o };
  }
  if (marketKey === 'spreads') {
    const t = totalsOutcome(o);
    if (t) return { name: ev.home_team, point: t.point };
    return { name: o };
  }
  return { name: o };
}

// Build a canonical event object (The Odds API shape) from parsed odds rows.
export function buildEvent(gameId, homeTeam, awayTeam, commenceTime, rows) {
  const ev = {
    id: 'l365-' + gameId,
    home_team: homeTeam,
    away_team: awayTeam,
    commence_time: commenceTime,
    completed: false,
    bookmakers: [{ title: 'LondonPro365', markets: [] }],
  };
  const byKey = new Map();
  const canonicalOwner = new Map(); // canonical key -> marketId of first claim
  for (const r of rows) {
    const marketName = decodeMarketName(r.marketName || r.market || ('Market ' + r.marketId));
    let key = mapMarketKey(marketName, r.marketId);
    if (CANONICAL_KEYS.has(key)) {
      const owner = canonicalOwner.get(key);
      if (owner === undefined) canonicalOwner.set(key, r.marketId);
      else if (owner !== String(r.marketId)) key = slug(marketName) + '_m' + r.marketId;
    }
    // The card must show ONLY 1/X/2. Some provider markets named like the
    // final result also carry correct-score / HTFT options; those get their
    // own bucket instead of polluting h2h (no coefficient is lost).
    if (key === 'h2h') {
      const opt = String(r.option || '').trim();
      if (opt !== '1' && opt !== 'X' && opt !== '2') key = slug(marketName) + '_m' + r.marketId;
    }
    if (!byKey.has(key)) byKey.set(key, { key: key, label: marketName, category: r.category || null, outcomes: [] });
    const opt = outcomeFromOption(key, r.option, ev);
    byKey.get(key).outcomes.push({ name: opt.name, price: r.coef, point: opt.point, id: r.coefId });
  }
  ev.bookmakers[0].markets = Array.from(byKey.values()).map(function (m) {
    return { key: m.key, label: m.label, category: m.category, outcomes: m.outcomes };
  });
  return ev;
}

// Returns null (never a fabricated "now") when the provider's date fields
// are missing or unparseable, so a caller can SKIP the game instead of
// silently mislabeling it. Defaulting to "now" here used to make
// statusFromCommence() classify every one of these as LIVE — a match with
// no real kickoff time would vanish from "Upcoming" and inflate the LIVE
// count instead of being surfaced as the data problem it actually is.
export function isoFromWholeDate(wholeDate, gameDate, gameTime) {
  const src = wholeDate || ((gameDate || '') + ' ' + (gameTime || ''));
  let iso = String(src).trim().replace(' ', 'T');
  // Treat naive provider timestamps as UTC so kickoff times are deterministic
  // regardless of the server's local timezone.
  if (iso && !/[zZ]$/.test(iso) && !/[+-]\d{2}:\d{2}$/.test(iso)) {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) iso += ':00';
    iso += 'Z';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function parseScore(result) {
  const m = String(result || '').match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  return { home: parseInt(m[1], 10), away: parseInt(m[2], 10) };
}

// UPCOMING when kickoff is in the future, LIVE otherwise. Math.sign keeps a
// literal greater-than glyph out of the source.
export function statusFromCommence(commenceTime) {
  return Math.sign(Date.parse(commenceTime) - Date.now()) === 1 ? 'UPCOMING' : 'LIVE';
}

// Persist one canonical event, recording odds movement into odds_history and
// pushing live updates over the existing WebSocket channel.
// Convert a provider minute like "48:37" or "72" into a match minute number.
export function minuteToNumber(minute) {
  if (!minute) return null;
  const m = String(minute).match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

async function upsertMatch(ev, league, status, liveScores, liveInfo) {
  return withDbLock(async () => {
    const now = Date.now();
    const { rows } = await pool.query(
      'SELECT raw_json, status, live_home_score, live_away_score, live_minute FROM matches_cache WHERE id = $1',
      [ev.id]
    );
    const existing = rows[0];

    let rawToStore = JSON.stringify(ev);
    if (existing) {
      try {
        const oldEv = JSON.parse(existing.raw_json);
        const oldCount = countOutcomes(oldEv);
        const newCount = countOutcomes(ev);
        // Live/socket payloads only carry the main markets. Instead of
        // discarding them (old behavior) or letting them clobber the full
        // catalog, merge them into the cached event: prices update for the
        // markets they carry, every other market and coefficient survives.
        let effective = ev;
        if (oldCount && Math.sign(newCount - oldCount) === -1) effective = mergeEvents(oldEv, ev);
        rawToStore = JSON.stringify(effective);
        const changes = diffOddsChanges(ev.id, oldEv, effective);
        for (const c of changes) {
          await pool.query(
            `INSERT INTO odds_history (match_id, market_id, selection_id, old_odds, new_odds, changed_by, reason, created_at)
             VALUES ($1,$2,$3,$4,$5,'SYSTEM','london365_refresh',$6)`,
            [c.matchId, c.marketId, c.selectionId, c.oldOdds, c.newOdds, now]
          );
        }
        if (changes.length) pushOddsChanged(ev.id, { changes: changes });
      } catch (err) {
        console.error('[london365] odds diff failed for ' + ev.id + ':', err.message);
      }
    }

    await pool.query(
      `INSERT INTO matches_cache (id, league, home_team, away_team, start_time, status, raw_json, fetched_at, live_home_score, live_away_score, live_minute, live_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET
         league = CASE WHEN excluded.league = '' THEN matches_cache.league ELSE excluded.league END,
         home_team = excluded.home_team,
         away_team = excluded.away_team,
         start_time = excluded.start_time,
         status = CASE WHEN matches_cache.status = 'FINISHED' THEN matches_cache.status ELSE excluded.status END,
         raw_json = excluded.raw_json,
         fetched_at = excluded.fetched_at,
         live_home_score = COALESCE(excluded.live_home_score, matches_cache.live_home_score),
         live_away_score = COALESCE(excluded.live_away_score, matches_cache.live_away_score),
         live_minute = COALESCE(excluded.live_minute, matches_cache.live_minute),
         live_status = COALESCE(excluded.live_status, matches_cache.live_status)`,
      [
        ev.id, league, ev.home_team, ev.away_team, ev.commence_time, status,
        rawToStore, now,
        liveScores ? liveScores.home : null,
        liveScores ? liveScores.away : null,
        liveInfo && liveInfo.minute ? liveInfo.minute : null,
        liveInfo && liveInfo.apiStatus != null ? String(liveInfo.apiStatus) : null,
      ]
    );
    return existing;
  });
}

// Count every outcome across a canonical event, used to detect an
// incomplete provider response before it can overwrite richer cached odds.
function countOutcomes(ev) {
  let n = 0;
  const bookmakers = (ev && ev.bookmakers) || [];
  for (const bm of bookmakers) {
    const markets = bm.markets || [];
    for (const mk of markets) n += (mk.outcomes || []).length;
  }
  return n;
}

// Merge a (usually partial) live event into the richer cached event:
// outcomes are matched by provider coefId, prices updated, unknown markets
// appended, everything else left untouched.
function mergeEvents(oldEv, newEv) {
  const merged = JSON.parse(JSON.stringify(oldEv));
  const markets = (merged.bookmakers && merged.bookmakers[0] && merged.bookmakers[0].markets) || [];
  const byKey = new Map(markets.map(function (m) { return [m.key, m]; }));
  const newMarkets = (newEv.bookmakers && newEv.bookmakers[0] && newEv.bookmakers[0].markets) || [];
  for (const nm of newMarkets) {
    const old = byKey.get(nm.key);
    if (!old) { markets.push(nm); byKey.set(nm.key, nm); continue; }
    // Match by provider coefId first; the provider can issue a fresh coefId
    // for the same outcome between prematch and live, so also fall back to
    // the outcome identity (name + point) to avoid duplicate rows.
    const byId = new Map((old.outcomes || []).map(function (o) { return [String(o.id), o]; }));
    const byIdentity = new Map((old.outcomes || []).map(function (o) { return [String(o.name) + '|' + (o.point != null ? o.point : ''), o]; }));
    for (const no of nm.outcomes || []) {
      const identity = String(no.name) + '|' + (no.point != null ? no.point : '');
      const ex = byId.get(String(no.id)) || byIdentity.get(identity);
      if (ex) {
        ex.price = no.price;
        if (no.point !== undefined) ex.point = no.point;
        ex.id = no.id;
      } else {
        (old.outcomes = old.outcomes || []).push(no);
        byId.set(String(no.id), no);
        byIdentity.set(identity, no);
      }
    }
  }
  return merged;
}

// The livegames/socket packed odd strings omit the market NAME (only the
// marketId is present). Learn names from the detail responses so a live row
// for market 1 maps to the same canonical 'h2h' key as the full import
// instead of creating a duplicate 'market_1' bucket.
let marketNamesLoaded = false;
const marketNameById = new Map();

async function ensureMarketNamesLoaded() {
  if (marketNamesLoaded) return;
  marketNamesLoaded = true;
  try {
    const saved = await getKV('l365_market_names', {});
    for (const entry of Object.entries(saved || {})) marketNameById.set(entry[0], entry[1]);
  } catch (err) { /* KV not ready yet; names get learned during imports */ }
}

function rememberMarketName(marketId, name) {
  const key = String(marketId || '');
  if (key && name && !marketNameById.has(key)) marketNameById.set(key, decodeMarketName(name));
}

function hydrateRowNames(rows) {
  for (const r of rows) {
    if (!r.marketName && r.marketId) r.marketName = marketNameById.get(String(r.marketId)) || null;
  }
  return rows;
}

// Serialize DB writes across the full import, the live polling loop, and the
// Socket.IO feed so a slow import never interleaves partial odds with a
// live patch for the same match.
let dbWriteLock = Promise.resolve();
function withDbLock(fn) {
  const run = dbWriteLock.then(fn, fn);
  dbWriteLock = run.then(function () {}, function () {});
  return run;
}

// Record a goal exactly once: only when the score actually moved compared to
// what we last persisted (or when a first non-zero score appears). Repeated
// polls and socket ticks for the same score are no-ops.
async function recordGoalIfChanged(ev, score, minute, prev) {
  if (!score) return;
  const prevHome = prev ? prev.live_home_score : null;
  const prevAway = prev ? prev.live_away_score : null;
  const hadScoreBefore = prevHome != null && prevAway != null;
  const scoreChanged = hadScoreBefore
    ? (score.home !== prevHome || score.away !== prevAway)
    : Math.sign(score.home + score.away) === 1;
  if (!scoreChanged) return;
  const scoringTeam = hadScoreBefore && Math.sign(score.home - prevHome) === 1 ? ev.home_team : ev.away_team;
  const now = Date.now();
  await pool.query(
    `INSERT INTO match_events (match_id, minute, type, team, detail, created_at)
     VALUES ($1,$2,'GOAL',$3,$4,$5)`,
    [ev.id, minuteToNumber(minute), scoringTeam, score.home + '-' + score.away, now]
  );
  await pool.query(
    `INSERT INTO live_statistics (match_id, home_score, away_score, updated_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (match_id) DO UPDATE SET home_score = excluded.home_score, away_score = excluded.away_score, updated_at = excluded.updated_at`,
    [ev.id, score.home, score.away, now]
  );
  pushGoal(ev.id, { homeScore: score.home, awayScore: score.away, scoringTeam: scoringTeam, minute: minute || undefined });
}

let importRunning = false;
let socketConnected = false;

export function setLondon365SocketConnected(value) {
  socketConnected = !!value;
}

// Full import: every sport, then every league, then every match, every market.
export async function importLondon365(opts) {
  opts = opts || {};
  if (!ENABLED) throw new Error('LondonPro365 provider is disabled (LONDON365_ENABLED=0)');
  if (importRunning) return { skipped: true, reason: 'import already running' };
  importRunning = true;

  await ensureMarketNamesLoaded();
  const sports = opts.sports || (await resolveSports());
  const full = opts.full === undefined ? FULL_DETAIL : !!opts.full;
  const leagueCap = opts.leagues === undefined ? LEAGUE_LIMIT : Number(opts.leagues) || 0;
  const matchCap = Number(opts.matches) || 0;

  const leaguesSeen = new Set(await getKV('l365_leagues', []));
  let matchCount = 0;
  let coefficientCount = 0;
  let detailOkCount = 0;
  let detailFailCount = 0;
  let skippedDateCount = 0;
  let skippedNoOddsCount = 0;
  // Every league seen this run, with how many of its games actually made it
  // into matches_cache vs got skipped for a bad date — so "England only
  // shows 3 leagues" or "Premier League has 0 matches" can be confirmed or
  // ruled out directly from this one log line instead of guessed at.
  const leagueSummary = new Map(); // countryName -> [{ name, id, imported, skipped }]

  try {
    // Soccer (sport id 1) first, always — it's where every priority country
    // config lives and what people actually check first. Same interruption
    // concern as the league-level sort below, one level up.
    const sportsOrdered = sports.slice().sort((a, b) => (Number(a) === 1 ? 0 : 1) - (Number(b) === 1 ? 0 : 1));
    for (const sid of sportsOrdered) {
      // Real country.id -> country.name map for this sport (cached — see
      // getCountryMap). A failure here never aborts the import: it just
      // means every league in this sport falls back to the name heuristic
      // below, same as before this change.
      let countryMap = new Map();
      try {
        countryMap = await getCountryMap(sid);
      } catch (err) {
        console.error('[london365] countries sport ' + sid + ' failed (falling back to name-based country guessing):', err.message);
      }

      // CONFIRMED against the live provider (real request/response pairs,
      // not guessed): /ajax/leagues/{X} is keyed by COUNTRY id, not sport
      // id — every league object it returns shares the SAME country_id as
      // whatever id you passed in (e.g. /ajax/leagues/64 -> only England's
      // leagues, every one with country_id: "64"). There is no single
      // "all leagues for this sport" endpoint. The previous code called
      // /ajax/leagues/{sportId} once (e.g. /ajax/leagues/1) expecting every
      // country's leagues back — that request is really just "leagues of
      // country #1" (whatever the provider's country id 1 actually is),
      // which is exactly why the import only ever saw ~14 leagues total and
      // England/France/Spain/Italy/Germany (real country ids like 64) never
      // appeared. The correct path is sport -> countries -> leagues(per
      // country) -> games, so we now fetch /ajax/leagues/{countryId} once
      // per country instead.
      //
      // Countries are visited priority-first (same rationale the old
      // pre-cap sort used) so a redeploy/crash/throttle mid-import still
      // lands England/Spain/Italy/Germany/France before anything else, and
      // EXCLUDED_COUNTRIES/ONLY_COUNTRIES are applied here — before any
      // network call — so an unwanted country never even costs a request.
      const countryEntries = Array.from(countryMap.entries()) // [countryId, countryName][]
        .filter(([, name]) => !EXCLUDED_COUNTRIES.has(String(name).toLowerCase()))
        .filter(([, name]) => !ONLY_COUNTRIES.size || ONLY_COUNTRIES.has(String(name).toLowerCase()))
        .sort((a, b) => {
          const rank = (name) => {
            const n = String(name).toLowerCase();
            if (TOP_PRIORITY_COUNTRIES.has(n)) return 0; // International/UEFA/World first, always
            if (SORT_PRIORITY_COUNTRIES.has(n)) return 1; // then England/Spain/Italy/Germany/France/...
            return 2; // everyone else
          };
          return rank(a[1]) - rank(b[1]);
        });

      // RESUME CURSOR — a redeploy/env-var-change/crash mid-import used to
      // always restart processing from index 0 of the (priority-sorted)
      // list, i.e. it NEVER got past England if anything interrupted it
      // before finishing. We now persist which country we finished last and
      // rotate the list to continue from there, so repeated interruptions
      // make forward progress across the whole catalog instead of hammering
      // the same first few countries forever. Once a full pass completes,
      // the cursor resets to the top so priority countries get refreshed
      // regularly on a healthy/uninterrupted run.
      const cursorCountry = await getKV('l365_country_cursor', null);
      let orderedCountryEntries = countryEntries;
      if (cursorCountry) {
        const idx = countryEntries.findIndex(([, name]) => name === cursorCountry);
        if (idx > 0) orderedCountryEntries = [...countryEntries.slice(idx), ...countryEntries.slice(0, idx)];
      }

      let leagues = [];
      for (const [countryId, countryName] of orderedCountryEntries) {
        let countryLeagues;
        try {
          countryLeagues = await api('/ajax/leagues/' + countryId);
        } catch (err) {
          console.error('[london365] leagues for country ' + countryName + ' (id=' + countryId + ') failed:', err.message);
          continue;
        }
        if (Array.isArray(countryLeagues)) leagues.push(...countryLeagues);
        await setKV('l365_country_cursor', countryName);
      }
      // Full pass completed with nothing left to interrupt it — reset the
      // cursor so the next run starts from the top (International/England)
      // again instead of resuming mid-list forever.
      if (leagueCap) leagues = leagues.slice(0, leagueCap);

      // RESUME CURSOR (correct spot this time) — the SLOW part of the
      // import is THIS loop (one HTTP request per league for games, then
      // one more per game for full market detail), not the league-list
      // collection above (which is fast, just metadata, and normally
      // finishes even on an interrupted run). A redeploy/crash/env-var
      // change used to always restart THIS loop from leagues[0] — which,
      // since leagues[] is built in country-priority order, meant it kept
      // re-doing International/England's leagues and never reliably got
      // through Spain/Italy/Germany/France on a host that redeploys often.
      // Persist the last successfully-processed league id and rotate the
      // array to continue right after it; once a full lap completes with
      // nothing left to interrupt it, the cursor clears so priority
      // leagues resume getting refreshed first on healthy runs.
      const leagueCursor = await getKV('l365_league_cursor', null);
      if (leagueCursor) {
        const idx = leagues.findIndex((l) => String(l.id) === String(leagueCursor));
        if (idx >= 0 && idx + 1 < leagues.length) leagues = [...leagues.slice(idx + 1), ...leagues.slice(0, idx + 1)];
      }

      for (const league of leagues) {
        await setKV('l365_league_cursor', league.id);
        // Resolve country BEFORE the games fetch — otherwise a league with
        // zero current games (very normal, most leagues are between
        // matchdays most of the time) or a failed games fetch skipped
        // silently, leaving zero trace in the logs. This was invisible for
        // exactly the leagues people check most (Premier League, La Liga)
        // whenever the provider had nothing/failed for them at that moment.
        const countryId = league.country_id != null ? String(league.country_id) : null;
        const countryName = countryId ? countryMap.get(countryId) : null;
        if (countryId && !countryName) {
          console.warn('[london365] WARNING: unknown country_id=' + countryId + ' for league=' + league.name + ' (id=' + league.id + ')');
        }
        const isPriority = countryName && PRIORITY_COUNTRIES.has(countryName.toLowerCase());
        if (countryName && EXCLUDED_COUNTRIES.has(countryName.toLowerCase())) continue;
        if (ONLY_COUNTRIES.size && !(countryName && ONLY_COUNTRIES.has(countryName.toLowerCase()))) continue;
        if (isMinorLeague(league.name, countryName)) continue;

        let games;
        try {
          games = await api('/ajax/gamesByLeague/' + league.id);
        } catch (err) {
          console.error('[london365] games for ' + league.name + ' (' + (countryName || '?') + ') failed:', err.message);
          continue;
        }
        if (!Array.isArray(games) || games.length === 0) {
          // Only log the empty case for priority countries — for everyone
          // else this is routine (most leagues have nothing on a given day)
          // and would just flood the log.
          if (isPriority) console.log('[london365] ' + league.name + ' (' + countryName + '): provider returned 0 games right now');
          continue;
        }
        if (matchCap) games = games.slice(0, matchCap);

        // Ground-truth cross-check: every game from /ajax/gamesByLeague
        // carries its own `country`/`country_id` fields directly, no join
        // needed — self-verified against the live provider. If the
        // countries-endpoint lookup above came up empty (unknown/missing
        // country_id, or the countries call itself failed for this sport),
        // this recovers the correct country from the games response itself
        // instead of falling all the way back to the name-guessing
        // heuristic. Doesn't override a countryName we already trust.
        const effectiveCountryName = countryName || (games[0] && games[0].country) || null;
        if (!countryName && effectiveCountryName) {
          console.log('[london365] recovered country="' + effectiveCountryName + '" for league=' + league.name + ' from game payload (countries lookup missed it)');
        }

        const leagueKeyResolved = leagueKeyFromCountry(effectiveCountryName, league.name);
        console.log(
          '[london365] league ' + league.id + ' -> ' + league.name + ' -> ' +
          (effectiveCountryName || '(fallback: ' + leagueCountryToken(league.name) + ')')
        );
        leagueById.set(String(league.id), {
          key: leagueKeyResolved,
          name: league.name,
          countryId: countryId,
          countryName: effectiveCountryName || null,
        });
        registerLeagueName(leagueById.get(String(league.id)));
        const summaryKey = effectiveCountryName || '(fallback: ' + leagueCountryToken(league.name) + ')';
        const summaryEntry = { name: league.name, id: String(league.id), imported: 0, skipped: 0, providerGames: games.length };
        if (!leagueSummary.has(summaryKey)) leagueSummary.set(summaryKey, []);
        leagueSummary.get(summaryKey).push(summaryEntry);

        // Full per-game detail (every market) is the expensive part — one
        // extra HTTP request + a fixed delay per game. When priority
        // countries are configured, everyone else skips straight to the
        // list-level odds (still real matches, still 1X2 + main markets,
        // just not the full catalog) so the priority leagues can run with
        // no league/sport cap without exhausting memory or request budget.
        const fetchFullDetail = full && wantsFullDetailFor(countryName);

        // Bounded concurrency instead of one game at a time: this host gets
        // redeployed often enough (by design — frequent small fixes) that a
        // purely sequential detail-fetch loop rarely got a chance to finish
        // even the priority countries before being interrupted, restarting
        // the whole pass. Processing DETAIL_CONCURRENCY games at once cuts
        // wall-clock time roughly by that factor while each individual
        // request still gets its own DETAIL_DELAY_MS pacing — so per-request
        // load on the provider is unchanged, only the number of requests
        // in flight at once goes up a little.
        const concurrency = fetchFullDetail ? DETAIL_CONCURRENCY : games.length || 1;
        for (let i = 0; i < games.length; i += concurrency) {
          const batch = games.slice(i, i + concurrency);
          await Promise.all(batch.map(async (game) => {
            let rows = [];
            if (fetchFullDetail) {
              try {
                if (DETAIL_DELAY_MS) await sleep(DETAIL_DELAY_MS);
                rows = await fetchDetailRows(game.id);
                detailOkCount++;
              } catch (err) {
                detailFailCount++;
                console.error('[london365] detail ' + game.id + ' failed (falling back to sparse list odds):', err.message);
              }
            }
            if (!rows.length) rows = parseOddString(game.odd);
            rows = hydrateRowNames(rows.filter(function (r) { return r ? !Number.isNaN(r.coef) : false; }));
            if (!rows.length) {
              skippedNoOddsCount++;
              summaryEntry.skipped++;
              console.warn(
                '[london365] skipping game ' + game.id + ' (' + league.name + '): zero usable odds rows — ' +
                'fetchFullDetail=' + fetchFullDetail + ', raw odd field: ' + JSON.stringify(game.odd)
              );
              return;
            }

            const commenceTime = isoFromWholeDate(game.whole_date, game.game_date, game.game_time);
            if (!commenceTime) {
              skippedDateCount++;
              summaryEntry.skipped++;
              console.warn(
                '[london365] skipping game ' + game.id + ' (' + league.name + '): missing/unparseable kickoff date — raw fields: ' +
                'whole_date=' + JSON.stringify(game.whole_date) + ' game_date=' + JSON.stringify(game.game_date) + ' game_time=' + JSON.stringify(game.game_time)
              );
              return;
            }

            const ev = buildEvent(
              game.id,
              game.home_team,
              game.away_team,
              commenceTime,
              rows
            );
            await upsertMatch(ev, leagueKeyResolved, statusFromCommence(ev.commence_time), null);
            matchCount++;
            summaryEntry.imported++;
            coefficientCount += rows.length;
            leaguesSeen.add(league.name);
          }));
        }
      }
    }
    await setKV('l365_leagues', Array.from(leaguesSeen));
    // A full pass finished with nothing left to interrupt it — clear both
    // resume cursors so the next run starts from the top (International
    // first) again instead of resuming mid-list forever.
    await setKV('l365_league_cursor', null);
    await setKV('l365_country_cursor', null);
    await setKV('l365_market_names', Object.fromEntries(marketNameById));
    // Persist leagueById (id -> {key, name, countryId, countryName}) so a
    // fresh server boot doesn't start with it EMPTY. Without this, any live
    // socket event that arrives before the (slow) full-import loop has
    // re-reached that specific league falls back to name-only guessing —
    // wrong for a bare league name with no country word in it at all
    // ("Premier League", "Nations League"...), which is exactly how this
    // provider names most leagues.
    await setKV('l365_league_map', Object.fromEntries(leagueById));
    // Now that this run's leagueNameIndex is fully populated (every real
    // league name/alias we know about), sweep any already-existing rows
    // stuck under a redundant country-prefixed key ("England Premier
    // League") — they'd otherwise sit there forever as an empty duplicate
    // next to the correctly-updating real-named league.
    await purgeCountryPrefixedDuplicateLeagues();
    await purgeCountriesNotInOnlyList();
    await setKV('l365_last_import', Date.now());
    console.log(
      '[london365] import done: ' + matchCount + ' matches, ' + coefficientCount + ' coefficients, ' +
      leaguesSeen.size + ' leagues (full-detail fetch: ' + detailOkCount + ' ok / ' + detailFailCount + ' failed' +
      (full && detailFailCount > detailOkCount ? ' — MOSTLY FAILING, matches are likely showing only sparse list-level odds, not the full market catalog' : '') +
      ', ' + skippedDateCount + ' games skipped for bad dates' +
      ', ' + skippedNoOddsCount + ' games skipped for zero usable odds' +
      ')'
    );
    // Per-country league breakdown: leagues the provider actually returned
    // for this run, and how many of each league's games made it in vs got
    // skipped — the direct answer to "why does England only show 3 leagues"
    // or "why does Premier League have 0 matches" without guessing.
    for (const [country, leaguesForCountry] of leagueSummary.entries()) {
      console.log(
        '[london365] ' + country + ': ' + leaguesForCountry.length + ' leagues — ' +
        leaguesForCountry.map((l) => l.name + ' (id=' + l.id + ', provider=' + l.providerGames + ', imported=' + l.imported + ', skipped=' + l.skipped + ')').join('; ')
      );
    }
    // Loud, unmissable final check: any priority country that got NOTHING
    // this run (no leagues with games right now, or every games-fetch for
    // it failed) — the single line worth searching the log for.
    if (PRIORITY_COUNTRIES.size) {
      const seenPriority = new Set(
        Array.from(leagueSummary.keys()).map((c) => c.toLowerCase())
      );
      const missing = Array.from(PRIORITY_COUNTRIES).filter((c) => !seenPriority.has(c));
      if (missing.length) {
        console.warn('[london365] PRIORITY COUNTRY WITH ZERO LEAGUES THIS RUN: ' + missing.join(', '));
      }
    }
    return { matches: matchCount, coefficients: coefficientCount, leagues: leaguesSeen.size, detailOkCount, detailFailCount, skippedDateCount, skippedNoOddsCount };
  } finally {
    importRunning = false;
  }
}

// Kick a throttled import in the background (never blocks an API request).
export function ensureLondon365Import() {
  if (!ENABLED) return;
  (async function () {
    const last = await getKV('l365_last_import', 0);
    const elapsed = Date.now() - last;
    if (Math.sign(IMPORT_THROTTLE_MS - elapsed) === 1) return;
    await setKV('l365_last_import', Date.now());
    try {
      await importLondon365();
    } catch (err) {
      console.error('[london365] background import failed:', err.message);
    }
  })();
}

// Live sync: in-play scores plus REAL-TIME FULL market catalog. The list
// endpoint (/ajax/livegames) only carries the packed 1X2 odds, but every
// live game exposes its complete market set on /ajax/livegame/{id} — same
// row shape as the prematch detail endpoint — so we fetch it per game and
// merge it into the cached event. Games that leave the live feed are
// auto-settled with their last known score so final results appear.
export async function syncLondon365Live() {
  if (!ENABLED) return { games: 0 };
  await ensureMarketNamesLoaded();
  let gamesSynced = 0;
  const liveIds = new Set();

  for (const sid of await resolveSports()) {
    let games;
    try {
      games = await api('/ajax/livegames', { method: 'POST', body: { sport: sid, market_type: 1 } });
    } catch (err) {
      console.error('[london365] livegames sport ' + sid + ' failed:', err.message);
      continue;
    }
    if (!Array.isArray(games)) continue;

    for (const g of games) {
      if (!g || !g.id) continue;
      const resolvedLeagueEarly = (g.league_id != null && leagueById.get(String(g.league_id))) || resolveLeagueByName(g.league);
      // Same country allowlist as the prematch import — a live match from a
      // country outside LONDON365_ONLY_COUNTRIES shouldn't sneak into the
      // feed just because it's currently in-play. Unresolvable leagues
      // (leagueById miss, e.g. right after a restart) are let through here
      // since we can't yet know their country; the games loop below still
      // routes them through the same key builder either way.
      if (ONLY_COUNTRIES.size && resolvedLeagueEarly && resolvedLeagueEarly.countryName &&
          !ONLY_COUNTRIES.has(resolvedLeagueEarly.countryName.toLowerCase())) continue;
      liveIds.add('l365-' + g.id);
      let rows = [];
      try {
        if (DETAIL_DELAY_MS) await sleep(DETAIL_DELAY_MS);
        rows = await fetchLiveRows(g.id);
      } catch (err) {
        console.error('[london365] livegame detail ' + g.id + ' failed (falling back to packed list odds):', err.message);
      }
      if (!rows.length) rows = parseOddString(g.odd);
      const odds = hydrateRowNames(rows.filter(function (o) { return o ? !Number.isNaN(o.coef) : false; }));
      if (!odds.length) continue;
      const ev = buildEvent(g.id, g.home_team, g.away_team, isoFromWholeDate(g.whole_date, g.game_date, g.game_time) || new Date().toISOString(), odds);
      const score = parseScore(g.result);
      const minute = g.current_minute || null;
      // Prefer the country-accurate key resolved from the real league_id
      // (set during the last full import); if that's missing, try matching
      // the live feed's own league text against every real league name/alias
      // seen during the last import (resolveLeagueByName) BEFORE falling
      // back to pure guessing — the live feed and prematch endpoint don't
      // always agree on naming for the same league (e.g. "England Premier
      // League" vs "Premier League"), and guessing from the raw text alone
      // used to create a second, wrongly-named duplicate of an already-known
      // league instead of landing on its real name.
      const resolvedLeague = (g.league_id != null && leagueById.get(String(g.league_id))) || resolveLeagueByName(g.league);
      const prev = await upsertMatch(ev, resolvedLeague ? resolvedLeague.key : leagueKeyFromCountry(null, g.league || ''), 'LIVE', score, { minute: minute, apiStatus: g.api_status });
      await recordGoalIfChanged(ev, score, minute, prev);
      gamesSynced++;
    }
  }

  // End detection: a cached LIVE l365 match no longer in the live feed has
  // finished — settle it with the last known score so the final result
  // shows on the right of the card. Two independent triggers:
  //  1. It hasn't been updated (fetched_at) in a while — this is the one
  //     that actually matters in practice: a match can vanish from the live
  //     feed the moment it ends, at ANY real-game-time (45+2', 90+5', a
  //     match delayed/extended into extra time...). Gating only on kickoff
  //     time (old behavior) left it frozen at its last score/minute for up
  //     to ~2.5h after it had actually finished.
  //  2. Kickoff was >2.5h ago — pure safety net for the rare case a match
  //     was somehow never freshly fetched at all (fetched_at stuck at
  //     import time), so it doesn't wait on trigger 1 forever.
  try {
    const { rows } = await pool.query(
      "SELECT id, live_home_score, live_away_score, start_time, fetched_at FROM matches_cache WHERE id LIKE 'l365-%' AND status = 'LIVE'"
    );
    const kickoffCutoff = Date.now() - 2.5 * 60 * 60 * 1000;
    const staleCutoff = Date.now() - 8 * 60 * 1000; // no update in 8 minutes while "live" = provider stopped sending it
    for (const row of rows) {
      if (liveIds.has(row.id)) continue;
      const stale = Number(row.fetched_at) < staleCutoff;
      const oldKickoff = Date.parse(row.start_time) < kickoffCutoff;
      if (!stale && !oldKickoff) continue;
      const home = row.live_home_score ?? 0;
      const away = row.live_away_score ?? 0;
      await pool.query("UPDATE matches_cache SET live_status = 'ended' WHERE id = $1", [row.id]);
      try {
        await settleMatch(row.id, home, away);
        console.log('[london365] auto-settled ' + row.id + ' ' + home + '-' + away);
      } catch (err) {
        console.error('[london365] auto-settle ' + row.id + ' failed:', err.message);
      }
    }
  } catch (err) {
    console.error('[london365] end detection failed:', err.message);
  }

  await setKV('l365_last_live_sync', Date.now());
  return { games: gamesSynced };
}

// --- Socket.IO feed handlers (called by london365Socket.js) ----------------
// The provider pushes real-time deltas over Socket.IO in addition to the REST
// snapshot the polling loop reads. These handlers patch the cached canonical
// event in place so odds move sub-second without a full re-fetch.

export async function applySocketCoefs(gameId, coefs) {
  const id = 'l365-' + gameId;
  return withDbLock(async () => {
    const { rows } = await pool.query('SELECT raw_json FROM matches_cache WHERE id = $1', [id]);
    if (!rows.length || !rows[0].raw_json) return 0;
    let ev;
    try { ev = JSON.parse(rows[0].raw_json); } catch (err) { return 0; }
    const byCoefId = new Map();
    for (const bm of ev.bookmakers || []) {
      for (const mk of bm.markets || []) {
        for (const o of mk.outcomes || []) byCoefId.set(String(o.id), { o: o, market: mk.key });
      }
    }
    const changes = [];
    for (const c of coefs || []) {
      const coefId = String(c.coef_id != null ? c.coef_id : (c.id != null ? c.id : ''));
      const price = parseFloat(c.coef != null ? c.coef : (c.odd != null ? c.odd : c.value));
      if (!coefId || Number.isNaN(price)) continue;
      const entry = byCoefId.get(coefId);
      if (!entry || entry.o.price === price) continue;
      changes.push({ matchId: id, marketId: entry.market, selectionId: coefId, oldOdds: entry.o.price, newOdds: price });
      entry.o.price = price;
    }
    if (!changes.length) return 0;
    const now = Date.now();
    for (const c of changes) {
      await pool.query(
        `INSERT INTO odds_history (match_id, market_id, selection_id, old_odds, new_odds, changed_by, reason, created_at)
         VALUES ($1,$2,$3,$4,$5,'SYSTEM','london365_socket',$6)`,
        [c.matchId, c.marketId, c.selectionId, c.oldOdds, c.newOdds, now]
      );
    }
    await pool.query('UPDATE matches_cache SET raw_json = $2, fetched_at = $3 WHERE id = $1', [id, JSON.stringify(ev), now]);
    pushOddsChanged(id, { changes: changes });
    return changes.length;
  });
}

export async function applySocketGame(g, status) {
  if (!g || !g.id) return false;
  await ensureMarketNamesLoaded();
  const odds = hydrateRowNames(parseOddString(g.odd).filter(function (o) { return o ? !Number.isNaN(o.coef) : false; }));
  if (!odds.length) return false;
  const commence = isoFromWholeDate(g.whole_date, g.game_date, g.game_time) || new Date().toISOString();
  const ev = buildEvent(g.id, g.home_team, g.away_team, commence, odds);
  const score = parseScore(g.result);
  const minute = g.current_minute || null;
  const resolved = status || (minute ? 'LIVE' : statusFromCommence(commence));
  const resolvedLeague = (g.league_id != null && leagueById.get(String(g.league_id))) || resolveLeagueByName(g.league);
  const prev = await upsertMatch(ev, resolvedLeague ? resolvedLeague.key : leagueKeyFromCountry(null, g.league || ''), resolved, score, { minute: minute, apiStatus: g.api_status });
  await recordGoalIfChanged(ev, score, minute, prev);
  return true;
}

export async function markLondon365GameEnded(gameId) {
  const id = 'l365-' + gameId;
  return withDbLock(async () => {
    const res = await pool.query(
      `UPDATE matches_cache SET status = 'FINISHED', live_status = 'ended' WHERE id = $1 AND status = 'LIVE'`,
      [id]
    );
    return res ? res.rowCount : 0;
  });
}

export async function removeSocketCoef(gameId, coefId) {
  const id = 'l365-' + gameId;
  if (!coefId) return 0;
  return withDbLock(async () => {
    const { rows } = await pool.query('SELECT raw_json FROM matches_cache WHERE id = $1', [id]);
    if (!rows.length || !rows[0].raw_json) return 0;
    let ev;
    try { ev = JSON.parse(rows[0].raw_json); } catch (err) { return 0; }
    let removed = 0;
    for (const bm of ev.bookmakers || []) {
      for (const mk of bm.markets || []) {
        const before = (mk.outcomes || []).length;
        mk.outcomes = (mk.outcomes || []).filter(function (o) { return String(o.id) !== String(coefId); });
        removed += before - mk.outcomes.length;
      }
    }
    if (removed) await pool.query('UPDATE matches_cache SET raw_json = $2, fetched_at = $3 WHERE id = $1', [id, JSON.stringify(ev), Date.now()]);
    return removed;
  });
}

// Repair pass: the provider's detail endpoint intermittently fails on
// hosting (rate limits / transient "Something went wrong"), leaving cached
// l365 events with only the sparse list-level odds — 1-4 markets, names
// like "Market 6575". This re-fetches full detail for the OLDEST sparse
// events in bounded batches and replaces them, so the frontend eventually
// shows every LondonPro365 market and coefficient. Rotation via fetched_at
// guarantees one permanently-broken game can't block the queue.
let repairRunning = false;
export async function repairSparseEvents(opts) {
  opts = opts || {};
  if (!ENABLED || repairRunning) return { attempted: 0, repaired: 0 };
  repairRunning = true;
  const limit = Number(opts.limit) || 25;
  try {
    await ensureMarketNamesLoaded();
    const { rows } = await pool.query(
      "SELECT id, league, status, raw_json FROM matches_cache WHERE id LIKE 'l365-%' AND status != 'FINISHED' ORDER BY fetched_at ASC LIMIT $1",
      [limit * 3]
    );
    let attempted = 0;
    let repaired = 0;
    for (const row of rows) {
      if (repaired >= limit) break;
      let ev;
      try { ev = JSON.parse(row.raw_json); } catch (err) { continue; }
      if (!isSparseEvent(ev)) continue;
      const gameId = String(row.id).replace('l365-', '');
      attempted++;
      await pool.query('UPDATE matches_cache SET fetched_at = $2 WHERE id = $1', [row.id, Date.now()]);
      try {
        if (DETAIL_DELAY_MS) await sleep(DETAIL_DELAY_MS);
        // LIVE events must be repaired through the live endpoint — the
        // prematch detail returns zero rows once a game kicks off.
        const rawRows = row.status === 'LIVE' ? await fetchLiveRows(gameId) : await fetchDetailRows(gameId);
        const fresh = hydrateRowNames(rawRows.filter(function (r) { return r && !Number.isNaN(r.coef); }));
        if (fresh.length <= countOutcomes(ev)) continue;
        const newEv = buildEvent(gameId, ev.home_team, ev.away_team, ev.commence_time, fresh);
        await upsertMatch(newEv, row.league, row.status, null);
        repaired++;
      } catch (err) {
        console.error('[london365] repair ' + row.id + ' failed:', err.message);
      }
    }
    if (attempted) await setKV('l365_market_names', Object.fromEntries(marketNameById));
    if (repaired) console.log('[london365] repair pass: ' + repaired + '/' + attempted + ' sparse events restored to full detail');
    return { attempted: attempted, repaired: repaired };
  } finally {
    repairRunning = false;
  }
}

let liveTimer = null;

// One-time cleanup so leagues that shouldn't exist under the CURRENT rules
// (excluded countries, or minor/youth/regional leagues per
// LONDON365_MAJOR_ONLY) disappear immediately instead of lingering forever
// as stale rows imported under an OLDER, buggier country-detection pass —
// which is exactly how e.g. "Italy Brasileiro Serie A" ended up sitting
// under Italy: it was imported back when country detection guessed from
// the league NAME (a "serie a"/"serie b" substring match), well before the
// country_id-based fix. That stale row's league key already says
// "l365_italy__...", so purgeExcludedCountries() (which matches on the
// CURRENT country prefix) never touches it. This sweeps by keyword
// instead, regardless of whatever country prefix a stale row currently has.
const STALE_LEAGUE_KEYWORDS = [
  'brasileiro', 'brasileirao', 'amazonense', 'gaucho', 'carioca', 'paulista',
  'catarinense', 'mineiro', 'baiano', 'cearense', 'potiguar', 'goiano',
  'alagoano', 'capixaba', 'sergipano', 'paraense', 'matogrossense',
  'pernambucano', 'copa_do_brasil',
  'u19', 'u20', 'u21', 'u23', 'women', 'youth', 'junior', 'reserve',
  'amateur', 'academy', 'friendly', 'esoccer', 'virtual', 'simulated',
];
export async function purgeStaleLeagues() {
  for (const kw of STALE_LEAGUE_KEYWORDS) {
    try {
      const { rowCount } = await pool.query(
        `DELETE FROM matches_cache WHERE id LIKE 'l365-%' AND league ILIKE $1`,
        [`%${kw}%`]
      );
      if (rowCount) console.log(`[london365] purged ${rowCount} stale rows matching "${kw}" (excluded/minor league, imported under an older classification)`);
    } catch (err) {
      console.error(`[london365] failed purging stale keyword "${kw}":`, err.message);
    }
  }
}

// Purges rows whose league key redundantly repeats the country in the
// league-name portion itself — e.g. "l365_england__england_premier_league"
// sitting next to the correctly-named "l365_england__premier_league" for
// the exact same competition. This happens when a live/socket payload's
// own g.league text came through as "England Premier League" (some
// providers name it that way on the live feed even though the prematch
// list endpoint calls the same league plain "Premier League") and no
// league_id was available to resolve it properly at write time. The
// in-memory alias index (resolveLeagueByName) stops this going forward;
// this cleans up whatever already landed in the DB before that existed.
// Runs after every completed import, using that run's own countryMap so
// "does the league-name half start with the country name" is checked
// against real country names, not a guess.
export async function purgeCountryPrefixedDuplicateLeagues() {
  try {
    const { rows } = await pool.query(
      "SELECT DISTINCT league FROM matches_cache WHERE id LIKE 'l365-%' AND league LIKE '%\\_\\_%'"
    );
    let purged = 0;
    for (const { league: key } of rows) {
      const m = /^l365_([a-z0-9-]+)__(.+)$/.exec(key);
      if (!m) continue;
      const [, countryToken, leagueSlug] = m;
      // Bad pattern: league-name slug literally starts with the country
      // token again ("england" + "_premier_league" -> "england_premier_league").
      if (!leagueSlug.startsWith(countryToken + '_')) continue;
      const strippedSlug = leagueSlug.slice(countryToken.length + 1);
      const cleanKey = 'l365_' + countryToken + '__' + strippedSlug;
      if (cleanKey === key) continue; // nothing left after stripping — not actually a duplicate
      const { rowCount } = await pool.query(
        `DELETE FROM matches_cache WHERE id LIKE 'l365-%' AND league = $1`,
        [key]
      );
      purged += rowCount;
      if (rowCount) console.log(`[london365] purged ${rowCount} rows under redundant "${key}" (real name is "${cleanKey}")`);
    }
    return purged;
  } catch (err) {
    console.error('[london365] failed purging country-prefixed duplicate leagues:', err.message);
    return 0;
  }
}

// One-time cleanup so an excluded country's matches disappear immediately
// on deploy instead of only stopping new ones from being added (existing
// rows would otherwise sit in matches_cache until they naturally age out).
// Safe to call on every boot — it's a no-op once already cleaned up.
export async function purgeExcludedCountries() {
  if (!EXCLUDED_COUNTRIES.size) return;
  for (const country of EXCLUDED_COUNTRIES) {
    const token = leagueCountryToken(country) === 'other' ? slugDash(country) : leagueCountryToken(country);
    try {
      const { rowCount } = await pool.query(
        `DELETE FROM matches_cache WHERE id LIKE 'l365-%' AND league LIKE $1`,
        [`l365_${token}__%`]
      );
      if (rowCount) console.log(`[london365] purged ${rowCount} existing ${country} matches (excluded country)`);
    } catch (err) {
      console.error(`[london365] failed purging excluded country ${country}:`, err.message);
    }
  }
}

// Same idea as purgeExcludedCountries, but for LONDON365_ONLY_COUNTRIES
// (an allow-list instead of a deny-list): rows already sitting in
// matches_cache from BEFORE this env var was set (or from before it was set
// to this exact value) belong to countries no longer in scope, and would
// otherwise linger in the sidebar — with stale, never-updating data — until
// they naturally age out. This deletes them outright the moment the allow-
// list changes, so switching to a tighter scope takes effect immediately
// instead of "the new setting only affects what gets ADDED from now on".
// Safe / cheap to call every boot and after every import: no-op once
// everything already matches the current allow-list.
export async function purgeCountriesNotInOnlyList() {
  if (!ONLY_COUNTRIES.size) return 0;
  const allowedTokens = new Set(
    Array.from(ONLY_COUNTRIES).map((name) => (leagueCountryToken(name) === 'other' ? slugDash(name) : leagueCountryToken(name)))
  );
  try {
    const { rows } = await pool.query("SELECT DISTINCT league FROM matches_cache WHERE id LIKE 'l365-%'");
    let purged = 0;
    for (const { league: key } of rows) {
      const m = /^l365_([a-z0-9-]+)__/.exec(key);
      if (!m) continue; // pre-migration format, handled by purgeLegacyLeagueKeyFormat instead
      if (allowedTokens.has(m[1])) continue;
      const { rowCount } = await pool.query(
        `DELETE FROM matches_cache WHERE id LIKE 'l365-%' AND league = $1`,
        [key]
      );
      purged += rowCount;
      if (rowCount) console.log(`[london365] purged ${rowCount} rows under "${key}" (country "${m[1]}" not in LONDON365_ONLY_COUNTRIES)`);
    }
    return purged;
  } catch (err) {
    console.error('[london365] failed purging countries outside ONLY_COUNTRIES:', err.message);
    return 0;
  }
}

// One-time cleanup of the OLD league-key format (single underscore, e.g.
// "l365_england_premier_league") from before the country segment was
// switched to a "__"-delimited prefix (leagueKeyFromCountry above). Rows
// under the old key stopped being refreshed the moment the code migrated,
// so they sit there as dead duplicates of the correctly-updating new-format
// row for the same real competition — e.g. "England Premier League" (old,
// stale, no matches) next to "Premier League" (new, live-updated) in the
// sidebar. Every current l365 key contains "__"; anything under an l365-%
// id without it is unambiguously pre-migration and safe to drop.
export async function purgeLegacyLeagueKeyFormat() {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM matches_cache WHERE id LIKE 'l365-%' AND league LIKE 'l365\\_%' ESCAPE '\\' AND strpos(league, '__') = 0`
    );
    if (rowCount) console.log(`[london365] purged ${rowCount} rows under the old pre-migration league-key format (dead duplicate leagues)`);
  } catch (err) {
    console.error('[london365] failed purging legacy league-key format:', err.message);
  }
}

export function startLondon365LiveLoop() {
  if (!ENABLED || liveTimer) return;
  liveTimer = setInterval(function () {
    syncLondon365Live().catch(function (err) {
      console.error('[london365] live sync failed:', err.message);
    });
  }, LIVE_INTERVAL_MS);
  if (liveTimer.unref) liveTimer.unref();
  setTimeout(function () {
    syncLondon365Live().catch(function (err) {
      console.error('[london365] initial live sync failed:', err.message);
    });
  }, 5000);
  console.log('[london365] live loop started, every ' + LIVE_INTERVAL_MS + 'ms (sports: ' + (SPORTS_RAW === 'all' ? 'all discovered' : SPORTS_RAW) + ')');
}

export async function getLondon365Status() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS matches,
            COUNT(*) FILTER (WHERE status = 'LIVE')::int AS live,
            COUNT(*) FILTER (WHERE status = 'UPCOMING')::int AS upcoming,
            COUNT(*) FILTER (WHERE status = 'FINISHED')::int AS finished
     FROM matches_cache WHERE id LIKE 'l365-%'`
  );
  return {
    enabled: ENABLED,
    socketConnected: socketConnected,
    apiBase: API_BASE,
    sports: resolvedSports || SPORTS_RAW,
    fullDetail: FULL_DETAIL,
    leagueLimit: LEAGUE_LIMIT,
    priorityCountries: Array.from(PRIORITY_COUNTRIES),
    onlyCountries: Array.from(ONLY_COUNTRIES),
    liveIntervalMs: LIVE_INTERVAL_MS,
    matches: rows[0].matches,
    liveMatches: rows[0].live,
    upcomingMatches: rows[0].upcoming,
    finishedMatches: rows[0].finished,
    lastImport: await getKV('l365_last_import', 0),
    lastLiveSync: await getKV('l365_last_live_sync', 0),
    leagues: (await getKV('l365_leagues', [])).length,
    // Raw league names exactly as the provider sends them — paste this list
    // back for an accurate country-name mapping instead of guessing at the
    // provider's naming format.
    leagueNames: await getKV('l365_leagues', []),
  };
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
