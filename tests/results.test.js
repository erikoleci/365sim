import { describe, it, expect } from 'vitest';
import { recentResults, groupResultsByLeague, RESULTS_WINDOW_MS } from '../utils/results.ts';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const H = 3600 * 1000;
const m = (id, hoursAgo, o = {}) => ({ id, league: 'epl', status: 'FINISHED', score: { home: 2, away: 1 }, startTime: new Date(NOW - hoursAgo * H).toISOString(), homeTeam: 'Home ' + id, awayTeam: 'Away ' + id, ...o });

describe('recentResults - the "Rezultate" section (finished, last 48 hours)', () => {
  it('keeps only FINISHED matches within 48 hours of kickoff, newest first', () => {
    const list = [m('old', 49), m('edge', 47.9), m('new', 3), m('live', 1, { status: 'LIVE' }), m('soon', -2), m('up', 5, { status: 'UPCOMING' })];
    expect(recentResults(list, '', NOW).map((x) => x.id)).toEqual(['new', 'edge']);
  });
  it('the window is exactly 48h', () => {
    expect(RESULTS_WINDOW_MS).toBe(48 * H);
    expect(recentResults([m('exact', 48)], '', NOW)).toHaveLength(1);
    expect(recentResults([m('over', 48.01)], '', NOW)).toHaveLength(0);
  });
  it('search filters by team or league, case-insensitive', () => {
    const list = [m('a', 2, { homeTeam: 'Chelsea', awayTeam: 'Bournemouth' }), m('b', 3, { homeTeam: 'Ipswich', league: 'championship' })];
    expect(recentResults(list, 'CHELSEA', NOW).map((x) => x.id)).toEqual(['a']);
    expect(recentResults(list, 'champion', NOW).map((x) => x.id)).toEqual(['b']);
  });
  it('a match closed without a real final score is NOT a result (no invented 0-0)', () => {
    const list = [m('settled', 2), m('noScore', 3, { score: undefined }), m('nullScore', 4, { score: { home: null, away: null } }), m('zero', 5, { score: { home: 0, away: 0 } })];
    expect(recentResults(list, '', NOW).map((x) => x.id)).toEqual(['settled', 'zero']); // a real 0-0 is kept
  });
  it('a row with an unreadable date is never shown', () => {
    expect(recentResults([m('bad', 1, { startTime: 'nope' })], '', NOW)).toEqual([]);
  });
  it('groups by league, the league with the most recent match first', () => {
    const list = recentResults([m('a', 10, { league: 'laliga' }), m('b', 2, { league: 'epl' }), m('c', 12, { league: 'epl' })], '', NOW);
    const groups = groupResultsByLeague(list);
    expect(groups.map((g) => g.league)).toEqual(['epl', 'laliga']);
    expect(groups[0].matches.map((x) => x.id)).toEqual(['b', 'c']);
  });
});
