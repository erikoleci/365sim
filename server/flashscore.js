// Flashscore enrichment (starts the bundled scraper by itself, see flashscoreProc.js; FLASHSCORE=0 turns it off): scorers' names, penalties, cards and
// big chances, read from the self-hosted flashscore-service (flashscore-service/, MIT). It only ADDS facts:
// it never writes scores, never settles tickets and never touches odds. A failing/slow service is skipped silently.
// Optional: FLASHSCORE_URL (use an external service instead)   FLASHSCORE_INTERVAL_MS (default 90000, min 30000)
import { harvestLogos } from './fsLogos.js';
import { isPastFirstHalf } from './marketPeriods.js';
import { pool } from './db.js';
import { serviceBase, enabled } from './flashscoreProc.js';
import { parseMatchList, incidentRows, bigChances, otherStats, incidentDiag, findFlashscoreMatch, flashscoreClock } from './flashscoreMap.js';

const timeout = () => Math.max(5000, Number(process.env.FLASHSCORE_TIMEOUT_MS) || 20000);
async function get(path, fetchImpl, base) {
  const res = await fetchImpl(base + path, { signal: AbortSignal.timeout(timeout()) });
  if (!res.ok) throw new Error('flashscore HTTP ' + res.status);
  return res.json();
}

// Write the events; a row that already exists (same type/team/detail, from another source) only gets the scorer's name filled in.
async function logEvents(matchId, rows, now) {
  let added = 0;
  for (const r of rows) {
    const { rows: have } = await pool.query('SELECT id, player, half FROM match_events WHERE match_id = $1 AND type = $2 AND team = $3 AND detail = $4 LIMIT 1', [matchId, r.type, r.team, r.detail]);
    if (have.length) {
      if (!have[0].player && r.player) await pool.query('UPDATE match_events SET player = $2 WHERE id = $1', [have[0].id, r.player]);
      // The row was logged by our provider while its status still said "first half" (half time never signalled): Flashscore knows the
      // real half, so a goal of the 2nd half is no longer filed under the 1st.
      if ((r.half === 1 || r.half === 2) && have[0].half !== r.half && have[0].half !== 3) await pool.query('UPDATE match_events SET half = $2 WHERE id = $1', [have[0].id, r.half]);
      continue;
    }
    await pool.query('INSERT INTO match_events (match_id, minute, type, team, player, detail, created_at, half) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [matchId, r.minute, r.type, r.team, r.player, r.detail, now, r.half]);
    added++;
  }
  return added;
}

const lastStage = new Map(); // match id -> 'two' | 'other' (last stage seen by this process)
const secondHalfSeen = new Map(); // match id -> ms the 2nd half was first seen by this process
const lastDetailAt = new Map(); // match id -> ms of the last details pull (a live match: every cycle; a finished one: once)
const doneFinished = new Set();

export async function runFlashscore({ now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
  if (!fetchImpl || !enabled()) return { disabled: true };
  // Football matches that are live, or ended in the last 3 hours (so the final scorers/stats are captured once).
  const { rows } = await pool.query(
    `SELECT id, home_team, away_team, start_time, status, live_minute, live_minute_updated_at, live_status, live_home_score, live_away_score FROM matches_cache
      WHERE status IN ('LIVE','FINISHED') AND start_time::timestamptz BETWEEN $1::timestamptz AND $2::timestamptz`,
    [new Date(now - 6 * 3600 * 1000).toISOString(), new Date(now + 5 * 60000).toISOString()]
  );
  const todo = rows.filter((r) => !doneFinished.has(r.id));
  if (!todo.length) return { candidates: 0 };
  const base = serviceBase({ now }); // starts the bundled scraper on the first cycle that has something to enrich
  if (!base) return { disabled: true };
  const list = [];
  for (const day of [0, -1]) {
    try { list.push(...parseMatchList(await get(`/matches?sport=football&day=${day}`, fetchImpl, base))); } catch (e) { if (day === 0) throw e; }
  }
  const seen = new Set();
  for (let i = list.length - 1; i >= 0; i--) { if (seen.has(list[i].id)) list.splice(i, 1); else seen.add(list[i].id); } // the same match must never be listed twice (that would look ambiguous)
  const out = { candidates: todo.length, matched: 0, eventsAdded: 0, extras: 0 };
  // Crests: the same list gives every team's picture address. Our live / finished rows and today's upcoming ones are linked to
  // their Flashscore fixture exactly like the events below, and only the (new) addresses are written. Never blocks the cycle.
  try {
    const { rows: upcoming } = await pool.query(
      `SELECT home_team, away_team, start_time FROM matches_cache
        WHERE status = 'UPCOMING' AND start_time::timestamptz BETWEEN $1::timestamptz AND $2::timestamptz LIMIT 400`,
      [new Date(now).toISOString(), new Date(now + 24 * 3600 * 1000).toISOString()]
    );
    const pairs = [];
    for (const r of [...todo, ...upcoming]) {
      const f = findFlashscoreMatch(list, r);
      if (f && (f.homeLogo || f.awayLogo)) pairs.push({ home: r.home_team, away: r.away_team, homeLogo: f.homeLogo, awayLogo: f.awayLogo });
    }
    out.logos = await harvestLogos(pool, pairs);
  } catch (e) { console.warn('[flashscore] crests skipped: ' + (e && e.message)); }
  const unmatched = [];
  for (const row of todo) {
    const f = findFlashscoreMatch(list, row);
    if (!f) { if (unmatched.length < 5) unmatched.push(row.home_team + ' v ' + row.away_team); continue; }
    out.matched++;
    // Clock fallback: only when OUR provider's clock has gone quiet (no update for 5+ minutes while the match is LIVE). Never overrides a
    // fresh clock, never touches scores or settlement; the write itself re-checks that the clock is still stale.
    try {
      const stage2 = String(f.stage || '').toLowerCase() === '2nd half' || Number(f.stageId) === 13;
      // the 2nd half start is known only if this process SAW the stage before it (otherwise, e.g. after a restart, the kickoff estimate is used)
      const before = lastStage.get(row.id);
      if (stage2 && before !== undefined && before !== 'two' && !secondHalfSeen.has(row.id)) secondHalfSeen.set(row.id, now);
      lastStage.set(row.id, stage2 ? 'two' : 'other');
      // Extra time / penalties on Flashscore: close our markets even if our provider is still showing the 2nd half (closing is the safe direction).
      const fsClock = row.status === 'LIVE' ? flashscoreClock(f, now) : null;
      if (fsClock && fsClock.closeOnly && !['ET', 'EXTRA_TIME', 'PEN', 'PENALTIES', 'AET'].includes(String(row.live_status || '').toUpperCase().trim())) {
        const res = await pool.query(`UPDATE matches_cache SET live_status = $2 WHERE id = $1 AND status = 'LIVE'`, [row.id, fsClock.status]);
        if (res && res.rowCount) out.closed = (out.closed || 0) + 1;
      }
      // 2nd half on Flashscore but OUR provider never signalled half time (the break was missed or its status is a number nobody can read):
      // the first-half markets are over. Closing signal only ('2H' = past the first half, see marketPeriods.js); the clock and scores stay
      // as they are. Without this they would stay open until the wall-clock safety net (80 min after kickoff).
      if (stage2 && row.status === 'LIVE' && !isPastFirstHalf(row, now)) {
        const res = await pool.query(`UPDATE matches_cache SET live_status = $2 WHERE id = $1 AND status = 'LIVE'`, [row.id, '2H']);
        if (res && res.rowCount) out.firstHalfClosed = (out.firstHalfClosed || 0) + 1;
      }
      const stale = row.status === 'LIVE' && now - Number(row.live_minute_updated_at || 0) > 5 * 60000;
      let clock = stale ? flashscoreClock(f, now, secondHalfSeen.get(row.id)) : null;
      if (clock && clock.closeOnly) clock = null; // handled above (live_status only)
      // 'HT' makes the app capture the half-time score from OUR live score (first write wins, settles half-time markets): only say HT when
      // our live score is the same as Flashscore's, so a missed goal can never be frozen in as the half-time score.
      if (clock && clock.status === 'HT' && !(Number(row.live_home_score) === Number(f.homeScore) && Number(row.live_away_score) === Number(f.awayScore) && row.live_home_score != null && f.homeScore != null)) clock = null;
      if (clock) {
        const res = await pool.query(
          `UPDATE matches_cache SET live_minute = $2, live_minute_updated_at = $3, live_status = $4
            WHERE id = $1 AND status = 'LIVE' AND (live_minute_updated_at IS NULL OR live_minute_updated_at < $5)`,
          [row.id, clock.minute, now, clock.status, now - 5 * 60000]
        );
        if (res && res.rowCount) out.clock = (out.clock || 0) + 1;
      }
    } catch (err) { console.error('[flashscore] clock of ' + row.id + ' failed:', err.message); }
    try {
      const q = encodeURIComponent(f.id);
      const [summary, stats] = await Promise.all([
        get(`/matches/summary?match=${q}`, fetchImpl, base),
        get(`/matches/statistics?match=${q}`, fetchImpl, base).catch(() => null),
      ]);
      const ev = incidentRows(summary, f, row.home_team, row.away_team);
      if (ev) out.eventsAdded += await logEvents(row.id, ev, now);
      else console.warn('[flashscore] incidents of ' + row.id + ' do not add up (' + incidentDiag(summary, f) + ') -- not logged');
      const bc = stats ? bigChances(stats) : null;
      const more = stats ? otherStats(stats) : [];
      if (bc || more.length) {
        await pool.query(
          `INSERT INTO match_extra (match_id, big_chances_home, big_chances_away, stats_json, updated_at) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (match_id) DO UPDATE SET big_chances_home = COALESCE(EXCLUDED.big_chances_home, match_extra.big_chances_home),
             big_chances_away = COALESCE(EXCLUDED.big_chances_away, match_extra.big_chances_away),
             stats_json = COALESCE(EXCLUDED.stats_json, match_extra.stats_json), updated_at = EXCLUDED.updated_at`,
          [row.id, bc ? bc.home : null, bc ? bc.away : null, more.length ? JSON.stringify(more) : null, now]
        );
        out.extras++;
      }
      lastDetailAt.set(row.id, now);
      if (row.status === 'FINISHED') doneFinished.add(row.id);
    } catch (err) { console.error('[flashscore] match ' + row.id + ' failed:', err.message); }
  }
  if (unmatched.length && Date.now() - lastUnmatchedLog > 30 * 60000) { lastUnmatchedLog = Date.now(); console.log('[flashscore] no Flashscore match found for: ' + unmatched.join(' | ')); }
  return out;
}
let lastUnmatchedLog = 0;
export const __resetForTests = () => { lastDetailAt.clear(); doneFinished.clear(); secondHalfSeen.clear(); lastStage.clear(); };

let lastErrAt = 0;
export function startFlashscoreLoop() {
  if (!enabled()) return;
  const every = Math.max(30000, Number(process.env.FLASHSCORE_INTERVAL_MS || 90000));
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    runFlashscore().then((r) => { if (r && (r.eventsAdded || r.extras || r.clock || r.closed)) console.log('[flashscore] ' + JSON.stringify(r)); })
      .catch((err) => { if (Date.now() - lastErrAt > 15 * 60000) { lastErrAt = Date.now(); console.error('[flashscore] cycle failed:', err.message); } }) // one line per 15 min, not one per cycle
      .finally(() => { busy = false; });
  };
  const t = setInterval(tick, every);
  if (t.unref) t.unref();
  setTimeout(tick, 20000);
  console.log('[flashscore] enrichment on, every ' + every + 'ms');
}
