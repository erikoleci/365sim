import { describe, it, expect, vi } from 'vitest';
import { strictSameFixture } from '../server/fixtureLink.js';
import { pickLiveTwin as pickLiveTwinRow } from '../server/liveTwin.js';

vi.mock('../server/db.js', () => ({ default: { query: vi.fn() }, pool: { query: vi.fn() }, setKV: vi.fn(), getKV: vi.fn() }));
const { pickLiveTwin: pickSettleTwin } = await import('../server/matchSettlement.js');

const row = (id, home, away, o = {}) => ({
  id, home_team: home, away_team: away, league: 'l365_portugal__primeira_liga', start_time: '2026-11-07T18:00:00.000Z', ...o,
});

// The real pairs found in the production database on 2026-11-07.
const PAIRS = [
  [row('l365-5269247', 'FC Alverca SAD', 'Casa Pia Lisbon'), row('l365-5291891', 'Alverca', 'Casa Pia')],
  [row('l365-5268576', 'Sporting CP', 'Moreirense FC', { start_time: '2026-11-07T20:30:00.000Z' }), row('l365-5292312', 'Sporting', 'Moreirense', { start_time: '2026-11-07T20:30:00.000Z' })],
  [row('l365-5287530', 'AF Sporting San Miguelito II', 'Academia Costa Del Este', { league: 'l365_panama__liga_prom', start_time: '2026-11-07T20:00:00.000Z' }),
    row('l365-5292277', 'Sporting San Miguelito Reserves', 'Academia Costa Del Este', { league: 'l365_panama__liga_prom', start_time: '2026-11-07T20:00:00.000Z' })],
];

describe('strictSameFixture - league + exact kick-off + one club', () => {
  it.each(PAIRS)('links the real pair %#', (a, b) => {
    expect(strictSameFixture(a, b)).toBe(true);
    expect(strictSameFixture(b, a)).toBe(true);
  });
  it('never links a club of another league at the same time when the opponent is different', () => {
    const [a, b] = PAIRS[1];
    expect(strictSameFixture(a, { ...b, away_team: 'Braga', league: 'l365_portugal__u23_championship' })).toBe(false);
  });
  it('never links different countries', () => {
    const [a, b] = PAIRS[1];
    expect(strictSameFixture(a, { ...b, league: 'l365_spain__laliga' })).toBe(false);
  });
  it('links the same league written two ways when both clubs match (Real Sociedad - Rayo, 2026-11-08)', () => {
    const cat = row('l365-5250306', 'Real Sociedad San Sebastian', 'Rayo Vallecano', { league: 'l365_spain__laliga', start_time: '2026-11-08T15:15:00.000Z' });
    const live = row('l365-5294707', 'Real Sociedad', 'Rayo Vallecano', { league: 'l365_spain__spain_la_liga', start_time: '2026-11-08T15:15:00.000Z' });
    expect(strictSameFixture(cat, live)).toBe(true);
  });
  it('never links kick-offs more than 2 minutes apart', () => {
    const [a, b] = PAIRS[1];
    expect(strictSameFixture(a, { ...b, start_time: '2026-11-07T20:45:00.000Z' })).toBe(false);
  });
  it('does not link two different fixtures of one league at one time', () => {
    const a = row('1', 'Sporting CP', 'Moreirense FC');
    const b = row('2', 'Benfica', 'Braga');
    expect(strictSameFixture(a, b)).toBe(false);
  });
  it('needs a league on both sides', () => {
    const [a, b] = PAIRS[0];
    expect(strictSameFixture({ ...a, league: null }, { ...b, league: null })).toBe(false);
  });
});

describe('display twin (liveTwin.pickLiveTwin) uses the strict rule', () => {
  it('finds the Panama in-play record although the names differ a lot', () => {
    const [cat, live] = PAIRS[2];
    const twin = pickLiveTwinRow(cat, [{ ...live, live_home_score: 1, live_away_score: 0, live_minute: '90' }]);
    expect(twin && twin.id).toBe('l365-5292277');
  });
});

describe('settlement twin (matchSettlement.pickLiveTwin)', () => {
  const T0 = Date.parse('2026-11-07T18:00:00.000Z');
  const leg = (o = {}) => ({ match_id: 'l365-5269247', match_home: 'FC Alverca SAD', match_away: 'Casa Pia Lisbon', start_time: '2026-11-07T18:00:00.000Z', league: 'l365_portugal__primeira_liga', ...o });
  const fin = (o = {}) => ({ ...PAIRS[0][1], status: 'FINISHED', result_home: 1, result_away: 1, ...o });

  it('closes on a provider-final result after 100 minutes, without waiting 130', () => {
    expect(pickSettleTwin(leg(), [fin()], T0 + 105 * 60000)).toBe('l365-5291891');
    expect(pickSettleTwin(leg(), [fin()], T0 + 60 * 60000)).toBe(null);
  });
  it('still waits when the final score is only a guess from the live clock', () => {
    const guess = fin({ result_home: null, result_away: null, live_home_score: 1, live_away_score: 1, live_minute: '90:00' });
    expect(pickSettleTwin(leg(), [guess], T0 + 105 * 60000)).toBe(null);
  });
  it('links by league + minute even when the names are too different for the name rules', () => {
    const l = leg({ match_home: 'AF Sporting San Miguelito II', match_away: 'Academia Costa Del Este', league: 'l365_panama__liga_prom', start_time: '2026-11-07T20:00:00.000Z' });
    const c = { ...PAIRS[2][1], status: 'FINISHED', result_home: 2, result_away: 0 };
    expect(pickSettleTwin(l, [c], T0 + 5 * 3600 * 1000)).toBe('l365-5292277');
  });
  it('links nothing when two records both qualify (ambiguous), instead of guessing', () => {
    const a = fin({ id: 'x1' }), b = fin({ id: 'x2' });
    expect(pickSettleTwin(leg(), [a, b], T0 + 3 * 3600 * 1000)).toBe(null);
  });
  it('ignores a record of another league at the same minute', () => {
    const other = fin({ id: 'o1', league: 'l365_england__premier_league', home_team: 'Chelsea', away_team: 'Arsenal' });
    expect(pickSettleTwin(leg(), [other], T0 + 3 * 3600 * 1000)).toBe(null);
  });
});
