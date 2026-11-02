import { describe, it, expect } from 'vitest';
import { sideOrderFromEvents, detailOrderFromEvents, mergeSideOrder, raceWinnerFromEvents } from '../server/matchSettlement.js';

const ev = (type, team, detail, at) => ({ type, team, detail: String(detail), created_at: at });
// Home 5 corners, away 3, but the log misses the 1st home corner (it happened while the server was down).
const log = [
  ev('CORNER', 'away', 1, 100), ev('CORNER', 'home', 2, 200), ev('CORNER', 'away', 2, 300),
  ev('CORNER', 'home', 3, 400), ev('CORNER', 'home', 4, 500), ev('CORNER', 'away', 3, 600), ev('CORNER', 'home', 5, 700),
];
const totals = { 'CORNER|home': 5, 'CORNER|away': 3 };

describe('first / last event when some events were never logged', () => {
  it('the old count-based check cannot tell the last corner here (it is only sure when the last event is the side with the gap)', () => {
    const swapped = [...log.slice(0, -1), ev('CORNER', 'home', 5, 550)].sort((a, b) => a.created_at - b.created_at); // away 3 is last
    expect(sideOrderFromEvents(swapped, 5, 3).last).toBeUndefined();
  });
  it('the running count decides it: the last corner is the later of "home 5" and "away 3"', () => {
    expect(detailOrderFromEvents(log, totals).last).toBe('HOME');
    const awayLast = log.map((e) => (e.team === 'away' && e.detail === '3' ? { ...e, created_at: 800 } : e));
    expect(detailOrderFromEvents(awayLast, totals).last).toBe('AWAY');
  });
  it('the first corner needs both "home 1" and "away 1": a missing one stays undecided', () => {
    expect(detailOrderFromEvents(log, totals).first).toBeUndefined(); // home 1 is not in the log
    const full = [ev('CORNER', 'home', 1, 50), ...log];
    expect(detailOrderFromEvents(full, totals).first).toBe('HOME');
  });
  it('is undecided when the last event itself is missing, a total is unknown, or the two sides are tied in time', () => {
    expect(detailOrderFromEvents(log.slice(0, -1), totals).last).toBeUndefined(); // home 5 not logged
    expect(detailOrderFromEvents(log, { 'CORNER|home': NaN, 'CORNER|away': 3 })).toBeUndefined();
    const tied = log.map((e) => (e.team === 'away' && e.detail === '3' ? { ...e, created_at: 700 } : e));
    expect(detailOrderFromEvents(tied, totals).last).toBeUndefined();
  });
  it('a side without any event does not matter, no corners at all gives NONE', () => {
    const onlyHome = [ev('CORNER', 'home', 1, 10), ev('CORNER', 'home', 2, 20)];
    expect(detailOrderFromEvents(onlyHome, { 'CORNER|home': 2, 'CORNER|away': 0 })).toEqual({ first: 'HOME', last: 'HOME' });
    expect(detailOrderFromEvents([], { 'CORNER|home': 0, 'CORNER|away': 0 })).toEqual({ first: 'NONE', last: 'NONE' });
  });
  it('cards: the last card is the latest of the last yellow / red of each side', () => {
    const cards = [ev('YELLOW_CARD', 'home', 1, 10), ev('YELLOW_CARD', 'away', 1, 20), ev('RED_CARD', 'away', 1, 30), ev('YELLOW_CARD', 'home', 2, 40)];
    const t = { 'YELLOW_CARD|home': 2, 'YELLOW_CARD|away': 1, 'RED_CARD|home': 0, 'RED_CARD|away': 1 };
    expect(detailOrderFromEvents(cards, t)).toEqual({ first: 'HOME', last: 'HOME' });
    expect(detailOrderFromEvents(cards.slice(0, -1), t).last).toBeUndefined(); // yellow home 2 missing
  });
  it('mergeSideOrder keeps a certain answer and drops two that disagree', () => {
    expect(mergeSideOrder(undefined, undefined)).toBeUndefined();
    expect(mergeSideOrder({ first: undefined, last: undefined }, { first: 'HOME', last: 'AWAY' })).toEqual({ first: 'HOME', last: 'AWAY' });
    expect(mergeSideOrder({ first: 'HOME', last: 'HOME' }, { first: 'HOME', last: 'AWAY' })).toEqual({ first: 'HOME', last: undefined });
  });
});

describe('race to N corners with a gap in the log', () => {
  it('is decided by the events numbered N of each side', () => {
    // race to 3: home 3 at 400, away 3 at 600 -> home first (the log misses home 1, so the counts alone fail)
    expect(raceWinnerFromEvents(log, 3, 5, 3)).toBe('HOME');
  });
  it('still falls back to counting events when there is no running count', () => {
    const plain = [{ team: 'home', created_at: 1 }, { team: 'away', created_at: 2 }, { team: 'home', created_at: 3 }, { team: 'away', created_at: 4 }];
    expect(raceWinnerFromEvents(plain, 2, 2, 2)).toBe('HOME');
  });
});
