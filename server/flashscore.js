// Flashscore, GOALS ONLY (scorer, minute, half). The bundled scraper is started by the app itself (flashscoreProc.js); FLASHSCORE=0 turns it off.
// It only fixes/adds GOAL rows of match_events: it never writes scores, clocks, statuses or odds and never settles anything.
// Matches are linked to their Flashscore fixture by team names + kick-off; a match whose incidents do not add up to Flashscore's score is skipped.
// Optional: FLASHSCORE_URL (external service)   FLASHSCORE_INTERVAL_MS (default 90000, min 30000)   FLASHSCORE_BACKFILL_HOURS (default 30)
import { pool } from './db.js';
import { serviceBase, enabled } from './flashscoreProc.js';
import { parseMatchList, incidentRows, incidentDiag, findFlashscoreMatch } from './flashscoreMap.js';

const timeout = () => Math.max(5000, Number(process.env.FLASHSCORE_TIMEOUT_MS) || 20000);
async function get(path, fetchImpl, base) {
  const res = await fetchImpl(base + path, { signal: AbortSignal.timeout(timeout()) });
  if (!res.ok) throw new Error('flashscore HTTP ' + res.status);
  return res.json();
}

// A goal row that already exists (same team + running score, written by our provider) gets the scorer, the real minute and the real half.
// A goal our provider never logged is added, filed where it belongs in the timeline (created_at = kick-off + minute, +15 min after half time).
async function logGoals(row, goals) {
  let added = 0; let fixed = 0;
  const kickoff = Date.parse(row.start_time);
  for (const g of goals) {
    const { rows: have } = await pool.query(
      'SELECT id, player, minute, half FROM match_events WHERE match_id = $1 AND type = $2 AND team = $3 AND detail = $4 ORDER BY id LIMIT 1',
      [row.id, 'GOAL', g.team, g.detail]
    );
    if (have.length) {
      const h = have[0];
      const sets = []; const params = [h.id];
      if (g.player && h.player !== g.player) { params.push(g.player); sets.push(`player = $${params.length}`); }
      if (g.minute != null && Number(h.minute) !== Number(g.minute)) { params.push(g.minute); sets.push(`minute = $${params.length}`); }
      if ((g.half === 1 || g.half === 2) && h.half !== g.half && h.half !== 3) { params.push(g.half); sets.push(`half = $${params.length}`); }
      if (sets.length) { await pool.query(`UPDATE match_events SET ${sets.join(', ')} WHERE id = $1`, params); fixed++; }
      continue;
    }
    const at = Number.isFinite(kickoff) && g.minute != null ? kickoff + (g.minute + (g.half === 2 ? 15 : 0)) * 60000 : Date.now();
    await pool.query('INSERT INTO match_events (match_id, minute, type, team, player, detail, created_at, half) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [row.id, g.minute, 'GOAL', g.team, g.player, g.detail, at, g.half]);
    added++;
  }
  return { added, fixed };
}

const doneFinished = new Set();
const lastDiag = new Map();
let backfilled = false;

export async function runFlashscore({ now = Date.now(), fetchImpl = globalThis.fetch, sinceMs = 6 * 3600 * 1000 } = {}) {
  if (!fetchImpl || !enabled()) return { disabled: true };
  // Football matches that are live, or finished since `sinceMs` ago (the final scorers are captured once per process).
  const { rows } = await pool.query(
    `SELECT id, home_team, away_team, start_time, status FROM matches_cache
      WHERE status IN ('LIVE','FINISHED') AND start_time::timestamptz BETWEEN $1::timestamptz AND $2::timestamptz
      ORDER BY start_time`,
    [new Date(now - sinceMs).toISOString(), new Date(now + 5 * 60000).toISOString()]
  );
  const todo = rows.filter((r) => !doneFinished.has(r.id));
  if (!todo.length) return { candidates: 0 };
  const base = serviceBase({ now });
  if (!base) return { disabled: true };
  const list = [];
  const days = sinceMs > 20 * 3600 * 1000 ? [0, -1, -2] : [0, -1];
  for (const day of days) {
    try { list.push(...parseMatchList(await get(`/matches?sport=football&day=${day}`, fetchImpl, base))); } catch (e) { if (day === 0) throw e; }
  }
  const seen = new Set();
  for (let i = list.length - 1; i >= 0; i--) { if (seen.has(list[i].id)) list.splice(i, 1); else seen.add(list[i].id); }
  const out = { candidates: todo.length, matched: 0, goalsAdded: 0, goalsFixed: 0 };
  const unmatched = [];
  for (const row of todo) { // one match after the other
    const f = findFlashscoreMatch(list, row);
    if (!f) { if (unmatched.length < 8) unmatched.push(row.home_team + ' v ' + row.away_team); continue; }
    out.matched++;
    try {
      const summary = await get(`/matches/summary?match=${encodeURIComponent(f.id)}`, fetchImpl, base);
      const ev = incidentRows(summary, f, row.home_team, row.away_team);
      if (ev) {
        const r = await logGoals(row, ev.filter((e) => e.type === 'GOAL'));
        out.goalsAdded += r.added; out.goalsFixed += r.fixed;
        if (row.status === 'FINISHED') doneFinished.add(row.id);
      } else {
        const msg = incidentDiag(summary, f);
        if (lastDiag.get(row.id) !== msg) { lastDiag.set(row.id, msg); console.warn('[flashscore] incidents of ' + row.id + ' do not add up (' + msg + ') -- goals not logged'); }
      }
    } catch (err) { console.error('[flashscore] match ' + row.id + ' failed:', err.message); }
  }
  if (unmatched.length) out.unmatched = unmatched;
  return out;
}

let lastErrAt = 0;
export function startFlashscoreLoop() {
  if (!enabled()) return;
  const every = Math.max(30000, Number(process.env.FLASHSCORE_INTERVAL_MS || 90000));
  const backfillMs = Math.max(6, Number(process.env.FLASHSCORE_BACKFILL_HOURS || 30)) * 3600 * 1000;
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    // the first pass after a start goes through every match of the last ~30 h (today's tickets included); later passes only the recent ones
    const sinceMs = backfilled ? 6 * 3600 * 1000 : backfillMs;
    runFlashscore({ sinceMs }).then((r) => {
      if (r && !r.disabled) backfilled = true;
      if (r && (r.goalsAdded || r.goalsFixed || (r.unmatched && r.unmatched.length))) console.log('[flashscore] ' + JSON.stringify(r));
    }).catch((err) => { if (Date.now() - lastErrAt > 15 * 60000) { lastErrAt = Date.now(); console.error('[flashscore] cycle failed:', err.message); } })
      .finally(() => { busy = false; });
  };
  const t = setInterval(tick, every);
  if (t.unref) t.unref();
  setTimeout(tick, 20000);
  console.log('[flashscore] goals on, every ' + every + 'ms');
}

export const __resetForTests = () => { doneFinished.clear(); lastDiag.clear(); backfilled = false; };
