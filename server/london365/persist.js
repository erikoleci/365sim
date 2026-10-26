// Writing matches to the database: skip-unchanged upserts, per-key write locks, goal recording.
import { halfSql } from '../eventHalf.js';
import pool from '../db.js';
import { clearGoalAnnounced, announceGoalIfChanged } from '../goalAnnouncer.js';
import { diffOddsChanges } from '../oddsUtils.js';
import { shouldRecordOddsHistory } from '../oddsHistoryPolicy.js';
import { bump } from '../feedStats.js';
import { pushOddsChanged } from '../ws.js';
import { trackGame, noteMatchStatus, setLiveRow } from '../liveTracker.js';
import { captureHalfTimeScore, captureRegularTimeScore } from '../halfTime.js';
import { isHalfTimeLatched } from '../halfTimeLatch.js';
import { createStatusSampler } from '../liveStatusSampler.js';
import { countOutcomes, mergeEvents, isSparseEvent } from './markets.js';
import { eventMinuteFromClock } from './clock.js';

// Write-avoidance (LONDON365_SKIP_UNCHANGED_WRITES, default on): the UPSERT below
// always changed `fetched_at`, so EVERY call -- every 30s per live match from
// the REST loop, every match on every prematch import -- rewrote the whole
// row including its 9-30KB raw_json even when nothing had moved. When the row
// we just read is already identical to what would be written we skip the
// statement, but still write a heartbeat (fetched_at) at most every
// WRITE_HEARTBEAT_MS so the "not updated for 8+ minutes => stale" rule in
// syncLondon365Live and the repair pass's fetched_at ordering keep working.
// Heartbeat is clamped to <= 5 min, safely under that 8 minute threshold.
export const SKIP_UNCHANGED_WRITES = (process.env.LONDON365_SKIP_UNCHANGED_WRITES || '1') === '1';
export const WRITE_HEARTBEAT_MS = Math.min(5 * 60 * 1000, Math.max(30 * 1000, Number(process.env.LONDON365_WRITE_HEARTBEAT_MS || 4 * 60 * 1000)));
export const sameVal = (a, b) => (a ?? null) === (b ?? null);
// The repair pass only needs to hit the DB when some non-finished event is
// (or might be) sparse. Starts true so the first pass after boot always looks.
export let repairNeeded = true;
export function setRepairNeeded(value) { repairNeeded = value; }
export async function upsertMatch(ev, league, status, liveScores, liveInfo, leagueMeta) {
  return withDbLock(ev.id, async () => {
    const now = Date.now();
    const { rows } = await pool.query(
      'SELECT raw_json, status, live_home_score, live_away_score, live_minute, home_team, away_team, league, league_id, country_id, start_time, live_status, fetched_at FROM matches_cache WHERE id = $1',
      [ev.id]
    );
    let existing = rows[0];

    // Defends against the provider reusing an id (EID) for a LATER,
    // unrelated real-world match once the earlier one is done with it —
    // production data has shown this happening (see the T-field comment in
    // london365GameDetails.js: same EID, score AND the per-EID counter both
    // went backwards over time, which a genuine correction to the SAME
    // match cannot do). Detected conservatively: the two teams playing are
    // a fact that cannot change mid-match, so if the incoming event's team
    // names don't match what's on record for this id, treat it as a fresh
    // match rather than a continuation. This matters most for a match we'd
    // previously marked FINISHED: the UPSERT below has a "status can never
    // leave FINISHED" guard (so a stray late update can't un-finish an
    // already-settled match) — without this check, that guard would also
    // permanently trap a genuinely NEW live match under a reused id at
    // status=FINISHED forever, since it inherits the old match's row.
    const isDifferentMatch = existing && ev.home_team && ev.away_team
      && (existing.home_team !== ev.home_team || existing.away_team !== ev.away_team);
    if (isDifferentMatch) {
      console.warn(
        `[london365] id ${ev.id} now reports different teams (` +
        `was "${existing.home_team}" vs "${existing.away_team}", ` +
        `now "${ev.home_team}" vs "${ev.away_team}") — treating as a reused id / new match, ` +
        `not a continuation of the old one`
      );
      existing = undefined;
      clearGoalAnnounced(ev.id);
    }

    let rawToStore = JSON.stringify(ev);
    if (existing) {
      try {
        const oldEv = JSON.parse(existing.raw_json);
        const oldCount = countOutcomes(oldEv);
        const newCount = countOutcomes(ev);
        // Live/socket payloads only carry the main markets. Instead of
        // discarding them (old behavior) or letting them clobber the full
        // catalog, merge them into the cached event: prices update for the
        // markets they carry, every other market and coefficient survives.
        let effective = ev;
        if (oldCount && Math.sign(newCount - oldCount) === -1) effective = mergeEvents(oldEv, ev);
        rawToStore = JSON.stringify(effective);
        const changes = diffOddsChanges(ev.id, oldEv, effective);
        if (changes.length) {
          // odds_history is only worth its writes for matches somebody has
          // bet on (see oddsHistoryPolicy.js). The WS push below is
          // independent of it and always fires.
          if (shouldRecordOddsHistory(ev.id)) {
            for (const c of changes) {
              await pool.query(
                `INSERT INTO odds_history (match_id, market_id, selection_id, old_odds, new_odds, changed_by, reason, created_at)
                 VALUES ($1,$2,$3,$4,$5,'SYSTEM','london365_refresh',$6)`,
                [c.matchId, c.marketId, c.selectionId, c.oldOdds, c.newOdds, now]
              );
            }
            bump('oddsHistory.rows_written', changes.length);
          } else {
            bump('oddsHistory.rows_skipped', changes.length);
          }
          pushOddsChanged(ev.id, { changes: changes });
        }
      } catch (err) {
        console.error('[london365] odds diff failed for ' + ev.id + ':', err.message);
      }
    }

    const incomingLeagueId = leagueMeta && leagueMeta.id != null ? String(leagueMeta.id) : null;
    const incomingCountryId = leagueMeta && leagueMeta.countryId != null ? String(leagueMeta.countryId) : null;
    const inHome = liveScores ? liveScores.home : null;
    const inAway = liveScores ? liveScores.away : null;
    const inMinute = liveInfo && liveInfo.minute ? liveInfo.minute : null;
    // While the gamedetails feed says the break is on (VC=1015 latch), the provider's numeric api_status
    // must not overwrite HT, or clients would see the clock running again during the break.
    const inLiveStatus = isHalfTimeLatched(ev.id) ? 'HT' : (liveInfo && liveInfo.apiStatus != null ? String(liveInfo.apiStatus) : null);

    // Effective post-write values, mirroring the UPSERT's CASE/COALESCE rules
    // exactly (a different-match/reused id has `existing` cleared above, so
    // it always takes the plain "incoming" branch).
    const eff = existing
      ? {
          status: existing.status === 'FINISHED' ? existing.status : status,
          league: league === '' ? existing.league : league,
          league_id: incomingLeagueId ?? existing.league_id,
          country_id: incomingCountryId ?? existing.country_id,
          live_home_score: inHome ?? existing.live_home_score,
          live_away_score: inAway ?? existing.live_away_score,
          live_minute: inMinute ?? existing.live_minute,
          live_status: inLiveStatus ?? existing.live_status,
        }
      : {
          status, league, league_id: incomingLeagueId, country_id: incomingCountryId,
          live_home_score: inHome, live_away_score: inAway, live_minute: inMinute, live_status: inLiveStatus,
        };

    const unchanged = SKIP_UNCHANGED_WRITES && existing
      && existing.raw_json === rawToStore
      && existing.home_team === ev.home_team
      && existing.away_team === ev.away_team
      && existing.start_time === ev.commence_time
      && existing.status === eff.status
      && sameVal(existing.league, eff.league)
      && sameVal(existing.league_id, eff.league_id)
      && sameVal(existing.country_id, eff.country_id)
      && sameVal(existing.live_home_score, eff.live_home_score)
      && sameVal(existing.live_away_score, eff.live_away_score)
      && sameVal(existing.live_minute, eff.live_minute)
      && sameVal(existing.live_status, eff.live_status)
      && now - Number(existing.fetched_at) < WRITE_HEARTBEAT_MS; // NaN (no fetched_at) => false => write

    if (unchanged) {
      bump('upsert.skipped_unchanged');
    } else {
      bump(existing ? 'upsert.written' : 'upsert.inserted');
      await pool.query(
        `INSERT INTO matches_cache (id, league, league_id, country_id, home_team, away_team, start_time, status, raw_json, fetched_at, live_home_score, live_away_score, live_minute, live_status, live_minute_updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text,$14,(CASE WHEN $13::text IS NULL THEN NULL ELSE $16::bigint END))
         ON CONFLICT (id) DO UPDATE SET
           league = CASE WHEN excluded.league = '' THEN matches_cache.league ELSE excluded.league END,
           -- COALESCE, not overwrite: not every upsert path resolves a
           -- league_id/country_id (e.g. the repair pass and any live update
           -- that only had a raw name to go on) -- a call that legitimately
           -- doesn't know these must never blank out a value an earlier,
           -- better-informed call already established for this match.
           league_id = COALESCE(excluded.league_id, matches_cache.league_id),
           country_id = COALESCE(excluded.country_id, matches_cache.country_id),
           home_team = excluded.home_team,
           away_team = excluded.away_team,
           start_time = excluded.start_time,
           status = CASE WHEN $15 THEN excluded.status
                         WHEN matches_cache.status = 'FINISHED' THEN matches_cache.status
                         ELSE excluded.status END,
           raw_json = excluded.raw_json,
           fetched_at = excluded.fetched_at,
           live_home_score = CASE WHEN $15 THEN excluded.live_home_score
                                   ELSE COALESCE(excluded.live_home_score, matches_cache.live_home_score) END,
           live_away_score = CASE WHEN $15 THEN excluded.live_away_score
                                   ELSE COALESCE(excluded.live_away_score, matches_cache.live_away_score) END,
           live_minute = CASE WHEN $15 THEN excluded.live_minute
                               ELSE COALESCE(excluded.live_minute, matches_cache.live_minute) END,
           live_status = CASE WHEN $15 THEN excluded.live_status
                               ELSE COALESCE(excluded.live_status, matches_cache.live_status) END,
           -- Only bump the reference timestamp when the EFFECTIVE
           -- live_minute value is actually changing (IS DISTINCT FROM
           -- handles NULLs correctly, unlike =). If this poll didn't move
           -- the minute forward (or a different-match reset just cleared
           -- it), the previous reading is still the true "as of" time —
           -- overwriting it here would make the client-side clock jump
           -- forward for no reason.
           live_minute_updated_at = CASE
             WHEN $15 AND excluded.live_minute IS DISTINCT FROM matches_cache.live_minute THEN excluded.fetched_at
             WHEN NOT $15 AND COALESCE(excluded.live_minute, matches_cache.live_minute) IS DISTINCT FROM matches_cache.live_minute
               THEN excluded.fetched_at
             ELSE matches_cache.live_minute_updated_at
           END`,
        [
          ev.id, league, incomingLeagueId, incomingCountryId,
          ev.home_team, ev.away_team, ev.commence_time, status,
          rawToStore, now,
          inHome, inAway, inMinute, inLiveStatus,
          Boolean(isDifferentMatch), now,
        ]
      );
    }

    // Keep the in-memory view in step with what the row now holds.
    trackGame(ev.id);
    noteMatchStatus(ev.id, eff.status);
    if (String(eff.live_status || '').toUpperCase() === 'HT') captureHalfTimeScore(ev.id, eff.live_home_score, eff.live_away_score);
    if (['ET', 'EXTRA_TIME'].includes(String(eff.live_status || '').toUpperCase())) captureRegularTimeScore(ev.id, eff.live_home_score, eff.live_away_score);
    setLiveRow(ev.id, {
      home_team: ev.home_team, away_team: ev.away_team,
      live_home_score: eff.live_home_score, live_away_score: eff.live_away_score, live_minute: eff.live_minute,
      live_status: eff.live_status,
    });
    if (eff.status !== 'FINISHED' && isSparseEvent(ev)) repairNeeded = true;
    return existing;
  });
}
// Serialize DB writes to the SAME match across the full import, the live
// polling loop, and the Socket.IO feed, so a slow import step never
// interleaves partial odds with a live patch for that match. Keyed per
// match id (not a single global lock) so N live matches updating around
// the same time process in parallel instead of queuing behind one another
// one at a time — with many live matches (a busy Saturday), a single
// global lock meant every match's update waited for every other match's
// full read-modify-write DB round trip to finish first, adding real,
// growing latency exactly when responsiveness matters most. Different
// matches now only ever block each other if they happen to share a key,
// which never happens (each match's key is its own id).
export const statusSampler = createStatusSampler();
export const dbWriteLocks = new Map();
 // matchId -> tail Promise of that match's write queue
export function withDbLock(key, fn) {
  const prevTail = dbWriteLocks.get(key) || Promise.resolve();
  const run = prevTail.then(fn, fn);
  const settled = run.then(function () {}, function () {});
  dbWriteLocks.set(key, settled);
  // Once this chain link resolves, free the map entry if nothing newer has
  // queued behind it in the meantime — otherwise the map would grow
  // forever, holding one entry per match id ever seen for the life of the
  // process.
  settled.then(function () {
    if (dbWriteLocks.get(key) === settled) dbWriteLocks.delete(key);
  });
  return run;
}
// Record a goal exactly once: only when the score actually moved compared to
// what we last persisted (or when a first non-zero score appears). Repeated
// polls and socket ticks for the same score are no-ops.
// BUG FIX: this used to treat ANY score change as a goal — including when
// the score goes DOWN (VAR overturns/disallows an earlier goal, or the
// provider corrects a miskeyed score). `Math.sign(score.home - prevHome)`
// being anything other than 1 fell through to "away scored", so a
// disallowed HOME goal was logged and broadcast as an AWAY goal — a
// completely fabricated event pushed to every connected client. Now each
// team's delta is checked independently: a positive delta records/pushes a
// real goal as before; a negative delta means a previously-logged goal for
// that team must be retracted (delete the most recent GOAL match_event for
// them) and broadcasts GOAL_DISALLOWED with the corrected score instead of
// GOAL — never invents which team "scored" when nobody did.
export async function recordGoalIfChanged(ev, score, minute, prev, eventMinute) {
  if (!score) return;
  const prevHome = prev ? prev.live_home_score : null;
  const prevAway = prev ? prev.live_away_score : null;
  const hadScoreBefore = prevHome != null && prevAway != null;
  const homeDelta = hadScoreBefore ? score.home - prevHome : score.home;
  const awayDelta = hadScoreBefore ? score.away - prevAway : score.away;
  if (homeDelta === 0 && awayDelta === 0) return;
  const now = Date.now();

  // First time we see a score for this match and it already holds 2+ goals (server restarted
  // mid-match, match imported late, e.g. first seen as 5-1 at minute 72): at least one goal
  // is certainly OLD and the provider only gives the aggregate score, so WHEN they happened
  // is unknown. Stamping them with the current clock would invent goal events (all "at 72'").
  // Only the score itself is stored; real goal events are logged from the next observed
  // change onwards. A first score of exactly one goal (1-0 / 0-1) is still treated as the
  // goal it most likely is.
  if (!hadScoreBefore && score.home + score.away >= 2) {
    await pool.query(
      `INSERT INTO live_statistics (match_id, home_score, away_score, updated_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (match_id) DO UPDATE SET home_score = excluded.home_score, away_score = excluded.away_score, updated_at = excluded.updated_at`,
      [ev.id, score.home, score.away, now]
    );
    return;
  }

  // Tell the clients FIRST (memory only), persist afterwards. No-op if the
  // gamedetails socket already announced this exact score change.
  announceGoalIfChanged(ev, score, minute, prev);

  async function logGoal(team, nthInGap = 1) {
    // Never log more goal rows for a team than its score says: a repeated
    // "new" goal (score briefly unknown/reset between writers) must not
    // add a second row for the same goal.
    const teamScore = team === ev.home_team ? score.home : score.away;
    const { rows: have } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM match_events WHERE match_id = $1 AND type = 'GOAL' AND team = $2`,
      [ev.id, team]
    );
    if (have[0] && Number(have[0].n) >= teamScore) return;
    // The 2nd, 3rd... goal of one gap (two goals between two provider readings) share the same
    // score text, so the same-score guard only applies to the first one of a gap.
    if (nthInGap === 1) {
      const { rows: same } = await pool.query(
        `SELECT 1 FROM match_events WHERE match_id = $1 AND type = 'GOAL' AND team = $2 AND detail = $3 LIMIT 1`,
        [ev.id, team, score.home + '-' + score.away]
      );
      if (same && same.length) return;
    }
    // The minute is exact only when it came from the provider clock at the instant the score
    // changed: a known previous score, the first goal of the gap, and a clock-derived minute.
    const exact = eventMinute != null && hadScoreBefore && nthInGap === 1;
    const goalMinute = eventMinute != null ? eventMinute : eventMinuteFromClock(minute);
    try {
      await pool.query(
        `INSERT INTO match_events (match_id, minute, type, team, detail, created_at, minute_exact, half)
         VALUES ($1,$2,'GOAL',$3,$4,$5,$6,${halfSql('$1')})`,
        [ev.id, goalMinute, team, score.home + '-' + score.away, now, exact]
      );
    } catch {
      // minute_exact column not migrated yet: the goal must still be logged.
      await pool.query(
        `INSERT INTO match_events (match_id, minute, type, team, detail, created_at)
         VALUES ($1,$2,'GOAL',$3,$4,$5)`,
        [ev.id, goalMinute, team, score.home + '-' + score.away, now]
      );
    }
  }
  async function retractLastGoal(team) {
    const { rows } = await pool.query(
      `SELECT id FROM match_events WHERE match_id = $1 AND type = 'GOAL' AND team = $2 ORDER BY created_at DESC LIMIT 1`,
      [ev.id, team]
    );
    if (rows[0]) await pool.query('DELETE FROM match_events WHERE id = $1', [rows[0].id]);
  }

  // One event per goal even when the score jumped by 2+ between two readings (the provider only
  // gives the score; all of them carry the observation minute). Capped: a jump above 6 is a
  // correction, not six goals.
  if (homeDelta > 0) { for (let k = 1; k <= Math.min(homeDelta, 6); k++) await logGoal(ev.home_team, k); }
  else if (homeDelta < 0) await retractLastGoal(ev.home_team);
  if (awayDelta > 0) { for (let k = 1; k <= Math.min(awayDelta, 6); k++) await logGoal(ev.away_team, k); }
  else if (awayDelta < 0) await retractLastGoal(ev.away_team);

  await pool.query(
    `INSERT INTO live_statistics (match_id, home_score, away_score, updated_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (match_id) DO UPDATE SET home_score = excluded.home_score, away_score = excluded.away_score, updated_at = excluded.updated_at`,
    [ev.id, score.home, score.away, now]
  );
}
