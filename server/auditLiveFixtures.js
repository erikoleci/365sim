// Read-only audit of live fixtures:  node server/auditLiveFixtures.js [providerId ...]
// e.g.  node server/auditLiveFixtures.js 5122706 5200421
//
// Prints (never writes):
//   1. For each id given: the matches_cache row (teams, status, score, minute, live_status,
//      stamp age, league ids) and how many GOAL/CARD events are stored under it.
//   2. Every group of LIVE rows that are the SAME fixture under several provider ids
//      (the situation that shows 0-0 on one row while another row has the real score).
// No secrets are printed.
import 'dotenv/config';
import pool from './db.js';
import { mapEventToMatch } from './oddsUtils.js';
import { dedupeMatches } from './fixtureDedupe.js';

const COLS = 'id, league, league_id, country_id, home_team, away_team, start_time, status, raw_json, live_home_score, live_away_score, live_minute, live_status, live_minute_updated_at, fetched_at';

function line(r) {
  const age = r.live_minute_updated_at != null ? Math.round((Date.now() - Number(r.live_minute_updated_at)) / 1000) + 's ago' : 'no stamp';
  return `${r.id} | ${r.home_team} v ${r.away_team} | ${r.start_time} | status=${r.status} | score=${r.live_home_score ?? '-'}-${r.live_away_score ?? '-'} | minute=${r.live_minute ?? '-'} (${age}) | live_status=${r.live_status ?? '-'} | league=${r.league} (league_id=${r.league_id ?? '-'}, country_id=${r.country_id ?? '-'})`;
}

async function main() {
  const ids = process.argv.slice(2).map((x) => (String(x).startsWith('l365-') ? x : 'l365-' + x));
  for (const id of ids) {
    const { rows } = await pool.query(`SELECT ${COLS} FROM matches_cache WHERE id = $1`, [id]);
    if (!rows[0]) { console.log(`[audit] ${id}: NOT in matches_cache`); continue; }
    console.log('[audit] ' + line(rows[0]));
    const ev = await pool.query('SELECT type, COUNT(*)::int AS n FROM match_events WHERE match_id = $1 GROUP BY type', [id]);
    console.log('        events: ' + (ev.rows.map((e) => `${e.type}=${e.n}`).join(', ') || 'none'));
  }
  const { rows: live } = await pool.query(
    `SELECT ${COLS} FROM matches_cache WHERE id LIKE 'l365-%' AND start_time_tz(start_time) > NOW() - interval '6 hours' AND start_time_tz(start_time) < NOW() AND status != 'FINISHED'`
  );
  const byId = new Map(live.map((r) => [r.id, r]));
  const merged = [];
  dedupeMatches(live.map(mapEventToMatch), (all, kept, liveSrc) => merged.push({ all, kept, liveSrc }));
  console.log(`\n[audit] ${live.length} not-finished rows that started in the last 6h; ${merged.length} fixture(s) exist under several ids:`);
  for (const m of merged) {
    console.log('  --- same fixture, ids: ' + m.all.join(', ') + ' | list shows odds of ' + m.kept + (m.liveSrc ? ', live data of ' + m.liveSrc : ''));
    for (const id of m.all) console.log('      ' + line(byId.get(id)));
  }
  await pool.end();
}
main().catch((e) => { console.error('[audit] failed:', e.message); process.exit(1); });
