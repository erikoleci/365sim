import pool from './db.js';
import { minuteToNumber } from './london365/clock.js';

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
    // Corner / card counters at the whistle are stored with the score (same first-write-wins
    // guard). If the columns do not exist yet (migration not applied) or the stats lookup
    // fails, the score is still stored on its own.
    try {
      await pool.query(
        `UPDATE matches_cache SET ht_home = $2, ht_away = $3,
                ht_corners_home = (SELECT corners_home FROM live_statistics WHERE match_id = $1),
                ht_corners_away = (SELECT corners_away FROM live_statistics WHERE match_id = $1),
                ht_cards_home = (SELECT cards_home FROM live_statistics WHERE match_id = $1),
                ht_cards_away = (SELECT cards_away FROM live_statistics WHERE match_id = $1),
                ht_red_home = (SELECT red_home FROM live_statistics WHERE match_id = $1),
                ht_red_away = (SELECT red_away FROM live_statistics WHERE match_id = $1)
          WHERE id = $1 AND ht_home IS NULL`,
        [matchId, home, away]
      );
    } catch {
      await pool.query(
        'UPDATE matches_cache SET ht_home = $2, ht_away = $3 WHERE id = $1 AND ht_home IS NULL',
        [matchId, home, away]
      );
    }
  } catch (err) {
    captured.delete(matchId); // retry on the next HT tick
    console.error('[halftime] failed to store half-time score for ' + matchId + ':', err.message);
  }
}

// Score at the end of regular time: the first reading while the match is in extra time. Extra time
// has not added a goal yet at that moment, so this is the 90-minute score. First write wins.
const rtCaptured = new Set();
export function __resetRegularTimeCaptureForTests() { rtCaptured.clear(); }
export async function captureRegularTimeScore(matchId, home, away) {
  if (!matchId || rtCaptured.has(matchId)) return;
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) return;
  if (rtCaptured.size >= CAPTURED_CAP) rtCaptured.clear();
  rtCaptured.add(matchId);
  try {
    await pool.query('UPDATE matches_cache SET rt_home = $2, rt_away = $3 WHERE id = $1 AND rt_home IS NULL', [matchId, home, away]);
  } catch (err) {
    rtCaptured.delete(matchId); // retry on the next extra-time tick
    console.error('[regular-time] failed to store the 90-minute score for ' + matchId + ':', err.message);
  }
}

// Fallback for matches whose feed never reports the half-time status (small leagues): the first-half score is rebuilt from
// the goal log, but ONLY when it is certain: the log adds up exactly to the live score, every goal has a minute, and no
// goal sits near the break (44'-52'), where "first half stoppage time" and "second half" cannot be told apart.
export function halfTimeFromGoalLog(goals, homeTeam, awayTeam, homeScore, awayScore) {
  const list = Array.isArray(goals) ? goals : [];
  let h = 0, a = 0, ht = 0, hta = 0;
  for (const g of list) {
    const m = g.minute == null ? null : Number(g.minute);
    if (m == null || !Number.isFinite(m)) return null;
    if (m >= 44 && m <= 52) return null;
    const home = g.team === homeTeam, away = g.team === awayTeam;
    if (!home && !away) return null;
    if (home) { h++; if (m < 44) ht++; } else { a++; if (m < 44) hta++; }
  }
  if (h !== Number(homeScore) || a !== Number(awayScore)) return null;
  return { home: ht, away: hta };
}

export async function captureHalfTimeFromGoalLog({ now = Date.now() } = {}) {
  const { rows } = await pool.query(
    `SELECT m.id, m.home_team, m.away_team, m.live_home_score, m.live_away_score, m.live_minute, m.start_time FROM matches_cache m
      WHERE m.status = 'LIVE' AND m.ht_home IS NULL AND m.live_home_score IS NOT NULL AND m.live_away_score IS NOT NULL
        AND EXISTS (SELECT 1 FROM bet_selections bs WHERE bs.match_id = m.id AND bs.status = 'PENDING')`);
  let captured = 0;
  for (const m of rows) {
    const minute = minuteToNumber(m.live_minute);
    const sinceKickoff = now - Date.parse(m.start_time);
    if (!Number.isFinite(minute) || minute < 60 || !(sinceKickoff >= 75 * 60000)) continue; // clearly into the second half, in game time AND wall time
    const { rows: goals } = await pool.query("SELECT team, minute FROM match_events WHERE match_id = $1 AND type = 'GOAL'", [m.id]);
    const ht = halfTimeFromGoalLog(goals, m.home_team, m.away_team, m.live_home_score, m.live_away_score);
    if (!ht) continue;
    await captureHalfTimeScore(m.id, ht.home, ht.away);
    captured++;
  }
  return { captured };
}
