// In-memory registry of the provider's leagues and countries (id <-> name <-> key), with the country cache.
import { getKV } from '../db.js';
import { isAllowedByCountryFilter } from './leagueRules.js';
import { api } from './api.js';

// --- Real country identification (country.id / league.country_id) --------
// The provider exposes an authoritative id-based mapping:
//   GET /ajax/countries/{sportId}  -> [{ id, name, sport_id, ... }, ...]
//   GET /ajax/leagues/{sportId}    -> [{ id, name, country_id, ... }, ...]
// league.country_id links directly to country.id. This is the PRIMARY
// source of truth for a league's country — leagueCountryToken() above
// (name/regex guessing) is kept ONLY as a last-resort fallback for the rare
// league whose country_id we can't resolve (missing from the countries
// list, or the provider omitted the field), never as the primary path.
export const COUNTRY_MAP_CACHE_MS = 6 * 60 * 60 * 1000;
 // matches the provider catalog's own refresh cadence
export const countryMapCache = new Map();
 // sportId -> { fetchedAt, countryMap }
// provider league id (string) -> { key, name, countryId, countryName } —
// lets live/socket payloads that carry a league_id resolve the SAME
// country-accurate key the import pass computed, instead of falling back
// to a raw league name string.
export const leagueById = new Map();
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
export const leagueNameIndex = new Map();
export function normalizeLeagueText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
export function registerLeagueName(entry) {
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
export function resolveLeagueByName(rawName) {
  return leagueNameIndex.get(normalizeLeagueText(rawName)) || null;
}
// ONE gate for every live entry point (REST live loop + socket new-game /
// new-live-game). Same rule the prematch import applies, evaluated from the
// payload alone -- no DB, no event building -- so a game outside the allowed
// countries/competitions is dropped before any parsing or persistence.
//   - country allowlist (LONDON365_ONLY_COUNTRIES; "international" is always
//     added to it)
//   - inside the International bucket only allowed competitions pass (UEFA /
//     Nations League / FIFA-World Cup...), judged by the provider's own league
//     name when the league is known (identical to what the import used), else
//     by the payload's league text
//   - a league we cannot resolve at all is still judged on its NAME: a UEFA /
//     FIFA competition is kept (it used to fall through to the token 'uefa',
//     which is not in the allowlist, and be silently dropped)
// Synchronous, DB-free: should we start streaming live detail (score/cards)
// for this game the instant the provider announces it?
export function isLiveGameWanted(g) {
  if (!g || !g.id) return false;
  const resolved = (g.league_id != null && leagueById.get(String(g.league_id))) || resolveLeagueByName(g.league);
  return isAllowedByCountryFilter(g, resolved);
}
export let leagueByIdLoaded = false;
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
// Same idea as getLondon365LeagueNames, but with the provider's real IDs
// alongside the display name -- the frontend/admin panel needs these for
// exact league/country identification (filtering, admin lookups, avoiding
// the name-based duplicate-league issues), not just a label to render.
export function getLondon365LeagueMeta() {
  const meta = {};
  for (const entry of leagueById.values()) {
    if (entry && entry.key) {
      meta[entry.key] = {
        id: entry.id || null,
        name: entry.name,
        countryId: entry.countryId || null,
        countryName: entry.countryName || null,
      };
    }
  }
  return meta;
}
// Confirmed directly against the live provider — the FULL /ajax/countries/1
// response, pasted verbatim by the site owner (not partial, not guessed).
// Used as a hard override on top of whatever /ajax/countries/{sportId}
// returns, so classification for these countries is always by id, never by
// name-guessing a league's own name (which is what caused the Spain
// pollution bug: id 85 alone is clean, so any wrong-country leagues were a
// classification bug on our side, not a provider data issue).
export const CONFIRMED_COUNTRY_IDS = {
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
export async function getCountryMap(sportId) {
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
