// "home|away" -> provider game id, for the global live-detail feed whose messages carry team
// names instead of the game id (EID 52628036). Built from matches_cache rows marked LIVE.
//
// A fixture that exists under two provider ids (the pre-match catalogue record that is merely
// past its kickoff, and the in-play record that really receives live data) used to produce TWO
// rows with the same key; the old index treated that as "ambiguous" and returned null, so the feed
// could never be linked to the match and its events/stats were silently dropped
// (bump 'gamedetails.dropped_team_unresolved'). Now the record that has real live data wins; only a
// genuine tie (two records both live, or neither) stays ambiguous -- one fixture is never mapped
// to another by guessing.
export const normTeam = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function liveRank(r) {
  let rank = 0;
  if (r.live_minute && r.live_minute_updated_at != null) rank += 2; // real provider clock
  if (r.live_home_score != null && r.live_away_score != null) rank += 1;
  return rank;
}

export function buildTeamIndex(rows) {
  const best = new Map(); // key -> { rank, id, tie }
  for (const r of rows) {
    const key = normTeam(r.h) + '|' + normTeam(r.a);
    const id = String(r.game_id).replace(/^l365-/, '');
    const rank = liveRank(r);
    const cur = best.get(key);
    if (!cur || rank > cur.rank) best.set(key, { rank, id, tie: false });
    else if (rank === cur.rank && id !== cur.id) cur.tie = true;
  }
  const map = new Map();
  for (const [key, v] of best) map.set(key, v.tie ? null : v.id); // null = ambiguous
  return map;
}
