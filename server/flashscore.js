// Flashscore enrichment (starts the bundled scraper by itself, see flashscoreProc.js; FLASHSCORE=0 turns it off): scorers' names, penalties, cards and
// big chances, read from the self-hosted flashscore-service (flashscore-service/, MIT). It only ADDS facts:
// it never writes scores, never settles tickets and never touches odds. A failing/slow service is skipped silently.
// Optional: FLASHSCORE_URL (use an external service instead)   FLASHSCORE_INTERVAL_MS (default 90000, min 30000)
import { pool } from './db.js';
import { serviceBase, enabled } from './flashscoreProc.js';
import { parseMatchList, incidentRows, bigChances, otherStats, findFlashscoreMatch } from './flashscoreMap.js';

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
    const { rows: have } = await pool.query('SELECT id, player FROM match_events WHERE match_id = $1 AND type = $2 AND team = $3 AND detail = $4 LIMIT 1', [matchId, r.type, r.team, r.detail]);
    if (have.length) {
      if (!have[0].player && r.player) await pool.query('UPDATE match_events SET player = $2 WHERE id = $1', [have[0].id, r.player]);
      continue;
    }
    await pool.query('INSERT INTO match_events (match_id, minute, type, team, player, detail, created_at, half) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [matchId, r.minute, r.type, r.team, r.player, r.detail, now, r.half]);
    added++;
  }
  return added;
}

const lastDetailAt = new Map(); // match id -> ms of the last details pull (a live match: every cycle; a finished one: once)
const doneFinished = new Set();

export async function runFlashscore({ now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
  if (!fetchImpl || !enabled()) return { disabled: true };
  // Football matches that are live, or ended in the last 3 hours (so the final scorers/stats are captured once).
  const { rows } = await pool.query(
    `SELECT id, home_team, away_team, start_time, status FROM matches_cache
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
  for (const row of todo) {
    const f = findFlashscoreMatch(list, row);
    if (!f) continue;
    out.matched++;
    try {
      const q = encodeURIComponent(f.id);
      const [summary, stats] = await Promise.all([
        get(`/matches/summary?match=${q}`, fetchImpl, base),
        get(`/matches/statistics?match=${q}`, fetchImpl, base).catch(() => null),
      ]);
      const ev = incidentRows(summary, f, row.home_team, row.away_team);
      if (ev) out.eventsAdded += await logEvents(row.id, ev, now);
      else console.warn('[flashscore] incidents of ' + row.id + ' do not add up to the score ' + f.homeScore + '-' + f.awayScore + ' -- not logged');
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
  return out;
}
export const __resetForTests = () => { lastDetailAt.clear(); doneFinished.clear(); };

let lastErrAt = 0;
export function startFlashscoreLoop() {
  if (!enabled()) return;
  const every = Math.max(30000, Number(process.env.FLASHSCORE_INTERVAL_MS || 90000));
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    runFlashscore().then((r) => { if (r && (r.eventsAdded || r.extras)) console.log('[flashscore] ' + JSON.stringify(r)); })
      .catch((err) => { if (Date.now() - lastErrAt > 15 * 60000) { lastErrAt = Date.now(); console.error('[flashscore] cycle failed:', err.message); } }) // one line per 15 min, not one per cycle
      .finally(() => { busy = false; });
  };
  const t = setInterval(tick, every);
  if (t.unref) t.unref();
  setTimeout(tick, 20000);
  console.log('[flashscore] enrichment on, every ' + every + 'ms');
}
