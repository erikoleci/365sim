// Dates, scores and the match clock as the provider reports them.

// Converts a naive "YYYY-MM-DDTHH:mm:ss" wall-clock time that's ALREADY in
// the given IANA zone into the correct UTC Date, accounting for DST on that
// exact date. Standard library-free technique: format a first UTC guess
// back through the target zone, then correct by however far off that
// round-trip landed.
export function zonedWallTimeToUtc(y, mo, d, h, mi, s, timeZone) {
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, s);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = {};
  for (const p of dtf.formatToParts(new Date(utcGuess))) parts[p.type] = p.value;
  const asIfUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(utcGuess + (utcGuess - asIfUtc));
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
  const hasExplicitZone = /[zZ]$/.test(iso) || /[+-]\d{2}:\d{2}$/.test(iso);
  if (!hasExplicitZone && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) iso += ':00';
  const m = !hasExplicitZone && iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  let d;
  if (m) {
    // FIX (2026-09-18): naive provider timestamps were previously treated
    // as already being UTC (just appending "Z"), which was wrong — this
    // feed's kickoff times are the provider's own Central European
    // wall-clock time (matching Europe/Tirane's CET/CEST, same EU DST
    // rules), not UTC. Blindly appending "Z" put every kickoff exactly
    // one DST-offset (1-2 hours depending on season) too LATE once
    // displayed back in Albania local time (e.g. a real 21:00 kickoff
    // showing as 23:00). Convert from that wall-clock zone properly,
    // DST-aware, instead of assuming UTC.
    d = zonedWallTimeToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6], 'Europe/Tirane');
  } else {
    d = new Date(iso);
  }
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
export function parseScore(result) {
  const m = String(result || '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
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
// Some feeds give the clock as bare SECONDS ("1776" = 29:36). A bare integer
// above 130 can't be a minute, so convert it to "mm:ss".
// A SANE match clock, under either reading, is at most ~130 minutes (90 +
// stoppage + 30 extra time + its stoppage). A bare integer that is STILL over
// 130 minutes once divided by 60 isn't a clock at all under either reading
// (seen in production: a sentinel/placeholder value like "300924" during an
// unusual match state, which the old code turned into the nonsense "5015:24"
// instead of recognising it as not-a-clock). Such a value is now discarded
// (treated as "no minute available") rather than displayed.
export const MAX_SANE_MATCH_MINUTES = 130;
export function normalizeLiveMinute(minute) {
  if (minute == null || minute === '') return minute ?? null;
  const str = String(minute).trim();
  if (/^\d+$/.test(str) && Number(str) > MAX_SANE_MATCH_MINUTES) {
    const t = Number(str);
    const mins = Math.floor(t / 60);
    if (mins > MAX_SANE_MATCH_MINUTES) return null; // not a clock under either reading
    return mins + ':' + String(t % 60).padStart(2, '0');
  }
  return str;
}
// Convert a provider minute like "48:37" or "72" into a match minute number.
export function minuteToNumber(minute) {
  if (!minute) return null;
  const m = String(normalizeLiveMinute(minute)).match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}
// Minute number to STORE for an event (goal/card/corner). The provider labels
// an event by the minute in progress, so a clock reading 84:30 is the 85th
// minute and its list shows 85' (confirmed on a real match: provider 85' /
// 80' where we stored 84 / 79 by dropping the seconds). A plain "mm" value
// has no seconds to go by, so it is kept as is.
export function eventMinuteFromClock(minute) {
  if (!minute) return null;
  minute = normalizeLiveMinute(minute);
  const m = String(minute).match(/^(\d+):\d+/);
  if (m) return Number(m[1]) + 1;
  return minuteToNumber(minute);
}
