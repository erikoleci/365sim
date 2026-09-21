// Announces goals / disallowed goals to connected clients STRAIGHT FROM MEMORY,
// before any database write.
//
// Why: the old order was  score UPDATE -> INSERT match_events -> INSERT
// live_statistics -> pushGoal, i.e. a goal only reached the screen after three
// sequential round trips to Postgres (plus a possible Neon cold start). The
// facts a client needs -- who scored, the new score, the minute -- are already
// in hand the moment the provider tick arrives, so nothing about telling the
// client needs the database. Persistence still happens (match history, stats,
// settlement all read those rows); it just no longer sits in front of the push.
//
// Idempotent: the goal can be detected by more than one path (the fast
// gamedetails socket and the 30s REST loop) and recordGoalIfChanged() announces
// too. lastAnnounced remembers the score we last announced per match, so the
// same score change is pushed exactly once no matter which path sees it first.
import { pushGoal, pushGoalDisallowed } from './ws.js';

const lastAnnounced = new Map(); // matchId -> "home-away" last announced
const MAX_TRACKED = 5000;

export function announceGoalIfChanged(ev, score, minute, prev) {
  if (!score) return false;
  const prevHome = prev ? prev.live_home_score : null;
  const prevAway = prev ? prev.live_away_score : null;
  const hadScoreBefore = prevHome != null && prevAway != null;
  const homeDelta = hadScoreBefore ? score.home - prevHome : score.home;
  const awayDelta = hadScoreBefore ? score.away - prevAway : score.away;
  if (homeDelta === 0 && awayDelta === 0) return false;

  const key = score.home + '-' + score.away;
  if (lastAnnounced.get(ev.id) === key) return false; // already told the clients
  if (lastAnnounced.size >= MAX_TRACKED) lastAnnounced.clear();
  lastAnnounced.set(ev.id, key);

  const m = minute || undefined;
  if (homeDelta > 0) {
    pushGoal(ev.id, { homeScore: score.home, awayScore: score.away, scoringTeam: ev.home_team, minute: m });
  } else if (awayDelta > 0) {
    pushGoal(ev.id, { homeScore: score.home, awayScore: score.away, scoringTeam: ev.away_team, minute: m });
  }
  if (homeDelta < 0) {
    pushGoalDisallowed(ev.id, { homeScore: score.home, awayScore: score.away, team: ev.home_team, minute: m });
  } else if (awayDelta < 0) {
    pushGoalDisallowed(ev.id, { homeScore: score.home, awayScore: score.away, team: ev.away_team, minute: m });
  }
  return true;
}

// The provider reused an id for a different real match, or the match ended:
// the "already announced" memory must not suppress the next match's goals.
export function clearGoalAnnounced(matchId) { lastAnnounced.delete(matchId); }
export function __resetGoalAnnouncerForTests() { lastAnnounced.clear(); }
