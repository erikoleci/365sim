import pool from './db.js';

// The live clock of each match is persisted every ~15s. One UPDATE per match meant
// N/15 queries per second (awaited in the message path) -- hundreds per second with
// hundreds of live matches, against a pool of 7 connections. Instead the newest
// value per match is queued and flushed as batched UPDATEs, so the cost is a
// handful of queries per flush however many matches are live.
const pending = new Map(); // matchId -> { minute, at }
const CHUNK = 500;

export function queueClockWrite(matchId, minute, at = Date.now()) {
  pending.set(matchId, { minute, at });
}

export function pendingClockWrites() {
  return pending.size;
}

export function __resetClockWritesForTests() {
  pending.clear();
}

export async function flushClockWrites() {
  if (pending.size === 0) return 0;
  const batch = Array.from(pending.entries());
  pending.clear();
  let written = 0;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const chunk = batch.slice(i, i + CHUNK);
    try {
      await pool.query(
        `UPDATE matches_cache AS m
            SET live_minute = v.minute, live_minute_updated_at = v.at
           FROM unnest($1::text[], $2::text[], $3::bigint[]) AS v(id, minute, at)
          WHERE m.id = v.id`,
        [chunk.map(([id]) => id), chunk.map(([, c]) => c.minute), chunk.map(([, c]) => c.at)]
      );
      written += chunk.length;
    } catch (err) {
      // Put the chunk back (unless a newer value was queued meanwhile) and retry next flush.
      for (const [id, c] of chunk) if (!pending.has(id)) pending.set(id, c);
      console.error('[clock] batched live-clock write failed, will retry:', err.message);
      break;
    }
  }
  return written;
}

let timer = null;
export function startClockWriteFlusher(intervalMs = 3000) {
  if (timer) return;
  timer = setInterval(() => { flushClockWrites().catch(() => {}); }, intervalMs);
  timer.unref?.();
}
