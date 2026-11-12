// READ-ONLY audit of the matches behind the tickets of the last hours: our final / live / half-time score, the goal, scorer and corner rows
// of the timeline, and (when the Flashscore scraper is reachable) Flashscore's score. It changes NOTHING; every difference is a line the
// owner reviews before anything is corrected by hand (a settled ticket is never re-decided automatically).
import { serviceBase, enabled } from './flashscoreProc.js';
import { parseMatchList, findFlashscoreMatch } from './flashscoreMap.js';

const n = (v) => (v == null || v === '' ? null : Number(v));

// Pure: one match row + its event rows + corner totals (+ Flashscore fixture) -> problems.
export function auditMatch(m, events, corners, fs) {
  const problems = [];
  const rh = n(m.result_home), ra = n(m.result_away), lh = n(m.live_home_score), la = n(m.live_away_score);
  const goals = (events || []).filter((e) => e.type === 'GOAL');
  const gh = goals.filter((e) => e.team === m.home_team).length, ga = goals.filter((e) => e.team === m.away_team).length;
  if (m.status === 'FINISHED' && rh != null && ra != null) {
    if (lh != null && la != null && (lh !== rh || la !== ra)) problems.push(`result ${rh}-${ra} differs from the last live score ${lh}-${la}`);
    if (rh + ra === 0 && goals.length > 0) problems.push(`result 0-0 but the timeline has ${goals.length} goal row(s)`);
    else if (goals.length && (gh !== rh || ga !== ra)) problems.push(`timeline goals ${gh}-${ga} differ from result ${rh}-${ra}`);
    if (!goals.length && rh + ra > 0) problems.push(`result ${rh}-${ra} but no goal rows in the timeline`);
  }
  const noScorer = goals.filter((e) => !e.player).length;
  if (noScorer) problems.push(`${noScorer} goal(s) without a scorer`);
  if (corners) {
    const ch = (events || []).filter((e) => e.type === 'CORNER' && e.team === 'home').length;
    const ca = (events || []).filter((e) => e.type === 'CORNER' && e.team === 'away').length;
    if (n(corners.corners_home) != null && ch < n(corners.corners_home)) problems.push(`home corners: ${ch} rows for a total of ${corners.corners_home}`);
    if (n(corners.corners_away) != null && ca < n(corners.corners_away)) problems.push(`away corners: ${ca} rows for a total of ${corners.corners_away}`);
  }
  if (fs && fs.homeScore != null && fs.awayScore != null && /finish|ended|ft/i.test(String(fs.status || ''))) {
    if (rh != null && ra != null && (Number(fs.homeScore) !== rh || Number(fs.awayScore) !== ra)) problems.push(`Flashscore final ${fs.homeScore}-${fs.awayScore} differs from our result ${rh}-${ra}`);
  }
  return problems;
}

export async function buildDayAudit(pool, { hours = 30, now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
  const { rows: matches } = await pool.query(
    `SELECT m.id, m.home_team, m.away_team, m.start_time, m.status, m.live_status, m.live_minute, m.live_home_score, m.live_away_score,
            m.result_home, m.result_away, m.ht_home, m.ht_away, COUNT(*)::int AS legs,
            COUNT(*) FILTER (WHERE bs.status = 'PENDING')::int AS pending, COUNT(*) FILTER (WHERE bs.status = 'WON')::int AS won,
            COUNT(*) FILTER (WHERE bs.status = 'LOST')::int AS lost, COUNT(DISTINCT bs.bet_id)::int AS tickets
       FROM bet_selections bs JOIN bets b ON b.id = bs.bet_id JOIN matches_cache m ON m.id = bs.match_id
      WHERE b.created_at > $1
      GROUP BY m.id ORDER BY m.start_time`,
    [now - hours * 3600 * 1000]
  );
  let list = [];
  let flashscore = 'off';
  try {
    const base = enabled() && fetchImpl ? serviceBase({ now }) : null;
    if (base) {
      for (const day of [0, -1, -2]) {
        const res = await fetchImpl(`${base}/matches?sport=football&day=${day}`, { signal: AbortSignal.timeout(20000) });
        if (res.ok) list.push(...parseMatchList(await res.json()));
      }
      flashscore = 'on';
    }
  } catch { flashscore = 'unreachable'; list = []; }
  const out = [];
  for (const m of matches) {
    const { rows: events } = await pool.query('SELECT type, team, player, minute, detail, half FROM match_events WHERE match_id = $1 ORDER BY created_at', [m.id]);
    const { rows: cs } = await pool.query('SELECT corners_home, corners_away FROM live_statistics WHERE match_id = $1', [m.id]);
    const fs = list.length ? findFlashscoreMatch(list, m) : null;
    const problems = auditMatch(m, events, cs[0] || null, fs);
    if (flashscore === 'on' && !fs) problems.push('not found on Flashscore');
    out.push({
      id: m.id, match: `${m.home_team} - ${m.away_team}`, start: m.start_time, status: m.status,
      result: m.result_home != null ? `${m.result_home}-${m.result_away}` : null, live: m.live_home_score != null ? `${m.live_home_score}-${m.live_away_score}` : null,
      ht: m.ht_home != null ? `${m.ht_home}-${m.ht_away}` : null, flashscoreScore: fs && fs.homeScore != null ? `${fs.homeScore}-${fs.awayScore} (${fs.status || '?'})` : null,
      tickets: m.tickets, legs: { total: m.legs, pending: m.pending, won: m.won, lost: m.lost }, problems,
    });
  }
  return { hours, flashscore, matches: out.length, withProblems: out.filter((x) => x.problems.length).length, list: out.sort((a, b) => b.problems.length - a.problems.length) };
}
