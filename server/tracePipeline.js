// Read-only end-to-end trace of ONE fixture through the whole pipeline, with YOUR real data:
//   node server/tracePipeline.js chelsea bournemouth [--port 3002] [--ws 20]
//   (npm run trace:match -- chelsea bournemouth --ws 20)
// For each matching matches_cache row it answers, in order:
//   1 is it in the database, with what status/score/minute/ids?
//   2 is it inside the /api/matches time window, and at which position of the old ascending
//     order vs the row cap? (position >= cap rows => the old query cut it)
//   3 does the app consider it stale (hidden by isStaleLiveMatch)?
//   4 which ids does dedupeMatches() merge it with, and which id kept the live data?
//   5 does the RUNNING server's GET /api/matches really return it (and with which id/score)?
//   6 (--ws N) do the WebSocket live messages use the same ids as the REST list?
// Also prints import freshness and the filter/cap settings (no secrets, no DB credentials).
import 'dotenv/config';
import WebSocket from 'ws';
import pool from './db.js';
import { mapEventToMatch, MAX_LIVE_AGE_MS } from './oddsUtils.js';
import { dedupeMatches } from './fixtureDedupe.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const PORT = opt('--port', process.env.PORT || '3002');
const WS_SECONDS = Number(opt('--ws', 0));
const terms = args.filter((a) => !a.startsWith('--')).map((t) => t.toLowerCase());
if (!terms.length) { console.error('usage: node server/tracePipeline.js <team> [team2] [--port 3002] [--ws 20]'); process.exit(1); }

const COLS = 'id, league, league_id, country_id, home_team, away_team, start_time, status, raw_json, live_home_score, live_away_score, live_minute, live_status, live_minute_updated_at, fetched_at, result_home, result_away';
const ENV_KEYS = ['PORT', 'NODE_ENV', 'LONDON365_ONLY_COUNTRIES', 'LONDON365_MAJOR_ONLY', 'LONDON365_EXCLUDE_SECOND_TIER', 'LONDON365_EXCLUDE_COUNTRIES', 'LONDON365_LEAGUES', 'MATCHES_PAGE_HARD_CAP', 'LIVE_MAX_AGE_HOURS', 'LONDON365_LIVE_CONCURRENCY', 'VITE_API_TARGET'];
const line = (r) => `${r.id} | ${r.home_team} v ${r.away_team} | start ${r.start_time} | status=${r.status} | score=${r.live_home_score ?? '-'}-${r.live_away_score ?? '-'} | minute=${r.live_minute ?? '-'} | live_status=${r.live_status ?? '-'} | league=${r.league} (league_id=${r.league_id ?? '-'}, country_id=${r.country_id ?? '-'}) | fetched_at=${r.fetched_at ?? '-'}`;
const say = (s = '') => console.log(s);

async function main() {
  say('== 0. Settings (what THIS process would use) ==');
  say(ENV_KEYS.map((k) => `${k}=${process.env[k] === undefined ? '(unset)' : JSON.stringify(process.env[k])}`).join('\n'));
  const cap = Math.max(1, Number(process.env.MATCHES_PAGE_HARD_CAP) || 30) * 200;
  say(`row cap used by /api/matches = ${cap} rows`);

  const stats = await pool.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE start_time_tz(start_time) > NOW() - interval '2 days' AND start_time_tz(start_time) < NOW() + interval '21 days')::int AS in_window,
      COUNT(*) FILTER (WHERE start_time_tz(start_time) > NOW() - interval '8 hours' AND start_time_tz(start_time) <= NOW() AND status <> 'FINISHED')::int AS started_not_finished,
      COUNT(*) FILTER (WHERE live_home_score IS NOT NULL AND start_time_tz(start_time) > NOW() - interval '8 hours' AND status <> 'FINISHED')::int AS with_live_score,
      MAX(fetched_at) AS newest_fetch FROM matches_cache WHERE id LIKE 'l365-%'`);
  const s = stats.rows[0];
  say(`matches_cache(l365): total=${s.total}, in /api/matches window=${s.in_window}, started&not finished (last 8h)=${s.started_not_finished}, of those with a live score=${s.with_live_score}, newest import/live write=${s.newest_fetch}`);
  if (s.in_window > cap) say(`!! window holds ${s.in_window} rows but the cap is ${cap}: rows beyond the cap are not served in the list.`);

  say('\n== 1. Rows matching: ' + terms.join(' + ') + ' ==');
  const like = terms.map((t) => `%${t}%`);
  const where = terms.length >= 2
    ? '((home_team ILIKE $1 AND away_team ILIKE $2) OR (home_team ILIKE $2 AND away_team ILIKE $1))'
    : '(home_team ILIKE $1 OR away_team ILIKE $1)';
  const { rows } = await pool.query(`SELECT ${COLS} FROM matches_cache WHERE id LIKE 'l365-%' AND ${where} AND start_time_tz(start_time) > NOW() - interval '30 days' ORDER BY start_time DESC LIMIT 20`, like.slice(0, 2));
  if (!rows.length) {
    say('NOT IN THE DATABASE (last 30 days). The provider import never stored it -> check the filters above (ONLY_COUNTRIES / MAJOR_ONLY / EXCLUDE_*) and the import log lines "[london365] import".');
  }
  const mapped = [];
  for (const r of rows) {
    say('\n' + line(r));
    const live = await pool.query('SELECT sportmonks_fixture_id FROM matches_cache WHERE id = $1', [r.id]).catch(() => ({ rows: [{}] }));
    say(`   sportmonks_fixture_id=${live.rows[0]?.sportmonks_fixture_id ?? '-'}; provider game id (from id) = ${String(r.id).replace('l365-', '')}`);
    const inWin = await pool.query(`SELECT (start_time_tz($1) > NOW() - interval '2 days' AND start_time_tz($1) < NOW() + interval '21 days') AS ok`, [r.start_time]);
    const pos = await pool.query(`SELECT COUNT(*)::int AS n FROM matches_cache WHERE id LIKE 'l365-%' AND start_time_tz(start_time) > NOW() - interval '2 days' AND start_time_tz(start_time) < NOW() + interval '21 days' AND (start_time, id) < ($1, $2)`, [r.start_time, r.id]);
    say(`   2. in list window: ${inWin.rows[0].ok ? 'yes' : 'NO (older than 2 days or later than 21 days)'}; position in the OLD ascending order = ${pos.rows[0].n} of cap ${cap} -> ${pos.rows[0].n >= cap ? 'CUT by the old query' : 'inside the cap'}`);
    const m = mapEventToMatch(r);
    mapped.push(m);
    const stale = m.status === 'LIVE' && Date.now() - Date.parse(m.startTime) > MAX_LIVE_AGE_MS;
    say(`   3. API status=${m.status}${stale ? ' -> STALE: hidden by the app (LIVE for longer than ' + MAX_LIVE_AGE_MS / 3600000 + 'h)' : ''}; liveScore=${m.liveHomeScore ?? '-'}-${m.liveAwayScore ?? '-'}; minute=${m.currentMinute ?? '-'}${m.currentMinuteEstimated ? ' (ESTIMATED)' : ''}`);
  }

  if (rows.length) {
    const t0 = Date.parse(rows[0].start_time);
    const around = await pool.query(`SELECT ${COLS} FROM matches_cache WHERE id LIKE 'l365-%' AND start_time_tz(start_time) BETWEEN to_timestamp($1/1000.0) - interval '3 hours' AND to_timestamp($1/1000.0) + interval '3 hours'`, [t0]);
    const merges = [];
    dedupeMatches(around.rows.map(mapEventToMatch), (ids, kept, src) => merges.push({ ids, kept, src }));
    const mine = merges.filter((g) => g.ids.some((id) => rows.some((r) => r.id === id)));
    say('\n== 4. dedupeMatches ==');
    say(mine.length ? mine.map((g) => `same fixture under ids [${g.ids.join(', ')}] -> list keeps ${g.kept}${g.src ? ', live data taken from ' + g.src : ' (no record had better live data)'}`).join('\n') : 'no duplicates: each matching row stays its own list entry (so 5122706 and 5200421, if both exist above, are DIFFERENT fixtures or different times).');
  }

  say('\n== 5. The RUNNING server: GET /api/matches ==');
  let restIds = new Set();
  try {
    const res = await fetch(`http://localhost:${PORT}/api/matches`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const body = await res.json();
    restIds = new Set(body.matches.flatMap((x) => [x.id, x.liveSourceId].filter(Boolean)));
    const hit = body.matches.filter((x) => terms.every((t) => `${x.homeTeam} ${x.awayTeam}`.toLowerCase().includes(t)));
    say(`list has ${body.matches.length} matches (${body.matches.filter((x) => x.status === 'LIVE').length} LIVE)`);
    say(hit.length ? hit.map((x) => `FOUND ${x.id} ${x.homeTeam} v ${x.awayTeam} status=${x.status} score=${x.liveHomeScore ?? '-'}-${x.liveAwayScore ?? '-'} minute=${x.currentMinute ?? '-'}${x.currentMinuteEstimated ? '(est)' : ''} liveSourceId=${x.liveSourceId ?? '-'}`).join('\n')
      : 'NOT in the REST list. If section 1 found it in the DB, compare with sections 2-4 to see where it drops out; check the server log for "[matches] row cap reached".');
  } catch (e) {
    say(`could not call the server on port ${PORT}: ${e.message}  (is it running? try --port)`);
  }

  if (WS_SECONDS > 0) {
    say(`\n== 6. WebSocket live messages for ${WS_SECONDS}s ==`);
    const seen = new Map();
    await new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
      const done = () => { try { ws.close(); } catch {} resolve(); };
      setTimeout(done, WS_SECONDS * 1000);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', topic: 'live' })));
      ws.on('error', (e) => { say('ws error: ' + e.message); done(); });
      ws.on('message', (d) => {
        try {
          const batch = JSON.parse(String(d));
          for (const msg of Array.isArray(batch) ? batch : [batch]) {
            const id = msg.matchId ?? msg.id; if (!id) continue;
            const k = `${msg.type || '?'}`; const e = seen.get(id) || {}; e[k] = (e[k] || 0) + 1; seen.set(id, e);
          }
        } catch {}
      });
    });
    const ours = [...seen.keys()].filter((id) => rows.some((r) => r.id === id));
    const unknown = [...seen.keys()].filter((id) => restIds.size && !restIds.has(id));
    say(`distinct match ids seen on the socket: ${seen.size}`);
    say(ours.length ? 'our fixture received: ' + ours.map((id) => `${id} ${JSON.stringify(seen.get(id))}`).join('; ') : 'NO socket message used any id of our fixture rows.');
    say(unknown.length ? `socket ids that are NOT in the REST list (live data that cannot reach the screen): ${unknown.slice(0, 15).join(', ')}${unknown.length > 15 ? ' ...(+' + (unknown.length - 15) + ')' : ''}` : 'every socket id exists in the REST list.');
  }
  await pool.end();
}
main().catch((e) => { console.error('[trace] failed:', e.message); process.exit(1); });
