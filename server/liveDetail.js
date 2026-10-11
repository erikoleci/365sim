// Builds the `statistics` object of GET /api/matches/:id/live-detail.
//
// Two sources exist:
//   * live_statistics (statsRow): possession/shots/corners/cards counters + a coarse minute,
//     refreshed only when the live-detail feed delivers for this match.
//   * matches_cache (cache): the provider's REAL clock string ("75:39") with its server stamp, and
//     the live score -- refreshed by every REST cycle / derived-clock write.
//
// Rules (each one fixes a way the detail page lost its score/minute):
//   1. The clock is ALWAYS the cache's clock + the cache's stamp as a pair. Before, the stats
//      table's integer minute (maybe 60s old, no seconds) was paired with the cache stamp, so the
//      clock started from the wrong second ("72:00" while the provider said 75:39).
//   2. The score is the cache's score when the cache has one.
//   3. A stale stats table (> staleMs without a write while LIVE) only drops the TABLE-ONLY
//      counters; it no longer throws away the minute and score as well (it used to return null,
//      so a match whose detail feed was quiet showed no minute or score on the detail page).
const TABLE_ONLY = [
  'possession_home', 'possession_away', 'shots_home', 'shots_away', 'shots_on_target_home', 'shots_on_target_away',
  'corners_home', 'corners_away', 'cards_home', 'cards_away', 'xg_home', 'xg_away',
];

export function buildLiveStatistics(statsRow, cache, now = Date.now(), staleMs = 60000) {
  const updatedAt = statsRow ? Number(statsRow.updated_at) : null;
  const statsStale = !!cache && cache.status === 'LIVE' && updatedAt != null && now - updatedAt > staleMs;
  if (!cache) return statsRow && !statsStale ? statsRow : null;

  const out = statsRow && !statsStale
    ? { ...statsRow }
    : { minute: null, home_score: null, away_score: null, ...Object.fromEntries(TABLE_ONLY.map((k) => [k, null])) };

  const rawClock = String(cache.live_minute || '').trim();
  const m = rawClock.match(/^(\d+)/);
  const stamped = rawClock && cache.live_minute_updated_at != null;
  if (stamped && m) {
    out.minute = Number(m[1]);
    out.clock = rawClock;
    out.minuteUpdatedAt = Number(cache.live_minute_updated_at);
  } else if (out.minute == null && m) {
    out.minute = Number(m[1]); // unstamped: a minute only, the client must not tick seconds from it
  }
  if (cache.live_home_score != null && cache.live_away_score != null) {
    out.home_score = cache.live_home_score;
    out.away_score = cache.live_away_score;
  }
  return out;
}
