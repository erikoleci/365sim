// READ-ONLY test of API-Football (api-sports.io) as a second source of results. Nothing is written anywhere.
// For every match we hold for today (and yesterday) it says whether API-Football has the same fixture, with what
// status/score/minute, and (with EVENTS=1) who scored, when, penalties and cards -- so you can see the real coverage
// of the small leagues (youth, reserve teams) BEFORE paying. One request per day of fixtures (+1 per match with EVENTS=1).
// Run:  API_FOOTBALL_KEY=xxxx node server/apiFootballProbe.js        (add EVENTS=1 for the goal/card details)
import pool from './db.js';
import { sameFixture } from './fixtureDedupe.js';

const KEY = process.env.API_FOOTBALL_KEY;
const BASE = 'https://v3.football.api-sports.io';
const WITH_EVENTS = process.env.EVENTS === '1';
if (!KEY) { console.log('Set API_FOOTBALL_KEY first (free key: dashboard.api-football.com).'); process.exit(1); }

export const parseFixtures = (json) => ((json && json.response) || []).map((f) => ({
  id: f.fixture && f.fixture.id, start: Date.parse(f.fixture && f.fixture.date), status: f.fixture && f.fixture.status && f.fixture.status.short,
  elapsed: f.fixture && f.fixture.status && f.fixture.status.elapsed, home: f.teams.home.name, away: f.teams.away.name,
  homeScore: f.goals.home, awayScore: f.goals.away, league: f.league && f.league.name,
}));
export const describeEvent = (e) => (e.time && e.time.elapsed != null ? e.time.elapsed + (e.time.extra ? '+' + e.time.extra : '') + "' " : '') + [e.type, e.detail].filter(Boolean).join('/') + ' ' + ((e.player && e.player.name) || '?') + ' (' + ((e.team && e.team.name) || '?') + ')';

async function get(path) {
  const res = await fetch(BASE + path, { headers: { 'x-apisports-key': KEY } });
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length) console.log('API error:', JSON.stringify(json.errors));
  return json;
}

if (process.argv[1] && process.argv[1].endsWith('apiFootballProbe.js')) {
  const days = [0, -1].map((d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10));
  const fixtures = [];
  for (const day of days) fixtures.push(...parseFixtures(await get('/fixtures?date=' + day)));
  console.log('API-Football fixtures for ' + days.join(' + ') + ': ' + fixtures.length);
  const { rows } = await pool.query(
    `SELECT id, home_team, away_team, start_time, status, live_home_score, live_away_score, live_minute FROM matches_cache
      WHERE id LIKE 'l365-%' AND start_time::timestamptz > now() - interval '30 hours' AND start_time::timestamptz < now() ORDER BY start_time`);
  let found = 0, missing = 0;
  for (const m of rows) {
    const t = Date.parse(m.start_time);
    const hits = fixtures.filter((f) => Math.abs(f.start - t) <= 3 * 3600000 && sameFixture({ homeTeam: m.home_team, awayTeam: m.away_team }, { homeTeam: f.home, awayTeam: f.away }));
    const ours = (m.live_home_score != null ? m.live_home_score + '-' + m.live_away_score : 'no score') + (m.live_minute ? ' ' + m.live_minute : '');
    if (!hits.length) { missing++; console.log('NOT FOUND  ' + m.home_team + ' v ' + m.away_team + '  [ours: ' + ours + ', ' + m.status + ']'); continue; }
    found++;
    const f = hits[0];
    console.log('found      ' + m.home_team + ' v ' + m.away_team + '  [ours: ' + ours + ']  API: ' + f.status + ' ' + f.homeScore + '-' + f.awayScore + (f.elapsed ? ' ' + f.elapsed + "'" : '') + '  (' + f.league + ')');
    if (WITH_EVENTS && f.id) {
      const ev = await get('/fixtures/events?fixture=' + f.id);
      for (const e of (ev.response || [])) console.log('             ' + describeEvent(e));
    }
  }
  console.log('\nSUMMARY: ' + found + ' of ' + rows.length + ' of our matches found in API-Football, ' + missing + ' not found.');
  await pool.end();
}
