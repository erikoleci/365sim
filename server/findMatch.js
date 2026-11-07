// `node server/findMatch.js <part of a team name>` -- READ-ONLY. Lists every record of a team from the last 2 days
// (a fixture can sit under two provider ids) with status, score, clock, logged events and statistics age.
import 'dotenv/config';
import { pool } from './db.js';

const term = process.argv.slice(2).join(' ').trim();
if (!term) { console.log('Perdorimi: node server/findMatch.js aarhus'); process.exit(0); }
const { rows } = await pool.query(
  `SELECT id, home_team, away_team, league, status, start_time, live_home_score AS lh, live_away_score AS la, live_minute AS min,
          live_status AS ls, result_home AS rh, result_away AS ra,
          (SELECT COUNT(*)::int FROM match_events e WHERE e.match_id = matches_cache.id) AS events,
          (SELECT updated_at FROM live_statistics s WHERE s.match_id = matches_cache.id) AS stats_at,
          (SELECT COUNT(*)::int FROM bet_selections b WHERE b.match_id = matches_cache.id AND b.status = 'PENDING') AS open_legs
     FROM matches_cache
    WHERE (home_team ILIKE $1 OR away_team ILIKE $1) AND start_time::timestamptz > now() - interval '2 days'
    ORDER BY start_time`,
  ['%' + term + '%']
);
console.log(rows.length + ' rekorde per "' + term + '":');
for (const r of rows) {
  const age = r.stats_at ? Math.round((Date.now() - Number(r.stats_at)) / 1000) + 's' : 'asnjehere';
  console.log(`\n${r.id}  ${r.home_team} v ${r.away_team}  [${r.league}]\n   status=${r.status} fillimi=${r.start_time} live=${r.lh ?? '-'}-${r.la ?? '-'} minuta=${r.min ?? '-'} (${r.ls ?? '-'}) rezultat=${r.rh ?? '-'}-${r.ra ?? '-'}\n   ngjarje=${r.events} statistika=${age} legs-te-hapura=${r.open_legs}`);
}
await pool.end();
