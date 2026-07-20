// The audience is in Albania, so match times must always show in Albania
// local time (Europe/Tirane) — not whatever timezone the visitor's device
// happens to be set to. Using Intl with an explicit timeZone avoids relying
// on the browser's default, which is what was causing times to look wrong.

const TZ = 'Europe/Tirane';

// "HH:MM" for a match's kickoff time, in Albania time.
export function formatMatchTime(iso: string): string {
  return new Intl.DateTimeFormat('sq-AL', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

// "D/M" for a match's kickoff date, in Albania time.
export function formatMatchDayMonth(iso: string): string {
  return new Intl.DateTimeFormat('sq-AL', {
    timeZone: TZ,
    day: 'numeric',
    month: 'numeric',
  }).format(new Date(iso));
}

// Local calendar-date key "YYYY-MM-DD" in Albania time, for grouping/filtering
// by day (e.g. matching the date-picker strip) regardless of visitor timezone.
export function albaniaDateKey(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

// Same as albaniaDateKey but for "now" (or an arbitrary offset in days from now).
export function albaniaTodayKey(daysFromNow = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return albaniaDateKey(d.toISOString());
}

export function isSameAlbaniaDay(iso: string, dateKey: string): boolean {
  return albaniaDateKey(iso) === dateKey;
}
