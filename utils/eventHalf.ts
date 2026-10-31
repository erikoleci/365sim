// Half of a match event. The minute label alone is ambiguous: a corner in first-half stoppage time
// (clock 46:xx, shown as 45+2') and a second-half event at 46' both carry the label 46-47. The
// server stores the half from the match status when the event was logged (`half`); the minute is
// only the fallback for older rows without it.
export interface HalfEvent { minute: number | null; half?: number | null }

export const isFirstHalfEvent = (e: HalfEvent): boolean =>
  e.half != null ? e.half === 1 : e.minute != null && e.minute <= 45;

// half = 3: extra time (the provider status ET); its two halves are not told apart.
export const isExtraTimeEvent = (e: HalfEvent): boolean => e.half === 3;

export const isSecondHalfEvent = (e: HalfEvent): boolean =>
  e.half != null ? e.half === 2 : e.minute != null && e.minute > 45;

// "45+2'" for first-half stoppage time, "90+3'" for second-half, otherwise "12'".
export function eventMinuteLabel(e: HalfEvent): string {
  if (e.minute == null) return '-';
  if (e.half === 1 && e.minute > 45) return `45+${e.minute - 45}'`;
  if (e.half === 2 && e.minute > 90) return `90+${e.minute - 90}'`;
  return `${e.minute}'`;
}

// Index in the events list where "Fundi i pjesës së parë" goes: before the first second-half
// event, or at the end when the match has reached the second half / finished but nothing has
// happened after the break yet. null while the first half is still being played.
export function firstHalfDividerIndex(
  events: HalfEvent[],
  ctx: { halftime: boolean; finished: boolean; minuteNow: number; liveStatus?: string | null },
): number | null {
  // The minute alone NEVER ends the first half: with 6+ minutes of stoppage the clock reads 46:59
  // while the first half is still being played, and the status may not even say "1H" at that moment.
  // The divider appears only when the break is real (HT), the match is over, a second-half / extra-time
  // event exists, or the provider status itself says second half / extra time.
  const inSecondHalfStatus = /^(2H|SECOND|ET|EXTRA)/i.test(String(ctx.liveStatus ?? ''));
  const reachedSecondHalf = ctx.halftime || ctx.finished || inSecondHalfStatus
    || events.some(isSecondHalfEvent) || events.some(isExtraTimeEvent);
  if (!reachedSecondHalf || !events.some(isFirstHalfEvent)) return null;
  const idx = events.findIndex((e) => isSecondHalfEvent(e) || isExtraTimeEvent(e));
  return idx === -1 ? events.length : idx;
}

// Index where "Fundi i kohës rregullt" goes: before the first extra-time event (null if there is none).
export function regularTimeDividerIndex(events: HalfEvent[]): number | null {
  const idx = events.findIndex(isExtraTimeEvent);
  return idx === -1 ? null : idx;
}
