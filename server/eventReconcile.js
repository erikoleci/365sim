// Safety net for the "Ngjarjet" list: the events shown can never claim more
// goals (or cards) than the totals we hold for the match. A duplicate goal /
// card row (e.g. written again after the in-memory baseline was lost) is
// dropped from what is SHOWN -- newest extras first -- without touching the
// table. Pure function so it can be unit-tested.
//
//   events : rows from match_events, oldest first
//   totals : { homeTeam, awayTeam, homeScore, awayScore, cardsHome, cardsAway }
//            any null/undefined total means "unknown" -> no trimming for it
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
