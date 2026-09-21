// Lightweight in-memory counters for the London365 feed -> Neon pipeline.
//
// Purpose: turn "what is costing us DB usage?" from guesswork into numbers.
// Every counter is a plain integer bumped in the hot path (no DB, no I/O).
// A snapshot is logged every FEED_STATS_LOG_INTERVAL_MS (default 10 min) as a
// single `[feed-stats]` line and reset, and the current window is also
// exposed through getLondon365Status() (GET /api/london365-status).
//
// Counter names used today:
//   upsert.inserted / upsert.written / upsert.skipped_unchanged
//   oddsHistory.rows_written / oddsHistory.rows_skipped
//   coefs.received / coefs.dropped_untracked / coefs.changed
//   gamedetails.received / gamedetails.dropped_untracked
//   gamedetails.row_cache_hit / gamedetails.row_select
//   endDetection.skipped_idle / endDetection.ran
//   repair.skipped_idle / repair.ran
//   kv.cursor_skipped / import.throttle_memo_hit

const counters = new Map();
let windowStartedAt = Date.now();
let timer = null;

export function bump(name, n = 1) {
  counters.set(name, (counters.get(name) || 0) + n);
}

export function snapshot() {
  const out = {};
  for (const [k, v] of counters) out[k] = v;
  return { windowStartedAt, windowMs: Date.now() - windowStartedAt, counters: out };
}

export function snapshotAndReset() {
  const snap = snapshot();
  counters.clear();
  windowStartedAt = Date.now();
  return snap;
}

export function startFeedStatsLog(intervalMs = Number(process.env.FEED_STATS_LOG_INTERVAL_MS || 10 * 60 * 1000)) {
  if (timer) return timer;
  timer = setInterval(() => {
    const snap = snapshotAndReset();
    console.log('[feed-stats] last ' + Math.round(snap.windowMs / 1000) + 's ' + JSON.stringify(snap.counters));
  }, Math.max(60 * 1000, intervalMs));
  if (timer.unref) timer.unref();
  return timer;
}

export function __resetFeedStatsForTests() {
  counters.clear();
  windowStartedAt = Date.now();
}
