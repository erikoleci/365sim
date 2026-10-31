import { describe, it, expect } from 'vitest';
import { findSlipConflicts, legKey } from '../utils/betSlipRules.ts';

const leg = (marketId, marketName, selectionName, matchId = 'm1', extra = {}) => ({
  matchId, matchHome: 'Udinese', matchAway: 'AC Milan', marketId, marketName,
  selectionId: `${marketId}-${selectionName}`, selectionName, odds: 2, status: 'PENDING', ...extra,
});
const flagged = (slip) => [...findSlipConflicts(slip).keys()].sort();
const keys = (...legs) => legs.map(legKey).sort();

describe('findSlipConflicts: tied legs of the same match are flagged, nothing is removed', () => {
  it('goal counts 1+ / 2+ / 3+ / 4+ from different goal markets are all flagged', () => {
    const slip = [
      leg('g1', 'Numri i Golave', '1+'),
      leg('g2', 'Numri i Golave 2', '2+'),
      leg('g3', 'Numri i Golave 3', '3+'),
      leg('g4', 'Numri i Golave 4', '4+'),
    ];
    expect(flagged(slip)).toEqual(keys(...slip));
    const conflicts = findSlipConflicts(slip);
    expect(conflicts.get(legKey(slip[3]))).toHaveLength(3);
  });

  it('"1-3 goals" with "2+" is flagged', () => {
    const a = leg('g1', 'Numri i golave ne ndeshje', '1-3');
    const b = leg('g2', 'Numri i Golave', '2+');
    expect(flagged([a, b])).toEqual(keys(a, b));
  });

  it('only the tied legs are flagged: all result / goals legs of a match, while corners stay clean', () => {
    const over = leg('t', 'Totali i golave', 'Mbi 1.5');
    const range = leg('g', 'Numri i golave ne ndeshje', '0-3');
    const result = leg('r', 'Rezultat Final', '1');
    const corners = leg('c', 'Korner Mbi/Nen 8.5', 'Mbi');
    expect(flagged([over, range, result, corners])).toEqual(keys(over, range, result));
  });

  it('result + double chance, BTTS + Over 1.5, two corner lines are flagged', () => {
    const r = leg('r', 'Rezultat Final', '1'); const dc = leg('dc', 'Dopioshans', '1X');
    expect(flagged([r, dc])).toEqual(keys(r, dc));
    const b = leg('b', 'Gol/Jogol', 'Gol'); const t = leg('t', 'Totali i golave', 'Mbi 1.5');
    expect(flagged([b, t])).toEqual(keys(b, t));
    const c1 = leg('c1', 'Korner Mbi/Nen 8.5', 'Mbi'); const c2 = leg('c2', 'Korner Mbi/Nen 9.5', 'Mbi');
    expect(flagged([c1, c2])).toEqual(keys(c1, c2));
  });

  it('independent legs: one result + one corners + one cards of a match, and other matches, give no conflict', () => {
    const slip = [
      leg('r', 'Rezultat Final', '1'),
      leg('c', 'Korner Mbi/Nen 8.5', 'Mbi'),
      leg('k', 'Kartona Mbi/Nen 3.5', 'Mbi'),
      leg('r2', 'Rezultat Final', '1', 'm2', { matchHome: 'Roma', matchAway: 'Lazio' }),
      leg('c2', 'Korner Mbi/Nen 8.5', 'Mbi', 'm2', { matchHome: 'Roma', matchAway: 'Lazio' }),
    ];
    expect(findSlipConflicts(slip).size).toBe(0);
  });

  it('a second result-type leg (result + goals, result + BTTS ...) is flagged', () => {
    const r = leg('r', 'Rezultat Final', '1'); const t = leg('t', 'Totali i golave', 'Mbi 2.5');
    const b = leg('b', 'Gol/Jogol', 'Gol');
    expect(flagged([r, t, b])).toEqual(keys(r, t, b));
  });

  it('removing one of two tied legs clears the conflict', () => {
    const a = leg('g1', 'Numri i Golave', '4+'); const b = leg('g2', 'Numri i Golave 2', '1+');
    expect(findSlipConflicts([a, b]).size).toBe(2);
    expect(findSlipConflicts([a]).size).toBe(0);
  });
});

describe('goal-count picks of one team clash with the match total', () => {
  it('"Sa gola shënon Pritesi" Lart 1.5 with the total Lart 1.5 is flagged', () => {
    const team = leg('t1', 'Sa gola shenon Pritesi ne pjesen e 2', 'Lart 1.5');
    const total = leg('t2', 'Totali i golave', 'Mbi 1.5');
    expect(flagged([team, total])).toEqual(keys(team, total));
  });
});

import { stakeAfterPlacement } from '../utils/betSlipRules';
describe('stake after a placement attempt', () => {
  it('is kept when the ticket was refused (live prices moved), so one press accepts the new prices', () => {
    expect(stakeAfterPlacement(false, '500')).toBe('500');
  });
  it('is cleared once the ticket is booked', () => {
    expect(stakeAfterPlacement(true, '500')).toBe('');
    expect(stakeAfterPlacement(undefined, '500')).toBe('');
  });
});
