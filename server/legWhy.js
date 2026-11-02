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
