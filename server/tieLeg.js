// First / second leg of a two-legged tie, from OUR OWN data (the coupon), not from an outside feed.
// A match is a tie leg only when its coupon has the "To qualify" market (that is how the bookmaker marks a two-legged tie; league
// pairs that merely meet twice a season never have it). Second leg = the same two clubs with the sides swapped, same competition,
// played earlier and already finished: its score is the first leg and the aggregate is that plus the score now.
// First leg = the same pair is scheduled later in the same competition. Nothing else is claimed.
import { looseSameClub } from './fixtureLink.js';

const TIE_WINDOW_MS = 75 * 86400000;
export const hasToQualify = (rawJson) => /to qualify|skuadra qe kualifikohet/i.test(String(rawJson || ''));

// m = matches_cache row; others = rows of { id, home_team, away_team, start_time, result_home, result_away, status } of the same competition
// (cache + archive). nowScore = { home, away } or null.
export function tieInfo(m, others, nowScore) {
  if (!m || !hasToQualify(m.raw_json)) return null;
  const t0 = Date.parse(m.start_time);
  if (!Number.isFinite(t0)) return null;
  const pair = (others || []).filter((c) => c.id !== m.id && looseSameClub(m.away_team, c.home_team) && looseSameClub(m.home_team, c.away_team) && Number.isFinite(Date.parse(c.start_time)));
  const earlier = pair.filter((c) => Date.parse(c.start_time) < t0 && t0 - Date.parse(c.start_time) <= TIE_WINDOW_MS && c.result_home != null && c.result_away != null)
    .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time))[0];
  if (earlier) {
    const first = `${earlier.result_home}-${earlier.result_away}`; // as played: first leg's home side = our away side
    const h = Number(earlier.result_away); const a = Number(earlier.result_home);
    const agg = nowScore && Number.isFinite(nowScore.home) && Number.isFinite(nowScore.away) ? `${nowScore.home + h}-${nowScore.away + a}` : null;
    return { leg: 2, aggregate: agg, firstLeg: first, legText: `1st leg ${first} (${earlier.home_team} v ${earlier.away_team})` };
  }
  const later = pair.some((c) => Date.parse(c.start_time) > t0 && Date.parse(c.start_time) - t0 <= TIE_WINDOW_MS);
  return later ? { leg: 1, aggregate: null, firstLeg: null, legText: null } : null;
}

export async function loadTieInfo(query, m, nowScore) {
  if (!m || !hasToQualify(m.raw_json)) return null;
  try {
    const params = [m.league, m.id];
    const { rows: a } = await query(`SELECT id, home_team, away_team, start_time, result_home, result_away, status FROM matches_cache WHERE league = $1 AND id <> $2`, params);
    let rows = a;
    try { const { rows: b } = await query(`SELECT match_id AS id, home_team, away_team, start_time, result_home, result_away, 'FINISHED' AS status FROM match_results WHERE league = $1 AND match_id <> $2`, params); rows = a.concat(b); } catch { /* archive not migrated */ }
    return tieInfo(m, rows, nowScore);
  } catch { return null; }
}
