import { describe, it, expect } from 'vitest';
import { getBetBlockReason, isLiveCornerTotals } from '../server/marketRules.js';
import { determineLegOutcome } from '../server/matchSettlement.js';

const NOW = Date.parse('2026-10-26T20:00:00Z');
const row = (over = {}) => ({
  status: 'LIVE', live_status: '2H', home_team: 'A', away_team: 'B',
  start_time: new Date(NOW - 70 * 60000).toISOString(), live_minute: '60:00',
  live_home_score: 0, live_away_score: 0,
  live_corners: { home: 4, away: 5, fresh: true },
  ...over,
});
const M = (name = 'Lart/Poshtë Korne Totali') => ({ id: 'l365-1-corners', name });
const S = (name) => ({ id: name, name });
const reason = (r, sel, name) => getBetBlockReason(r, M(name), S(sel), NOW);

describe('live corner totals', () => {
  it('recognises the corner totals markets (full time and per half) and nothing else', () => {
    expect(isLiveCornerTotals('Lart/Poshtë Korne')).toBe(true);
    expect(isLiveCornerTotals('Lart/Poshtë Korne Totali')).toBe(true);
    expect(isLiveCornerTotals('Lart/Poshtë Korne Pjesa 1-rë')).toBe(true);
    expect(isLiveCornerTotals('Lart/Poshtë Korne Totali Pjesa 1-rë')).toBe(true);
    expect(isLiveCornerTotals('Lart/Poshtë Korne Pjesa 2-të')).toBe(true);
    expect(isLiveCornerTotals('Gara e Korneve')).toBe(false);
    expect(isLiveCornerTotals('Lart/Poshtë Korne Skuadra 1')).toBe(false);
  });

  it('is open in play with a fresh counter when nothing is decided yet (9 corners)', () => {
    expect(reason(row(), 'Lart 10.5')).toBeNull();
    expect(reason(row(), 'Sakte 10')).toBeNull();
    expect(reason(row(), 'Poshte 9.5')).toBeNull();
    expect(reason(row(), 'Lart 12.5', 'Lart/Poshtë Korne')).toBeNull();
  });

  it('closes the options the count has already decided', () => {
    expect(reason(row(), 'Lart 8.5')).toBe('OUTCOME_DECIDED'); // 9 > 8.5: Over already won
    expect(reason(row(), 'Poshte 8.5')).toBe('OUTCOME_DECIDED'); // Under already lost
    expect(reason(row(), 'Sakte 8')).toBe('OUTCOME_DECIDED'); // more than 8 already
    expect(reason(row(), 'Sakte 9')).toBeNull(); // exactly 9 still possible
  });

  it('stays closed when the counter is missing, stale, or the end is too close', () => {
    expect(reason(row({ live_corners: undefined }), 'Lart 10.5')).toBe('NOT_VERIFIABLE_LIVE');
    expect(reason(row({ live_corners: { home: 4, away: 5, fresh: false } }), 'Lart 10.5')).toBe('NOT_VERIFIABLE_LIVE');
    expect(reason(row({ live_minute: '89:10' }), 'Lart 10.5')).toBe('NOT_VERIFIABLE_LIVE');
    expect(reason(row(), 'Ndoshta')).toBe('NOT_VERIFIABLE_LIVE'); // unknown option text
  });

  it('is unchanged before kick-off, and team corner markets still stay closed in play', () => {
    expect(reason(row({ status: 'UPCOMING', live_status: null, start_time: new Date(NOW + 3600000).toISOString(), live_corners: undefined }), 'Lart 10.5')).toBeNull();
    expect(reason(row(), 'Lart 6.5', 'Lart/Poshtë Korne Skuadra 1')).not.toBeNull(); // team corner totals: still closed
  });
});

describe('settling corner totals incl. exact', () => {
  const leg = (selection, market = 'Lart/Poshtë Korne Totali') => ({ market_id: 'l365-1-x', market_name: market, selection_id: selection, selection_name: selection });
  const ctx = (h, a) => ({ winner: 'HOME', totalGoals: 0, homeScore: 0, awayScore: 0, stats: { cornersHome: h, cornersAway: a } });
  it('Lart / Poshte / Sakte on the final corner count', () => {
    expect(determineLegOutcome(leg('Lart 10.5'), ctx(6, 5))).toBe('WON'); // 11
    expect(determineLegOutcome(leg('Poshte 9.5'), ctx(6, 5))).toBe('LOST');
    expect(determineLegOutcome(leg('Sakte 11'), ctx(6, 5))).toBe('WON');
    expect(determineLegOutcome(leg('Sakte 10'), ctx(6, 5))).toBe('LOST');
  });
});

import { parseCornerRaceOption, eventOrderOrdinal, isLiveCornerMarket } from '../server/marketRules.js';
import { nthEventSide, raceWinnerFromEvents } from '../server/matchSettlement.js';

describe('first / second half corner totals in play', () => {
  const H1 = 'Lart/Poshtë Korne Pjesa 1-rë';
  it('first half: open before the break with the current count, decided options closed', () => {
    const r = row({ live_status: '1H', live_minute: '30:00', start_time: new Date(NOW - 30 * 60000).toISOString(), live_corners: { home: 3, away: 4, fresh: true } }); // 7 so far
    expect(reason(r, 'Lart 7.5', H1)).toBeNull();
    expect(reason(r, 'Lart 6.5', H1)).toBe('OUTCOME_DECIDED');
    expect(reason(r, 'Poshte 6.5', H1)).toBe('OUTCOME_DECIDED');
    expect(reason(r, 'Sakte 7', 'Lart/Poshtë Korne Totali Pjesa 1-rë')).toBeNull();
  });
  it('first half markets close after the break', () => {
    expect(reason(row(), 'Lart 7.5', H1)).toBe('FIRST_HALF_OVER');
  });
  it('second half: counts only the corners after the half-time snapshot', () => {
    const r = row({ ht_corners_home: 3, ht_corners_away: 3, live_corners: { home: 5, away: 4, fresh: true } }); // 9 now, 6 at HT -> 3 in P2
    const H2 = 'Lart/Poshtë Korne Pjesa 2-të';
    expect(reason(r, 'Lart 3.5', H2)).toBeNull();
    expect(reason(r, 'Lart 2.5', H2)).toBe('OUTCOME_DECIDED');
    expect(reason(row({ live_corners: { home: 5, away: 4, fresh: true } }), 'Lart 3.5', H2)).toBe('NOT_VERIFIABLE_LIVE'); // no HT snapshot
  });
});

describe('Gara e Korneve (race to N corners)', () => {
  const race = (sel, corners, name = 'Gara e Korneve') => reason(row({ home_team: 'Chile', away_team: 'Vina', live_corners: { ...corners, fresh: true } }), sel, name);
  it('parses option text and refuses what it cannot read', () => {
    expect(parseCornerRaceOption('Chile 5', 'Chile', 'Vina')).toEqual({ n: 5, side: 'HOME' });
    expect(parseCornerRaceOption('7 Vina', 'Chile', 'Vina')).toEqual({ n: 7, side: 'AWAY' });
    expect(parseCornerRaceOption('X 9', 'Chile', 'Vina')).toEqual({ n: 9, side: 'NONE' });
    expect(parseCornerRaceOption('Chile', 'Chile', 'Vina')).toBeNull();
    expect(parseCornerRaceOption('1 5', 'Chile', 'Vina')).toBeNull();
  });
  it('open while nobody reached N, closed when somebody did', () => {
    expect(race('Chile 7', { home: 4, away: 3 })).toBeNull();
    expect(race('X 5', { home: 5, away: 1 })).toBe('OUTCOME_DECIDED');
    expect(race('Vina 5', { home: 5, away: 1 })).toBe('OUTCOME_DECIDED');
    expect(race('Chile 5', { home: 4, away: 1 })).toBeNull();
    expect(race('Chile', { home: 1, away: 1 })).toBe('NOT_VERIFIABLE_LIVE');
  });
  it('settles from counters, and from the corner order only when both reached N', () => {
    expect(raceWinnerFromEvents([], 9, 5, 4)).toBe('NONE');
    expect(raceWinnerFromEvents([], 5, 6, 2)).toBe('HOME');
    expect(raceWinnerFromEvents([], 5, 2, 6)).toBe('AWAY');
    const ev = [];
    for (let i = 0; i < 5; i++) { ev.push({ team: 'home', created_at: 1000 + i * 10 }); ev.push({ team: 'away', created_at: 1005 + i * 10 }); }
    expect(raceWinnerFromEvents(ev, 5, 5, 5)).toBe('HOME'); // home's 5th at 1040 before away's at 1045
    expect(raceWinnerFromEvents(ev.slice(1), 5, 5, 5)).toBeUndefined(); // log does not add up (a home corner is missing)
    const leg = (selection) => ({ market_id: 'l365-1-x', market_name: 'Gara e Korneve', selection_id: selection, selection_name: selection, match_home: 'Chile', match_away: 'Vina' });
    const ctx = { winner: 'HOME', totalGoals: 0, homeScore: 0, awayScore: 0, stats: { cornersHome: 6, cornersAway: 3 }, goalOrder: { cornerLog: [] } };
    expect(determineLegOutcome(leg('Chile 5'), ctx)).toBe('WON');
    expect(determineLegOutcome(leg('Vina 5'), ctx)).toBe('LOST');
    expect(determineLegOutcome(leg('X 5'), ctx)).toBe('LOST');
    expect(determineLegOutcome(leg('X 9'), ctx)).toBe('WON');
  });
});

describe('Godet kornen e N-te (Nth corner of the match)', () => {
  it('knows the ordinals and opens while fewer than N corners happened', () => {
    expect(eventOrderOrdinal('Godet kornen e gjashtë')).toEqual({ kind: 'corner', n: 6 });
    expect(isLiveCornerMarket('Godet kornen e gjashte')).toBe(true);
    const r = (home, away) => row({ live_corners: { home, away, fresh: true } });
    expect(reason(r(2, 2), '1', 'Godet kornen e gjashte')).toBeNull(); // 4 so far
    expect(reason(r(3, 3), '2', 'Godet kornen e gjashte')).toBe('OUTCOME_DECIDED'); // 6th already taken
  });
  it('settles on the Nth logged corner', () => {
    const ev = ['home', 'away', 'away', 'home', 'home', 'away', 'home'].map((team, i) => ({ team, created_at: 100 + i * 10 }));
    expect(nthEventSide(ev, 4, 3, 6)).toBe('AWAY'); // 6th = away
    expect(nthEventSide(ev, 4, 3, 9)).toBe('NONE'); // only 7 corners
    expect(nthEventSide(ev, 5, 3, 6)).toBeUndefined(); // log does not add up
    const leg = (selection) => ({ market_id: 'l365-1-x', market_name: 'Godet kornen e gjashte', selection_id: selection, selection_name: selection, match_home: 'A', match_away: 'B' });
    const ctx = { winner: 'HOME', totalGoals: 0, homeScore: 0, awayScore: 0, stats: { cornersHome: 4, cornersAway: 3 }, goalOrder: { cornerLog: ev } };
    expect(determineLegOutcome(leg('2'), ctx)).toBe('WON');
    expect(determineLegOutcome(leg('1'), ctx)).toBe('LOST');
  });
});
