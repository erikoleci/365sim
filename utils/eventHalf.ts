// Half of a match event. The minute label alone is ambiguous: a corner in first-half stoppage time
// (clock 46:xx, shown as 45+2') and a second-half event at 46' both carry the label 46-47. The
// server stores the half from the match status when the event was logged (`half`); the minute is
// only the fallback for older rows without it.
export interface HalfEvent { minute: number | null; half?: number | null }

export const isFirstHalfEvent = (e: HalfEvent): boolean =>
  e.half != null ? e.half === 1 : e.minute != null && e.minute <= 45;

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
  const inFirstHalf = /^(1H|FIRST)/i.test(String(ctx.liveStatus ?? ''));
  const reachedSecondHalf = ctx.halftime || ctx.finished || events.some(isSecondHalfEvent)
    // the minute alone says "second half" only when the status does not say we are still in the first
    || (!inFirstHalf && Number.isFinite(ctx.minuteNow) && ctx.minuteNow > 45);
  if (!reachedSecondHalf || !events.some(isFirstHalfEvent)) return null;
  const idx = events.findIndex(isSecondHalfEvent);
  return idx === -1 ? events.length : idx;
}
