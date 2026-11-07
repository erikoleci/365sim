// `npm run diagnose:events` -- READ-ONLY. For every match that has an open ticket leg and is being played (or is past its
// kickoff), shows whether cards / corners / goals arrive for it and from which record, so a match that "has no cards while
// the provider shows them" can be traced to its cause. Nothing is changed. Printed and saved to diagnose-events.txt.
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { pool } from './db.js';
import { pickLiveTwin } from './liveTwin.js';

const out = [];
const say = (s = '') => { out.push(s); console.log(s); };
const ago = (ms) => (ms == null ? 'asnjëherë' : Math.round((Date.now() - Number(ms)) / 1000) + 's më parë');

async function counts(ids) {
  const { rows } = await pool.query(
    `SELECT match_id, type, COUNT(*)::int AS n FROM match_events WHERE match_id = ANY($1::text[]) GROUP BY match_id, type`,
    [ids]
  );
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.match_id)) m.set(r.match_id, {});
    m.get(r.match_id)[r.type] = r.n;
  }
  return m;
}
const evText = (o) => (o && Object.keys(o).length ? Object.entries(o).map(([k, v]) => k + '=' + v).join(' ') : 'asnjë ngjarje');

async function main() {
  const { rows: matches } = await pool.query(
    `SELECT DISTINCT m.* FROM bet_selections bs
       JOIN bets b ON b.id = bs.bet_id AND b.status = 'PENDING'
       JOIN matches_cache m ON m.id = bs.match_id
      WHERE bs.status = 'PENDING' AND m.start_time::timestamptz < now()`
  );
  say(`Ndeshje me bileta të hapura që kanë filluar: ${matches.length}`);
  if (!matches.length) return;
  const t0 = Math.min(...matches.map((m) => Date.parse(m.start_time)));
  const { rows: pool2 } = await pool.query(
    `SELECT * FROM matches_cache WHERE start_time::timestamptz BETWEEN $1::timestamptz AND now() + interval '1 hour'`,
    [new Date(t0 - 3 * 3600 * 1000).toISOString()]
  );
  const ids = [...new Set([...matches.map((m) => m.id), ...pool2.map((m) => m.id)])];
  const ev = await counts(ids);
  const { rows: stats } = await pool.query(
    `SELECT match_id, updated_at, corners_home, corners_away, yellow_home, yellow_away FROM live_statistics WHERE match_id = ANY($1::text[])`,
    [ids]
  );
  const st = new Map(stats.map((s) => [s.match_id, s]));
  const causes = {};
  for (const m of matches) {
    const own = st.get(m.id);
    const twin = pickLiveTwin(m, pool2);
    const tw = twin ? st.get(twin.id) : null;
    const fresh = (s) => s && Date.now() - Number(s.updated_at) < 120000;
    let cause;
    if (fresh(own)) cause = 'OK: kornizat vijnë për këtë id';
    else if (twin && fresh(tw)) cause = 'OK nga binjaku: ngjarjet janë te ' + twin.id + ' (rekordi in-play)';
    else if (twin) cause = 'BINJAKU EKZISTON por pa korniza të freskëta (nuk abonohet / provideri nuk dërgon)';
    else if (m.status === 'LIVE') cause = 'LIVE por pa korniza (id e abonuar nuk dërgon)';
    else cause = 'PA BINJAK: ndeshja është ' + m.status + ', rekordi in-play nuk është importuar fare (nuk abonohemi)';
    causes[cause.split(':')[0]] = (causes[cause.split(':')[0]] || 0) + 1;
    say('');
    say(`${m.home_team} v ${m.away_team}  [${m.id}] status=${m.status} skor=${m.live_home_score ?? '-'}-${m.live_away_score ?? '-'}`);
    say(`   statistika: ${own ? 'përditësuar ' + ago(own.updated_at) + `, kënde ${own.corners_home ?? '-'}-${own.corners_away ?? '-'}, të verdha ${own.yellow_home ?? '-'}-${own.yellow_away ?? '-'}` : 'ASNJË'}`);
    say(`   ngjarje: ${evText(ev.get(m.id))}`);
    if (twin) {
      const ts = st.get(twin.id);
      say(`   binjaku in-play ${twin.id} (${twin.home_team} v ${twin.away_team}) status=${twin.status}: ${ts ? 'përditësuar ' + ago(ts.updated_at) : 'pa statistika'}; ngjarje: ${evText(ev.get(twin.id))}`);
    }
    say(`   --> ${cause}`);
  }
  say('');
  say('PËRMBLEDHJE: ' + Object.entries(causes).map(([k, v]) => k + '=' + v).join('  '));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    try { writeFileSync('diagnose-events.txt', out.join('\n') + '\n'); } catch { /* read-only folder */ }
    await pool.end().catch(() => {});
  });
