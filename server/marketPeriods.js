// Pure, DB-free rules for WHEN a market may still take bets, based on the match
// period. Shared by the bet placement route (server-side guard), the match
// mapper (so the UI shows closed markets as locked) and the settlement code.
//
// Only what the provider data lets us decide is decided here: a clearly named
// first-half market is closed once the first half is over. Everything else
// (full-time, second-half, combos, HT/FT doubles) is left to the provider's own
// suspension (price <= 1.01) so we never close a market on a guess.

// Lowercase + strip diacritics + collapse whitespace ("Pjesa e Parë" -> "pjesa e pare").
export function normMarketText(str) {
  return String(str ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// The provider names periods in several forms, all seen on real tickets:
//   "Rezultati Pjesa e Parë", "Rezultati Pjesës së Parë" (genitive: pjesës + së),
//   "Rezultati Pjesa I" / "Pjesa II" (Roman numerals), "1. pjesa", "1st Half".
// (input must be normalised: lowercase, no diacritics -> "pjeses se pare")
export const FIRST_HALF_RE = /(?:\bne\s+)?(?:\bpjes(?:a|en|es|e)\s+(?:s?e\s+)?(?:pare|1|i)\b|\b1\.?\s*pjes(?:a|en|es|e)\b|\b(?:1st|first)\s+half\b|\bne\s+pushim\b)/;
export const SECOND_HALF_RE = /(?:\bne\s+)?(?:\bpjes(?:a|en|es|e)\s+(?:s?e\s+)?(?:dyte|2|ii)\b|\b2\.?\s*pjes(?:a|en|es|e)\b|\b(?:2nd|second)\s+half\b)/;

// Names that only make sense WITH a period phrase around them ("Rezultati Pjesa I").
export const PERIOD_BASE_ALIASES = {
  rezultati: 'rezultati final',
  fituesi: 'rezultati final',
  golat: 'numri i golave',
  'mbi/nen': 'numri i golave',
  'lart/poshte': 'numri i golave',
};

// Cut the period phrase out of a NORMALISED market name: { period, base }.
export function splitPeriod(name) {
  for (const [re, period] of [[FIRST_HALF_RE, 'H1'], [SECOND_HALF_RE, 'H2']]) {
    if (re.test(name)) {
      const base = name.replace(re, ' ').replace(/[-:()]/g, ' ').replace(/\s+/g, ' ').trim();
      return { period, base };
    }
  }
  return { period: null, base: name };
}

// 'H1' | 'H2' | null. A name that mentions both halves ("1st half / 2nd half")
// is ambiguous and returns null rather than being closed by guess.
export function marketPeriod(marketName) {
  const n = normMarketText(marketName);
  if (!n) return null;
  const first = FIRST_HALF_RE.test(n);
  const second = SECOND_HALF_RE.test(n);
  if (first && !second) return 'H1';
  if (second && !first) return 'H2';
  return null;
}

// Provider live status codes that can only occur AFTER the first half
// (see utils/liveStatus.ts and server/oddsUtils.js estimateLiveMinute).
const PAST_FIRST_HALF_STATUSES = new Set([
  'HT', 'HALFTIME', 'HALF_TIME', 'PAUSED',
  '2H', 'SECOND_HALF',
  'ET', 'EXTRA_TIME', 'PEN', 'PENALTIES',
  'FT', 'AET', 'ENDED', 'FINISHED',
]);

// A sane match clock is at most ~130 minutes. A bare integer above that is the
// provider's seconds counter ("1776" = 29:36), not minutes (same rule as the
// client's parseLiveClock). Returns the whole minute, or null if unusable.
const MAX_SANE_MINUTE = 130;
export function minuteOf(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    const minutes = n > MAX_SANE_MINUTE ? Math.floor(n / 60) : n;
    return minutes > MAX_SANE_MINUTE ? null : minutes;
  }
  const m = s.match(/^(\d+)(?::\d{1,2})?\+?/);
  if (!m) return null;
  const minutes = Number(m[1]);
  return minutes > MAX_SANE_MINUTE ? null : minutes;
}

// Wall-clock limits (minutes since kickoff). The first half, even with long
// stoppage time, is over well before 60 minutes of real time have passed. With
// no live data at all, 50 minutes after kickoff is already past it.
const FIRST_HALF_MAX_WALL_MIN = 60;
const FIRST_HALF_NO_DATA_WALL_MIN = 50;

// Has the first half of this match (a matches_cache row) already ended?
// Never relies on a single signal: the live status, the clock minute and the
// wall clock all count, so a stuck feed cannot keep first-half markets open.
export function isPastFirstHalf(row, now = Date.now()) {
  if (!row) return false;
  const kickoff = Date.parse(row.start_time);
  if (!Number.isFinite(kickoff) || kickoff > now) return false; // not started yet
  if (row.status === 'FINISHED') return true;
  const raw = String(row.live_status ?? '').toUpperCase().trim();
  if (PAST_FIRST_HALF_STATUSES.has(raw)) return true;
  const minute = minuteOf(row.live_minute);
  if (minute != null && minute >= 46) return true;
  const elapsedMin = (now - kickoff) / 60000;
  if (elapsedMin >= FIRST_HALF_MAX_WALL_MIN) return true;
  if (!raw && minute == null && elapsedMin >= FIRST_HALF_NO_DATA_WALL_MIN) return true;
  return false;
}

// Why a market of this match no longer accepts bets, or null if it still does.
//   MATCH_FINISHED   the match is over -> every market is closed
//   FIRST_HALF_OVER  a first-half market after the first half
export function getMarketClosedReason(row, marketName, now = Date.now()) {
  if (!row) return null;
  if (row.status === 'FINISHED') return 'MATCH_FINISHED';
  if (marketPeriod(marketName) === 'H1' && isPastFirstHalf(row, now)) return 'FIRST_HALF_OVER';
  return null;
}
