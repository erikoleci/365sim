// GET /api/matches/live-health -- one cheap answer to "is the live feed working right now?".
// Counts only (no names, no credentials). Input rows: matches that kicked off in the last 8h and
// are not FINISHED (id, live_minute, live_minute_updated_at, live_home_score).
export function summarizeLiveHealth(rows, now = Date.now()) {
  const STALE_MS = 150 * 1000; // a provider reading older than this is reported as stale
  let withClock = 0;
  let withScore = 0;
  let stale = 0;
  let newest = null;
  const ghostIds = [];
  for (const r of rows) {
    const stamp = r.live_minute_updated_at != null ? Number(r.live_minute_updated_at) : null;
    const hasClock = !!r.live_minute && stamp != null;
    if (hasClock) {
      withClock++;
      if (now - stamp > STALE_MS) stale++;
      if (newest == null || stamp > newest) newest = stamp;
    } else if (ghostIds.length < 20) {
      ghostIds.push(r.id);
    }
    if (r.live_home_score != null && r.live_away_score != null) withScore++;
  }
  const verdict = rows.length === 0 ? 'no live matches'
    : withClock === 0 ? 'PROBLEM: live matches exist but none has a provider clock (feed not delivering)'
    : newest != null && now - newest > STALE_MS * 2 ? 'PROBLEM: the newest provider clock is old (feed stopped?)'
    : 'ok';
  return {
    verdict,
    liveRows: rows.length,
    withProviderClock: withClock,
    withoutProviderClock: rows.length - withClock,
    withScore,
    clockOlderThan150s: stale,
    newestClockAgeSeconds: newest == null ? null : Math.round((now - newest) / 1000),
    sampleWithoutClock: ghostIds,
  };
}
