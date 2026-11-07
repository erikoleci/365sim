import { describe, it, expect, vi } from 'vitest';
vi.mock('../server/db.js', () => ({ default: { query: async () => ({ rows: [] }) }, pool: { query: async () => ({ rows: [] }) } }));
const { htftFirstSignMismatch } = await import('../server/matchSettlement.js');
const { halfTimeFromGoalLog } = await import('../server/halfTime.js');

const leg = (market, sel) => ({ market_name: market, selection_name: sel });

describe('HT/FT doubles are lost at the break when the first sign is wrong', () => {
  it('"Pjesa pare / Pjesa dyte" X-X with the home side ahead at half time is lost', () => {
    expect(htftFirstSignMismatch(leg('Pjesa pare / Pjesa dyte', 'X-X'), 1, 0)).toBe(true);
  });
  it('stays open when the first sign matches (a win needs the final result)', () => {
    expect(htftFirstSignMismatch(leg('Pjesa pare / Pjesa dyte', 'X-X'), 0, 0)).toBe(false);
    expect(htftFirstSignMismatch(leg('Pjesa pare / Pjesa dyte', '1-2'), 2, 1)).toBe(false);
  });
  it('works for the classic HT/FT and for the away sign', () => {
    expect(htftFirstSignMismatch(leg('HT/FT', '2/1'), 1, 0)).toBe(true);
    expect(htftFirstSignMismatch(leg('HT/FT', '1/1'), 1, 0)).toBe(false);
  });
  it('ignores combos, other markets and a missing half-time score', () => {
    expect(htftFirstSignMismatch(leg('45/90 & Numri i Golave', 'X/X'), 1, 0)).toBe(false);
    expect(htftFirstSignMismatch(leg('Rezultat Final', '1'), 1, 0)).toBe(false);
    expect(htftFirstSignMismatch(leg('Pjesa pare / Pjesa dyte', 'X-X'), NaN, NaN)).toBe(false);
  });
});

describe('half-time score rebuilt from the goal log', () => {
  const g = (team, minute) => ({ team, minute });
  it('counts the goals before the break when the log is complete', () => {
    expect(halfTimeFromGoalLog([g('A', 20), g('A', 33), g('B', 70)], 'A', 'B', 2, 1)).toEqual({ home: 2, away: 0 });
  });
  it('refuses when the log does not add up to the score', () => {
    expect(halfTimeFromGoalLog([g('A', 20)], 'A', 'B', 2, 0)).toBeNull();
  });
  it('refuses when a goal sits near the break (first-half stoppage vs second half)', () => {
    expect(halfTimeFromGoalLog([g('A', 20), g('A', 46)], 'A', 'B', 2, 0)).toBeNull();
    expect(halfTimeFromGoalLog([g('A', 20), g('B', 45)], 'A', 'B', 1, 1)).toBeNull();
  });
  it('refuses unknown team names or goals without a minute', () => {
    expect(halfTimeFromGoalLog([g('Other', 10)], 'A', 'B', 1, 0)).toBeNull();
    expect(halfTimeFromGoalLog([g('A', null)], 'A', 'B', 1, 0)).toBeNull();
  });
  it('a 0-0 match with no goals has a 0-0 half time', () => {
    expect(halfTimeFromGoalLog([], 'A', 'B', 0, 0)).toEqual({ home: 0, away: 0 });
  });
});
