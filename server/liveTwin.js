// The same real fixture can exist under two provider ids: the pre-match record (full markets, the one a ticket
// points at) and the in-play record that actually receives the score, minute and events. A ticket leg on the
// pre-match record would show "~85'" with no score and an empty timeline although the match is being played.
// This finds the record that carries the live data so the ticket can show it.
import { sameFixture, sameTeam } from './fixtureDedupe.js';

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
      || sameKickoffFixture(row, c, t)));
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
export const __resetLiveTwinCache = () => cache.clear();
