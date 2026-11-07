// Second source of live data: API-Football (api-sports.io). Used ONLY for matches our main feed gives no usable score/clock
// for (youth, reserve teams, small leagues): it fills in score + minute, logs goals (with the scorer's name), penalties and
// cards, and at full time (plain FT) settles the tickets. Matches the main feed covers properly are never touched.
// Off unless API_FOOTBALL_KEY is set. Request budget: API_FOOTBALL_DAILY_MAX (default 90 = the free plan's 100/day; set
// 7000 on the Pro plan). The key lives in the server environment only, never in the code.
import { pool } from './db.js';
import { sameTeam } from './fixtureDedupe.js';
import { settleMatch } from './matchSettlement.js';
import { hasRealLiveResult } from './london365/liveSync.js';

const BASE = 'https://v3.football.api-sports.io';
const LIVE = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT']);
const SAME_KICKOFF_MS = 3 * 3600 * 1000;

export function statusKind(short) {
  if (short === 'FT') return 'FINISHED'; // plain full time: the only status we settle from
  if (LIVE.has(short)) return 'LIVE';
  if (short === 'AET' || short === 'PEN') return 'FINISHED_EXTRA'; // extra time / penalties: the regular-time score needs care, left alone
  return 'OTHER'; // not started, postponed, cancelled, abandoned...
}

export const parseFixtures = (json) => ((json && json.response) || []).map((f) => ({
  id: f.fixture && f.fixture.id,
  start: Date.parse(f.fixture && f.fixture.date),
  status: f.fixture && f.fixture.status && f.fixture.status.short,
  elapsed: f.fixture && f.fixture.status && f.fixture.status.elapsed,
  home: f.teams && f.teams.home && f.teams.home.name,
  away: f.teams && f.teams.away && f.teams.away.name,
  homeScore: f.goals ? f.goals.home : null,
  awayScore: f.goals ? f.goals.away : null,
})).filter((f) => f.id != null && Number.isFinite(f.start) && f.home && f.away);

// The API fixture that is OUR match: same clubs in the SAME home/away order (a swapped pair is never trusted with money),
// kickoff within 3 h, and exactly one candidate.
export function findFixture(fixtures, row) {
  const t = Date.parse(row.start_time);
  if (!Number.isFinite(t)) return null;
  const hits = fixtures.filter((f) => Math.abs(f.start - t) <= SAME_KICKOFF_MS && sameTeam(row.home_team, f.home) && sameTeam(row.away_team, f.away));
  return hits.length === 1 ? hits[0] : null;
}

const minuteOf = (e) => (e && e.time && Number.isFinite(Number(e.time.elapsed)) ? Number(e.time.elapsed) : null);

// API events -> match_events rows, using the same conventions as the main feed: GOAL rows carry the team NAME and the running
// score; PENALTY / YELLOW_CARD / RED_CARD rows carry 'home'/'away' and a running count. Returns null when the goals do not add up
// to the score the API reports (then nothing is logged: a timeline that contradicts the score is worse than none).
export function eventRows(events, fixture, ourHome, ourAway) {
  const list = Array.isArray(events) ? events : [];
  const sideOf = (teamName) => (sameTeam(teamName, fixture.home) ? 'home' : sameTeam(teamName, fixture.away) ? 'away' : null);
  const rows = [];
  let h = 0, a = 0;
  const count = { PENALTY: { home: 0, away: 0 }, YELLOW_CARD: { home: 0, away: 0 }, RED_CARD: { home: 0, away: 0 } };
  for (const e of list) {
    const side = sideOf(e && e.team && e.team.name);
    if (!side) continue;
    const minute = minuteOf(e);
    const half = minute != null && minute > 45 ? 2 : 1;
    const player = (e.player && e.player.name) || null;
    const detail = String(e.detail || '');
    if (e.type === 'Goal') {
      if (/missed/i.test(detail)) { count.PENALTY[side]++; rows.push({ minute, type: 'PENALTY', team: side, player, detail: String(count.PENALTY[side]), half }); continue; }
      const scoringSide = /own goal/i.test(detail) ? (side === 'home' ? 'away' : 'home') : side; // an own goal counts for the other side
      if (scoringSide === 'home') h++; else a++;
      if (/penalty/i.test(detail)) { count.PENALTY[scoringSide]++; rows.push({ minute, type: 'PENALTY', team: scoringSide, player, detail: String(count.PENALTY[scoringSide]), half }); }
      rows.push({ minute, type: 'GOAL', team: scoringSide === 'home' ? ourHome : ourAway, player: /own goal/i.test(detail) ? (player ? player + ' (a.g.)' : '(a.g.)') : player, detail: h + '-' + a, half });
    } else if (e.type === 'Card') {
      const red = /red/i.test(detail) && !/second yellow/i.test(detail);
      const second = /second yellow/i.test(detail);
      if (second) { count.YELLOW_CARD[side]++; rows.push({ minute, type: 'YELLOW_CARD', team: side, player, detail: String(count.YELLOW_CARD[side]), half }); }
      const type = red || second ? 'RED_CARD' : 'YELLOW_CARD';
      if (type === 'RED_CARD' || !second) { count[type][side]++; rows.push({ minute, type, team: side, player, detail: String(count[type][side]), half }); }
    }
  }
  const sh = Number(fixture.homeScore), sa = Number(fixture.awayScore);
  if (Number.isFinite(sh) && Number.isFinite(sa) && (h !== sh || a !== sa)) return null;
  return rows;
}

// The free plan allows 10 requests per MINUTE (the probe hit this at once); stay under it with a sliding window.
const recent = [];
const perMinute = () => Math.max(1, Number(process.env.API_FOOTBALL_PER_MIN || 8));
export function underMinuteLimit(now, max = perMinute(), log = recent) {
  while (log.length && now - log[0] >= 60000) log.shift();
  return log.length < max;
}
let day = '', used = 0;
const dailyMax = () => Math.max(1, Number(process.env.API_FOOTBALL_DAILY_MAX || 90));
function spend(n = 1, now = Date.now()) {
  const d = new Date(now).toISOString().slice(0, 10);
  if (d !== day) { day = d; used = 0; }
  if (used + n > dailyMax() || !underMinuteLimit(now)) return false;
  used += n;
  recent.push(now);
  return true;
}
export const __resetBudgetForTests = () => { day = ''; used = 0; recent.length = 0; };
export const budgetUsed = () => used;

async function get(path, fetchImpl) {
  const res = await fetchImpl(BASE + path, { headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('API-Football HTTP ' + res.status);
  const json = await res.json();
  if (json.errors && ((Array.isArray(json.errors) && json.errors.length) || (!Array.isArray(json.errors) && Object.keys(json.errors).length))) throw new Error('API-Football: ' + JSON.stringify(json.errors).slice(0, 200));
  return json;
}

async function logEvents(matchId, rows, now) {
  let added = 0;
  for (const r of rows) {
    const { rows: have } = await pool.query('SELECT 1 FROM match_events WHERE match_id = $1 AND type = $2 AND team = $3 AND detail = $4 LIMIT 1', [matchId, r.type, r.team, r.detail]);
    if (have.length) continue;
    await pool.query(
      'INSERT INTO match_events (match_id, minute, type, team, player, detail, created_at, half) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [matchId, r.minute, r.type, r.team, r.player, r.detail, now, r.half]
    );
    added++;
  }
  return added;
}

// Request saving: the fixtures call (1 per day-date, all matches in it) carries score + minute for every match, so the per-match
// events call is made only when it can add something: the score changed (new goal), the match just ended, or 10 minutes have passed
// (cards). Events are also the first thing dropped when 70% of the daily budget is used, so the last 30% is kept for fixtures and
// for settling at full time.
const lastScore = new Map(); // fixture id -> 'h-a' last seen
export function shouldFetchEvents({ kind, h, a, prevScore, lastAt, now, used, max }) {
  if (used >= max * 0.7 && kind !== 'FINISHED') return false;
  if (kind === 'FINISHED') return h + a > 0;
  if (kind !== 'LIVE') return false;
  const score = h + '-' + a;
  if (prevScore !== undefined ? prevScore !== score : h + a > 0) return true; // a goal since last time (or first sight of a score)
  return h + a > 0 && now - (lastAt || 0) >= 10 * 60000; // quiet match: cards every 10 minutes
}
let lastCycleAt = 0;
export const __resetPacingForTests = () => { lastCycleAt = 0; };
const owned = new Set(); // matches this source has written to
const lastEventsAt = new Map(); // fixture id -> ms: events are pulled at most every 2 minutes per match

export async function runApiFootball({ now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
  if (!process.env.API_FOOTBALL_KEY || String(process.env.API_FOOTBALL ?? '1') === '0' || !fetchImpl) return { disabled: true };
  // Only matches somebody has an open ticket on (that is what needs a result); API_FOOTBALL_ALL=1 also covers matches without tickets.
  const hasTicket = "EXISTS (SELECT 1 FROM bet_selections bs WHERE bs.match_id = m.id AND bs.status = 'PENDING')";
  const all = process.env.API_FOOTBALL_ALL === '1';
  const { rows } = await pool.query(
    `SELECT * FROM matches_cache m WHERE m.id LIKE 'l365-%' AND m.settled_at IS NULL AND m.result_home IS NULL
        AND m.start_time::timestamptz BETWEEN $1::timestamptz AND $2::timestamptz
        AND m.status IN ('LIVE', 'UPCOMING', 'FINISHED')
        AND (${all ? "m.status IN ('LIVE', 'UPCOMING') OR " : ''}${hasTicket})`,
    [new Date(now - 30 * 3600 * 1000).toISOString(), new Date(now - 3 * 60 * 1000).toISOString()]
  );
  // Matches the main feed has nothing usable for, plus the ones we already feed (their score/clock now look "real", but the
  // feed still does not update them), plus ones whose feed clock has gone silent for 6+ minutes.
  const need = rows.filter((r) => !hasRealLiveResult(r) || owned.has(r.id) || now - Number(r.live_minute_updated_at || 0) > 6 * 60000);
  if (!need.length) return { candidates: 0 };
  const days = [...new Set(need.map((r) => new Date(Date.parse(r.start_time)).toISOString().slice(0, 10)))];
  // Pacing: spread ~80% of the daily budget over the 24 hours, so a small plan (free: 100/day) lasts the whole day
  // instead of being gone by the afternoon. With a big budget (Pro) the gap is a few seconds and has no effect.
  const gap = (86400000 * 0.8 / dailyMax()) * days.length;
  if (now - lastCycleAt < gap) return { candidates: need.length, paced: true };
  lastCycleAt = now;
  const fixtures = [];
  for (const d of days) {
    if (!spend(1, now)) return { candidates: need.length, budgetExhausted: true };
    fixtures.push(...parseFixtures(await get('/fixtures?date=' + d, fetchImpl)));
  }
  const out = { candidates: need.length, matched: 0, updated: 0, settled: 0, eventsAdded: 0 };
  for (const row of need) {
    const f = findFixture(fixtures, row);
    if (!f) continue;
    out.matched++;
    const kind = statusKind(f.status);
    const hasScore = Number.isFinite(Number(f.homeScore)) && Number.isFinite(Number(f.awayScore)) && f.homeScore != null && f.awayScore != null;
    if (kind === 'OTHER' || kind === 'FINISHED_EXTRA' || !hasScore) continue;
    const h = Number(f.homeScore), a = Number(f.awayScore);
    // events first (scorers, penalties, cards), so the timeline is there when the score appears; skipped when over budget / too soon
    const evKey = String(f.id);
    const scoreNow = h + '-' + a;
    if (shouldFetchEvents({ kind, h, a, prevScore: lastScore.get(evKey), lastAt: lastEventsAt.get(evKey), now, used, max: dailyMax() }) && spend(1, now)) {
      try {
        const ev = await get('/fixtures/events?fixture=' + f.id, fetchImpl);
        lastEventsAt.set(evKey, now); // remembered only after it worked, so a rate-limited call is retried next cycle
        lastScore.set(evKey, scoreNow);
        const evRows = eventRows(ev.response, f, row.home_team, row.away_team);
        if (evRows) out.eventsAdded += await logEvents(row.id, evRows, now);
        else console.warn('[api-football] events of ' + row.id + ' do not add up to the score ' + h + '-' + a + ' -- not logged');
      } catch (err) { console.error('[api-football] events failed:', err.message); }
    }
    if (!lastScore.has(evKey)) lastScore.set(evKey, scoreNow); // remember the score even when events were skipped
    if (kind === 'LIVE') {
      const ht = f.status === 'HT';
      await pool.query(
        `UPDATE matches_cache SET status = 'LIVE', live_home_score = $2, live_away_score = $3, live_minute = $4, live_minute_updated_at = $5, live_status = $6
          WHERE id = $1 AND status <> 'FINISHED'`,
        [row.id, h, a, String(ht ? 45 : (f.elapsed ?? '')), now, ht ? 'HT' : 'live']
      );
      owned.add(row.id);
      out.updated++;
    } else if (kind === 'FINISHED') {
      try {
        const res = await settleMatch(row.id, h, a, { force: true });
        owned.delete(row.id);
        if (res) { out.settled++; console.log('[settle] API-Football result ' + row.home_team + ' v ' + row.away_team + ' ' + h + '-' + a + ': ' + JSON.stringify(res)); }
      } catch (err) { console.error('[api-football] settle failed:', err.message); }
    }
  }
  out.requestsToday = used;
  return out;
}

export function startApiFootballLoop() {
  if (!process.env.API_FOOTBALL_KEY) return;
  const every = Math.max(30000, Number(process.env.API_FOOTBALL_INTERVAL_MS || 180000));
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    runApiFootball().then((r) => { if (r && (r.updated || r.settled || r.eventsAdded || r.budgetExhausted)) console.log('[api-football] ' + JSON.stringify(r)); })
      .catch((err) => console.error('[api-football] cycle failed:', err.message))
      .finally(() => { busy = false; });
  };
  const t = setInterval(tick, every);
  if (t.unref) t.unref();
  setTimeout(tick, 15000);
  console.log('[api-football] second result source on, every ' + every + 'ms, budget ' + dailyMax() + ' requests/day');
}
