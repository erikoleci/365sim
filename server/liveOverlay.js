// What a browser gets when it OPENS the page (GET /matches/live) must be what the websocket would
// have told it a moment ago. The database row carries the clock as of the last batched write
// (up to ~15 s old, stamped); the newest tick of the match lives in memory (london365GameDetails
// lastBroadcast). Laying the tick over the row means the minute, the seconds, the score and the
// half-time status are right from the very first paint, with no refresh and no waiting for the
// next socket message.
export const OVERLAY_MAX_AGE_MS = 30_000;

// "46:59" -> 2819; a bare minute "46" -> 2760 (the lowest the seconds can be); anything else -> null.
function clockSeconds(minute) {
  const m = String(minute ?? '').trim().match(/^(\d+)(?::(\d{1,2}))?$/);
  return m ? Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0) : null;
}

export function overlayLiveTick(row, tick, now = Date.now()) {
  if (!row || !tick || tick.minute == null || tick.minuteUpdatedAt == null) return row;
  if (!Number.isFinite(tick.ts) || now - tick.ts > OVERLAY_MAX_AGE_MS) return row;
  // Never go backwards: a row stamped later than the tick already has newer data -- but only if its CLOCK is
  // really further on. The slower REST sync writes its (older) minute with a fresh stamp; that row is "newer"
  // by stamp only, and serving it made every clock jump back by the age of that minute.
  const stamp = row.live_minute_updated_at != null ? Number(row.live_minute_updated_at) : 0;
  if (stamp > Number(tick.minuteUpdatedAt)) {
    const rowNow = clockSeconds(row.live_minute);
    const tickNow = clockSeconds(tick.minute);
    if (rowNow == null || tickNow == null) return row;
    const rowProjected = rowNow + (now - stamp) / 1000;
    const tickProjected = tickNow + (now - Number(tick.minuteUpdatedAt)) / 1000;
    if (rowProjected >= tickProjected - 1) return row;
  }
  return {
    ...row,
    live_minute: String(tick.minute),
    live_minute_updated_at: Number(tick.minuteUpdatedAt),
    live_status: tick.liveStatus !== undefined ? tick.liveStatus : row.live_status,
    live_home_score: tick.homeScore ?? row.live_home_score,
    live_away_score: tick.awayScore ?? row.live_away_score,
  };
}
