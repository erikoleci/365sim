import pool from './db.js';

// Captures the score at half time, once per match. Called from both live paths
// (REST sync when the provider says HT, and the gamedetails socket on VC 1015).
// A half-time whistle means the score cannot change until the second half, so
// the first reading while at HT is the half-time score. First write wins
// (`ht_home IS NULL`): later HT ticks and the other path are no-ops, and the
// in-memory set keeps the ~1/sec HT ticks from touching the database at all.
const captured = new Set();
const CAPTURED_CAP = 5000;

export function __resetHalfTimeCaptureForTests() {
  captured.clear();
}

export async function captureHalfTimeScore(matchId, home, away) {
  if (!matchId || captured.has(matchId)) return;
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) return;
  if (captured.size >= CAPTURED_CAP) captured.clear();
  captured.add(matchId);
  try {
    await pool.query(
      'UPDATE matches_cache SET ht_home = $2, ht_away = $3 WHERE id = $1 AND ht_home IS NULL',
      [matchId, home, away]
    );
  } catch (err) {
    captured.delete(matchId); // retry on the next HT tick
    console.error('[halftime] failed to store half-time score for ' + matchId + ':', err.message);
  }
}
