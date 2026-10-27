// Safety net for the "Ngjarjet" list: the events shown can never claim more
// goals (or cards) than the totals we hold for the match. A duplicate goal /
// card row (e.g. written again after the in-memory baseline was lost) is
// dropped from what is SHOWN -- newest extras first -- without touching the
// table. Pure function so it can be unit-tested.
//
//   events : rows from match_events, oldest first
//   totals : { homeTeam, awayTeam, homeScore, awayScore, cardsHome, cardsAway }
//            any null/undefined total means "unknown" -> no trimming for it
// Marks every event with the half it was played in, so the list never guesses from the minute
// (a corner at 47' in first-half stoppage time is NOT a second-half event).
//   htAt     : epoch ms the half-time whistle was first seen (matches_cache.ht_at), or null
//   htKnown  : half time already stored for the match (ht_home/ht_away or ht_at set)
//   isLive   : the match is LIVE right now
// Before the whistle (live, no half-time stored) every event is first half. After it, an event
// is first half when it was written before the whistle. Without a usable whistle time (old
// matches, finished matches with no capture) `half` stays undefined and the client falls back
// to its minute rule.
export function annotateHalves(events, { htAt, htKnown, isLive } = {}) {
  const at = htAt != null && Number.isFinite(Number(htAt)) ? Number(htAt) : null;
  return (events || []).map((ev) => {
    if (at != null) return { ...ev, half: Number(ev.created_at) < at ? 1 : 2 };
    if (!htKnown && isLive) return { ...ev, half: 1 };
    return ev;
  });
}

export function reconcileEvents(events, totals) {
  const { homeTeam, awayTeam, homeScore, awayScore, cardsHome, cardsAway } = totals || {};
  const left = {
    goalHome: Number.isFinite(Number(homeScore)) && homeScore != null ? Number(homeScore) : null,
    goalAway: Number.isFinite(Number(awayScore)) && awayScore != null ? Number(awayScore) : null,
    cardHome: Number.isFinite(Number(cardsHome)) && cardsHome != null ? Number(cardsHome) : null,
    cardAway: Number.isFinite(Number(cardsAway)) && cardsAway != null ? Number(cardsAway) : null,
  };
  const out = [];
  const seen = new Set();
  for (const ev of events || []) {
    // Exact duplicate (same type, team and running count/score): shown once.
    if (ev.detail != null && ev.detail !== '' && ['GOAL', 'CORNER', 'YELLOW_CARD', 'RED_CARD'].includes(ev.type)) {
      const dk = ev.type + '|' + ev.team + '|' + ev.detail;
      if (seen.has(dk)) continue;
      seen.add(dk);
    }
    let key = null;
    if (ev.type === 'GOAL') key = ev.team === homeTeam ? 'goalHome' : ev.team === awayTeam ? 'goalAway' : null;
    else if (ev.type === 'YELLOW_CARD' || ev.type === 'RED_CARD') key = ev.team === 'home' ? 'cardHome' : ev.team === 'away' ? 'cardAway' : null;
    if (key && left[key] != null) {
      if (left[key] <= 0) continue; // more events than the total allows
      left[key] -= 1;
    }
    out.push(ev);
  }
  return out;
}
