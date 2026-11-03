// "Why is this ticket still open?" for one open leg, in plain words, from the match row (pure: no database).
// blockReason is explainSettleBlock(match) for a finished match that has no result yet.
export function describeOpenLeg({ leg, match, now = Date.now(), blockReason = '' }) {
  const name = `${leg.market_name || ''} · ${leg.selection_name || ''}`.trim();
  const base = { legId: leg.id, matchId: leg.match_id, match: match ? `${match.home_team} v ${match.away_team}` : `${leg.match_home || ''} v ${leg.match_away || ''}`.trim(), selection: name };
  if (!match) return { ...base, code: 'MATCH_MISSING', text: 'Ndeshja nuk gjendet më në sistem (u pastrua ose nuk u ruajt). Mbylle me dorë: Fituese ose Humbëse.' };
  const kickoff = Date.parse(match.start_time);
  const hoursSince = Number.isFinite(kickoff) ? (now - kickoff) / 3600000 : null;
  const score = match.result_home != null && match.result_away != null ? `${match.result_home}-${match.result_away}`
    : match.live_home_score != null && match.live_away_score != null ? `${match.live_home_score}-${match.live_away_score}` : null;
  if (match.status !== 'FINISHED') {
    if (hoursSince != null && hoursSince < 0) return { ...base, code: 'NOT_STARTED', text: `Ndeshja nuk ka filluar ende (fillon pas ${Math.ceil(-hoursSince * 60)} min). Bileta mbyllet vetë pas mbarimit.` };
    if (hoursSince != null && hoursSince >= 4) return { ...base, code: 'STUCK_NOT_FINISHED', text: `Kanë kaluar ${Math.floor(hoursSince)} orë nga fillimi por sistemi nuk e ka shënuar ndeshjen të mbaruar${score ? ` (rezultati i fundit i ruajtur ${score})` : ' dhe nuk ka rezultat të ruajtur'}. Feed-i nuk dha fundin: mbylle me dorë.` };
    return { ...base, code: 'IN_PLAY', text: `Ndeshja është ende në lojë ose pa u mbyllur nga feed-i${match.live_minute ? ` (minuta ${match.live_minute})` : ''}${score ? `, rezultati tani ${score}` : ''}. Bileta mbyllet vetë kur ndeshja mbaron.` };
  }
  if (match.result_home == null || match.result_away == null) return { ...base, code: 'NO_RESULT', text: blockReason || 'Ndeshja është e mbaruar por pa rezultat final të ruajtur.' };
  return { ...base, code: 'NO_RULE_OR_DATA', text: `Ndeshja ka rezultat ${match.result_home}-${match.result_away}, por zgjedhja "${name}" nuk ka rregull automatik ose i mungon një e dhënë (pushimi, kornerë, kartona, ngjarje). Mbylle me dorë: Fituese ose Humbëse, ose më dërgo emrin e tregut që ta shtoj.` };
}

// A finished match with a result whose leg is still open: say exactly which of the two cases it is.
//   DECIDABLE_NOW -> the rules decide it with the result we have; the 2-minute sweep closes it by itself.
//   NO_RULE       -> the market cannot be closed from the result alone (no rule, or it needs half-time / corners / cards /
//                    events that are missing): it will NOT close by itself, the admin closes it or the code is extended.
// `decide(leg, match)` is wouldSettleNow from matchSettlement.js (passed in so this file stays free of the database).
export function refineOpenLeg(d, { leg, match, decide }) {
  if (!d || d.code !== 'NO_RULE_OR_DATA' || !match) return d;
  const h = match.result_home; const a = match.result_away;
  const r = decide(leg, match);
  if (r) return { ...d, code: 'DECIDABLE_NOW', text: `Rregulli e vendos ${r} me rezultatin ${h}-${a}. Mbyllet vetë në kontrollin e radhës (çdo 2 minuta), nuk duhet bërë gjë.` };
  return { ...d, code: 'NO_RULE', text: `Ndeshja ka rezultat final ${h}-${a}, por "${d.selection}" nuk mbyllet dot vetëm me rezultatin: ose tregu nuk ka rregull automatik, ose i mungon një e dhënë (pushimi, kornerë, kartona, ngjarje). NUK do mbyllet vetë: super admini e mbyll me dorë (Fituese / Humbëse), ose ndryshohet kodi: më dërgo emrin e tregut.` };
}
