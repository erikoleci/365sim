// The same real fixture can exist under two provider ids: the pre-match record (full markets, the one a ticket
// points at) and the in-play record that actually receives the score, minute and events. A ticket leg on the
// pre-match record would show "~85'" with no score and an empty timeline although the match is being played.
// This finds the record that carries the live data so the ticket can show it.
import { sameFixture, sameTeam } from './fixtureDedupe.js';
import { strictSameFixture } from './fixtureLink.js';

const WINDOW_MS = 3 * 60 * 60 * 1000;
// Same kick-off (a team never plays two matches at once) and ONE side is the same club is enough to call two records
// the same fixture; this tolerates the providers writing the other club differently ("AD Pasto" / "Deportivo Pasto").
const SAME_KICKOFF_MS = 20 * 60 * 1000;
const sameKickoffFixture = (row, c, t) => {
  if (Math.abs(Date.parse(c.start_time) - t) > SAME_KICKOFF_MS) return false;
  return sameTeam(row.home_team, c.home_team) || sameTeam(row.away_team, c.away_team)
    || sameTeam(row.home_team, c.away_team) || sameTeam(row.away_team, c.home_team);
};
const hasLiveData = (row) => row && (row.live_home_score != null || row.live_minute != null || row.result_home != null);

// Pure: choose the live twin of `row` among `candidates` (raw matches_cache rows), or null.
export function pickLiveTwin(row, candidates) {
  if (!row || hasLiveData(row)) return null; // it receives live data itself
  const t = Date.parse(row.start_time);
  if (Number.isNaN(t)) return null;
  const same = (candidates || []).filter((c) => c && c.id !== row.id && hasLiveData(c)
    && Math.abs(Date.parse(c.start_time) - t) <= WINDOW_MS
    && (sameFixture({ homeTeam: row.home_team, awayTeam: row.away_team }, { homeTeam: c.home_team, awayTeam: c.away_team })
      || sameKickoffFixture(row, c, t) || strictSameFixture(row, c)));
  if (!same.length) return null;
  same.sort((x, y) => Number(y.live_minute_updated_at || 0) - Number(x.live_minute_updated_at || 0));
  return same[0];
}

const cache = new Map(); // id -> { at, twin }
const TTL_MS = 20 * 1000;

// The in-play twin ROW of `row` (or null). Cached briefly: the lookup scans the rows of the same time window and
// ticket screens / placement call it every few seconds.
export async function liveTwinRowFor(query, row, { ttlMs = TTL_MS } = {}) {
  if (!row || hasLiveData(row)) return null;
  const hit = cache.get(row.id);
  if (hit && Date.now() - hit.at < ttlMs) return hit.twin;
  let twin = null;
  try {
    const t = Date.parse(row.start_time);
    if (!Number.isNaN(t)) {
      const { rows } = await query(
        `SELECT * FROM matches_cache WHERE id <> $1 AND (live_home_score IS NOT NULL OR live_minute IS NOT NULL OR result_home IS NOT NULL)
            AND start_time::timestamptz BETWEEN $2::timestamptz AND $3::timestamptz`,
        [row.id, new Date(t - WINDOW_MS).toISOString(), new Date(t + WINDOW_MS).toISOString()]
      );
      twin = pickLiveTwin(row, rows);
    }
  } catch { twin = null; }
  cache.set(row.id, { at: Date.now(), twin });
  return twin;
}

// Id that really receives the live data for `row` (its own id, or the twin's).
export async function liveSourceIdFor(query, row) {
  if (!row) return null;
  const twin = await liveTwinRowFor(query, row);
  return twin ? twin.id : row.id;
}

// `row` with the twin's live fields laid over it (score, minute, clock status, FINISHED) and `live_source_id` set,
// so every rule that reads the match row (price gate, certainty net, locks) sees the real match situation. Odds and
// markets stay the pre-match record's own. Same row back when there is no twin.
export async function withLiveTwin(query, row) {
  const twin = await liveTwinRowFor(query, row, { ttlMs: 5000 });
  if (!twin) return row;
  return {
    ...row,
    status: twin.status === 'FINISHED' || twin.status === 'LIVE' ? twin.status : row.status,
    live_status: twin.live_status ?? row.live_status,
    live_minute: twin.live_minute ?? row.live_minute,
    live_minute_updated_at: twin.live_minute_updated_at ?? row.live_minute_updated_at,
    live_home_score: twin.live_home_score ?? row.live_home_score,
    live_away_score: twin.live_away_score ?? row.live_away_score,
    result_home: twin.result_home ?? row.result_home,
    result_away: twin.result_away ?? row.result_away,
    live_source_id: twin.id,
  };
}
// The record whose events and statistics a ticket / results screen should show: the one of the SAME fixture (the row
// itself or any same-fixture record) that actually holds the most logged events. liveSourceIdFor only looks for a twin
// when the row has no live data of its own, so a pre-match record that got a stray minute or score (or a twin whose
// name differs) showed an empty timeline while the live page, on the other record, was full.
const evCache = new Map(); // id -> { at, id }
export async function eventSourceIdFor(query, row, { ttlMs = TTL_MS } = {}) {
  if (!row) return null;
  const hit = evCache.get(row.id);
  if (hit && Date.now() - hit.at < ttlMs) return hit.id;
  let best = row.id;
  try {
    const t = Date.parse(row.start_time);
    if (!Number.isNaN(t)) {
      const { rows } = await query(
        `SELECT id, home_team, away_team, start_time, league FROM matches_cache WHERE id <> $1
            AND start_time::timestamptz BETWEEN $2::timestamptz AND $3::timestamptz`,
        [row.id, new Date(t - WINDOW_MS).toISOString(), new Date(t + WINDOW_MS).toISOString()]
      );
      const same = (rows || []).filter((c) => sameFixture({ homeTeam: row.home_team, awayTeam: row.away_team }, { homeTeam: c.home_team, awayTeam: c.away_team })
        || sameKickoffFixture(row, c, t) || strictSameFixture(row, c));
      if (same.length) {
        const ids = [row.id, ...same.map((c) => c.id)];
        const { rows: cnt } = await query('SELECT match_id, COUNT(*)::int AS n FROM match_events WHERE match_id = ANY($1::text[]) GROUP BY match_id', [ids]);
        const n = new Map((cnt || []).map((r) => [r.match_id, Number(r.n)]));
        let top = n.get(row.id) || 0;
        for (const id of ids) { if ((n.get(id) || 0) > top) { top = n.get(id); best = id; } }
      }
    }
  } catch { best = row.id; }
  evCache.set(row.id, { at: Date.now(), id: best });
  return best;
}
// A record that is about to be closed from its OWN last score may have a twin that is still being fed (ticket #120: the
// catalogue record froze at 2-4 in minute 76, the match ended 4-4 on the in-play record). candidates = rows with live data
// of the same time window. -> { action: 'own' } no twin, close from its own score as before
//                              { action: 'wait' } a twin is still playing / has no final score: do NOT settle yet
//                              { action: 'twin', home, away, twinId } the twin finished: settle on ITS score (sides aligned)
export function endTwinVerdict(row, candidates) {
  const twins = (candidates || []).filter((c) => c && c.id !== row.id && strictSameFixture(row, c));
  if (!twins.length) return { action: 'own' };
  const done = twins.filter((c) => c.status === 'FINISHED' && c.result_home != null && c.result_away != null);
  if (done.length !== 1 || twins.length !== done.length) return { action: 'wait' };
  const c = done[0];
  const straight = sameTeam(row.home_team, c.home_team) || sameTeam(row.away_team, c.away_team);
  const crossed = sameTeam(row.home_team, c.away_team) && sameTeam(row.away_team, c.home_team);
  if (straight === crossed) return { action: 'wait' }; // sides cannot be aligned with certainty
  return { action: 'twin', twinId: c.id, home: Number(crossed ? c.result_away : c.result_home), away: Number(crossed ? c.result_home : c.result_away) };
}
export const __resetLiveTwinCache = () => { cache.clear(); evCache.clear(); };
