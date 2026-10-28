// Environment-driven settings of the provider integration (what to import, how often, how much detail).

export const ENABLED = (process.env.LONDON365_ENABLED || '1') === '1';
export const API_BASE = process.env.LONDON365_API || 'https://eccoplay365.com';
export const SITE_ORIGIN = process.env.LONDON365_ORIGIN || 'https://londonpro365.com';
// 'all' (default) discovers every sport the provider exposes so no match is
// hidden; a csv like "1,2,5" restricts the import to those sport ids.
export const SPORTS_RAW = (process.env.LONDON365_SPORTS || '1').trim();
export const LEAGUE_LIMIT = Number(process.env.LONDON365_LEAGUES || 0);
// Empty set = no restriction = full detail for every country (old behavior).
export const PRIORITY_COUNTRIES = new Set(
  (process.env.LONDON365_PRIORITY_COUNTRIES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);
export const wantsFullDetailFor = (countryName) =>
  !PRIORITY_COUNTRIES.size ||
  (countryName && (PRIORITY_COUNTRIES.has(countryName.toLowerCase()) || TOP_PRIORITY_COUNTRIES.has(countryName.toLowerCase())));
// Skip minor/youth/regional leagues so the import spends its time+requests
// on what people actually check (top flight + main cup per country) instead
// of burning through e.g. Brazil's dozens of state championships (Gaucho,
// Carioca, Paulista, Amazonense...) or U20/women/amateur competitions for
// every single country. LONDON365_MAJOR_ONLY=0 disables this (full catalog,
// old/slower behavior).
// Master switch: LONDON365_ALL_MATCHES=1 imports EVERY match the provider carries
// (no country whitelist, no "major leagues only", no second-tier or country
// exclusions). Without it the narrower catalogue below applies. More matches means
// more load, which the live loop handles by budgeting the expensive per-game
// refresh (see liveDetailPlan.js).
export const ALL_MATCHES = ['1', 'true', 'yes'].includes(String(process.env.LONDON365_ALL_MATCHES || '').toLowerCase());
export const MAJOR_LEAGUES_ONLY = !ALL_MATCHES && (process.env.LONDON365_MAJOR_ONLY || '1') === '1';
// Countries excluded entirely (no leagues, no matches at all) — csv of real
// country names, comma-separated, case-insensitive. Brazil is excluded by
// default per explicit request: its huge volume of state/regional
// competitions was cluttering the feed and it isn't a priority market.
export const EXCLUDED_COUNTRIES = new Set(
  (ALL_MATCHES ? '' : (process.env.LONDON365_EXCLUDE_COUNTRIES ?? 'brazil'))
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
// The whitelist is ON BY DEFAULT: with the variable unset (or empty) only these
// five countries + the narrowed "International" bucket are imported, so a
// missing/blank env var can never silently turn into a worldwide import.
// LONDON365_ONLY_COUNTRIES='*' (or 'all') is the explicit opt-out.
export const DEFAULT_ONLY_COUNTRIES = ['england', 'france', 'spain', 'italy', 'germany'];
export function parseOnlyCountries(raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return new Set(DEFAULT_ONLY_COUNTRIES);
  if (/^(\*|all|any)$/i.test(v)) return new Set();
  return new Set(v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
}
export const ONLY_COUNTRIES = ALL_MATCHES ? new Set() : parseOnlyCountries(process.env.LONDON365_ONLY_COUNTRIES);
// International/continental competitions (Champions League, Europa League,
// Nations League, World Cup qualifiers...) are never excludable via
// LONDON365_ONLY_COUNTRIES — someone listing "england,spain,italy,..." to
// trim the domestic-league catalog down almost certainly still wants
// Champions League etc, which live under their own "International" country
// bucket, not under any single nation.
if (ONLY_COUNTRIES.size) ONLY_COUNTRIES.add('international');
// TEST MODE: restrict ingestion to a fixed whitelist of leagues (5 top
// domestic leagues + UCL/UEL), processed with bounded parallelism across
// leagues instead of the normal sequential loop. Off by default — normal
// production runs are completely untouched by this.
export const TEST_MODE = process.env.LONDON365_TEST_MODE === '1';
export const TEST_LEAGUE_NAMES = new Set([
  'premier league', 'la liga', 'bundesliga', 'ligue 1', 'serie a',
  'champions league', 'uefa champions league', 'europa league', 'uefa europa league',
]);
export const TEST_CONCURRENCY = Math.max(1, Number(process.env.LONDON365_TEST_CONCURRENCY || 6));
// Minimal bounded-concurrency runner (no new dependency): at most `limit`
// items of `items` are in flight via `worker` at once.
export async function runWithConcurrency(items, limit, worker) {
  let i = 0;
  const n = Math.min(limit, items.length);
  await Promise.all(
    new Array(n).fill(0).map(async function () {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx]);
      }
    })
  );
}
// Domestic second-tier exclusion (on by default: LONDON365_EXCLUDE_SECOND_TIER,
// default '1'). For the five whitelisted countries, the professional second
// tier (Serie B, Championship, 2. Bundesliga, Ligue 2, Segunda Division) is
// rejected by NAME. Everything else that is not already minor (youth /
// reserve / women's / regional lower tier, see isMinorLeague below) is kept --
// domestic cups and super cups (FA Cup, Coppa Italia, DFB-Pokal, Coupe de
// France, Copa del Rey...) are watched and KEPT. International is unaffected
// (it keeps its own UEFA/Nations League allowlist).
export const EXCLUDE_SECOND_TIER = !ALL_MATCHES && (process.env.LONDON365_EXCLUDE_SECOND_TIER || '1') === '1';
// Used ONLY to decide sort order before an optional LEAGUE_LIMIT cap is
// applied, so a cap (if configured) can never cut off the leagues people
// actually check. Falls back to the obvious big leagues even when
// LONDON365_PRIORITY_COUNTRIES isn't set, unlike PRIORITY_COUNTRIES above
// (which intentionally means "no restriction" when empty for the
// full-detail-vs-list-only decision — a separate, unrelated concern).
export const SORT_PRIORITY_COUNTRIES = PRIORITY_COUNTRIES.size
  ? PRIORITY_COUNTRIES
  : new Set(['international', 'uefa', 'england', 'spain', 'italy', 'germany', 'france', 'brazil', 'portugal', 'netherlands']);
// International/continental competitions (Champions League, Europa League,
// World Cup qualifiers, Nations League...) go EVEN BEFORE the top domestic
// leagues — checked first in the priority comparator below.
export const TOP_PRIORITY_COUNTRIES = new Set(['international', 'uefa', 'world', 'europe']);
export const FULL_DETAIL = (process.env.LONDON365_FULL || '1') === '1';
export const LIVE_INTERVAL_MS = Math.max(10000, Number(process.env.LONDON365_LIVE_INTERVAL_MS || 10000));
export const IMPORT_THROTTLE_MS = Number(process.env.LONDON365_IMPORT_THROTTLE_MS || 120000);
export const DETAIL_DELAY_MS = Math.max(0, Number(process.env.LONDON365_DETAIL_DELAY_MS || 50));
// How many games' detail fetches run in flight at once (each still paced by
// its own DETAIL_DELAY_MS). Default 4 — a meaningful speedup over strictly
// sequential without meaningfully raising per-provider request rate (this
// host has been redeployed often enough that a fully sequential pass rarely
// finished even the priority countries before being interrupted).
export const DETAIL_CONCURRENCY = Math.max(1, Number(process.env.LONDON365_DETAIL_CONCURRENCY || 4));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function isLondon365Enabled() {
  return ENABLED;
}
