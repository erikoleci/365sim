import { describe, it, expect } from 'vitest';
import { parseMatchList, incidentRows, bigChances, otherStats, incidentDiag, findFlashscoreMatch } from '../server/flashscoreMap.js';

const inc = (team, minute, type, name, extra = {}) => ({ team, minute: `${minute}'`, minute_number: minute, type, player: name ? { name } : null, reason: null, description: '', ...extra });
const summary = (...incidents) => ({ periods: [{ period: '1st Half', incidents: incidents.slice(0, 2) }, { period: '2nd Half', incidents: incidents.slice(2) }] });
const fx = (h, a) => ({ homeScore: h, awayScore: a });

describe('flashscore incidents -> match_events rows', () => {
  it('goals carry the scorer, team name and running score', () => {
    const rows = incidentRows(summary(inc('home', 10, 'Goal', 'Kane H.'), inc('away', 40, 'Goal', 'Mbappe K.'), inc('home', 77, 'Goal', 'Kane H.')), fx(2, 1), 'Bayern', 'PSG');
    expect(rows.filter((r) => r.type === 'GOAL').map((r) => [r.team, r.player, r.detail, r.half])).toEqual([['Bayern', 'Kane H.', '1-0', 1], ['PSG', 'Mbappe K.', '1-1', 1], ['Bayern', 'Kane H.', '2-1', 2]]);
  });
  it('a penalty goal also gets a PENALTY row (running count per side)', () => {
    const rows = incidentRows(summary(inc('home', 22, 'Goal', 'Kane H.', { reason: 'Penalty' })), fx(1, 0), 'A', 'B');
    expect(rows.map((r) => [r.type, r.team, r.detail])).toEqual([['PENALTY', 'home', '1'], ['GOAL', 'A', '1-0']]);
  });
  it('a missed or saved penalty is a PENALTY row without a goal', () => {
    const rows = incidentRows(summary(inc('away', 30, 'Penalty missed', 'Son H.', { description: 'penalty saved by the keeper' })), fx(0, 0), 'A', 'B');
    expect(rows).toEqual([{ minute: 30, type: 'PENALTY', team: 'away', player: 'Son H.', detail: '1', half: 1 }]);
  });
  it('own goal counts for the other side', () => {
    const rows = incidentRows(summary(inc('home', 50, 'Own Goal', 'Defender D.')), fx(0, 1), 'A', 'B');
    expect(rows[0]).toMatchObject({ type: 'GOAL', team: 'B', detail: '0-1', player: 'Defender D. (a.g.)' });
  });
  it('cards are counted and a second yellow gives yellow + red', () => {
    const rows = incidentRows(summary(inc('home', 12, 'Yellow Card', 'X'), inc('home', 60, 'Yellow/Red Card', 'X')), fx(0, 0), 'A', 'B');
    expect(rows.map((r) => [r.type, r.detail])).toEqual([['YELLOW_CARD', '1'], ['YELLOW_CARD', '2'], ['RED_CARD', '1']]);
  });
  it('substitutions and assists are ignored', () => {
    expect(incidentRows(summary(inc('home', 60, 'Substitution - In', 'X'), inc('home', 60, 'Assistance', 'Y')), fx(0, 0), 'A', 'B')).toEqual([]);
  });
  it('goals that do not add up to the reported score are not logged at all', () => {
    expect(incidentRows(summary(inc('home', 10, 'Goal', 'K')), fx(2, 0), 'A', 'B')).toBeNull();
  });
});

describe('big chances, matching', () => {
  it('reads Big chances from the whole-match period', () => {
    const stats = { periods: [{ period: 'Match', groups: [{ statistics: [{ name: 'Big chances', home_value: 3, away_value: 1 }] }] }, { period: '1st Half', groups: [{ statistics: [{ name: 'Big chances', home_value: 2, away_value: 0 }] }] }] };
    expect(bigChances(stats)).toEqual({ home: 3, away: 1 });
    expect(bigChances({ periods: [] })).toBeNull();
  });
  it('parses the list and matches only an unambiguous same-order fixture', () => {
    const list = parseMatchList({ competitions: [{ competition: { name: 'UCL' }, matches: [{ id: 'abc', start_time: '2026-11-11T20:00:00Z', home: { name: 'Bayern' }, away: { name: 'PSG' }, home_score: 1, away_score: 0, round: 'Round of 16', note: '1st leg' }] }] });
    expect(list).toHaveLength(1);
    expect(findFlashscoreMatch(list, { home_team: 'Bayern', away_team: 'PSG', start_time: '2026-11-11T20:05:00Z' })?.id).toBe('abc');
    expect(findFlashscoreMatch(list, { home_team: 'PSG', away_team: 'Bayern', start_time: '2026-11-11T20:05:00Z' })).toBeNull(); // swapped pair never trusted
  });
});

describe('substitutions and the other statistics', () => {
  it('a substitution row has the player coming on and the one going off; one without both names is skipped', () => {
    const rows = incidentRows(summary(inc('home', 46, 'Substitution - Out', 'Lukebakio D.', { substituted_in: { name: 'Romero I.' } }), inc('away', 58, 'Substitution - Out', 'Endrick', {})), fx(0, 0), 'A', 'B');
    expect(rows).toEqual([{ minute: 46, type: 'SUBSTITUTION', team: 'home', player: 'Romero I.', detail: 'Lukebakio D.', half: 2 }]);
  });
  it('keeps only statistics the main feed lacks', () => {
    const stats = { periods: [{ period: 'Match', groups: [{ statistics: [
      { name: 'Ball possession', home: '60%', away: '40%' }, { name: 'Total shots', home: '10', away: '4' },
      { name: 'Passes', home: '81% (281/346)', away: '70% (200/285)' }, { name: 'Tackles', home: '12', away: '15' }, { name: 'Big chances', home: '3', away: '1' },
    ] }] }] };
    expect(otherStats(stats).map((s) => s.name)).toEqual(['Passes', 'Tackles', 'Big chances']);
    expect(otherStats({ periods: [] })).toEqual([]);
  });
});

describe('small leagues: different club spellings', () => {
  const list = parseMatchList({ competitions: [{ competition: { name: 'Super Division' }, matches: [
    { id: 'm1', start_time: '2026-11-12T08:00:00Z', home: { name: 'Bengaluru FC B' }, away: { name: 'Rebels FC' }, home_score: 0, away_score: 1 },
    { id: 'm2', start_time: '2026-11-12T08:00:00Z', home: { name: 'Mumbai City B' }, away: { name: 'Soccerstar' }, home_score: 1, away_score: 0 },
  ] }] });
  it('matches "Bengaluru B" to "Bengaluru FC B" when the kickoff is the same minute', () => {
    expect(findFlashscoreMatch(list, { home_team: 'Bengaluru B', away_team: 'Rebels FC', start_time: '2026-11-12T08:00:00Z' })?.id).toBe('m1');
  });
  it('does not accept a loose name match when the kickoff is 4 hours apart', () => {
    expect(findFlashscoreMatch(list, { home_team: 'Bengaluru B', away_team: 'Rebels FC', start_time: '2026-11-12T12:00:00Z' })).toBeNull();
  });
});

describe('score reference when the list has no score', () => {
  const g = (team, minute, h, a) => inc(team, minute, 'Goal', 'P', { home_score: h, away_score: a });
  it('uses the running score printed on the last goal', () => {
    const rows = incidentRows(summary(g('home', 10, 1, 0), g('home', 40, 2, 0)), { homeScore: null, awayScore: null }, 'A', 'B');
    expect(rows.filter((r) => r.type === 'GOAL')).toHaveLength(2);
  });
  it('still refuses when the incidents contradict that running score', () => {
    expect(incidentRows(summary(g('home', 10, 1, 0), g('home', 40, 3, 0)), { homeScore: null, awayScore: null }, 'A', 'B')).toBeNull();
  });
  it('refuses goals when there is no score to check against at all', () => {
    expect(incidentRows(summary(inc('home', 10, 'Goal', 'P')), { homeScore: null, awayScore: null }, 'A', 'B')).toBeNull();
  });
  it('describes what was seen', () => {
    expect(incidentDiag(summary(inc('home', 10, 'Goal', 'P'), inc('home', 20, 'Goal', 'Q')), { homeScore: 5, awayScore: 0 })).toBe('list score 5-0; 2 incidents (Goalx2)');
  });
});
