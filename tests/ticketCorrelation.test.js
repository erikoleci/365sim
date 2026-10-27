import { describe, it, expect } from 'vitest';
import { findCorrelatedSelections } from '../server/ticketCorrelation.js';

const s = (matchId, marketId, marketName, optionName) => ({ matchId, marketId, marketName, optionName });

describe('findCorrelatedSelections', () => {
  it('refuses goal-count selections of the same match (4+ with 1+/2+/3+, Over lines, ranges)', () => {
    expect(findCorrelatedSelections([
      s('m1', 'm1-a', 'Numri i Golave', '4+'),
      s('m1', 'm1-b', 'Numri i Golave 2', '1+'),
    ])).not.toBeNull();
    expect(findCorrelatedSelections([
      s('m1', 'm1-totals', 'Totali i golave', 'Mbi 1.5'),
      s('m1', 'm1-x', 'Numri i golave ne ndeshje', '0-3'),
    ])?.family).toBe('goals');
  });
  it('refuses result + double chance on the same match', () => {
    expect(findCorrelatedSelections([
      s('m1', 'm1-h2h', 'Rezultat Final', '1'),
      s('m1', 'm1-dc', 'Dopioshans', '1X'),
    ])?.family).toBe('result');
  });
  it('refuses a result+goals combination with a goals selection or a result selection', () => {
    const combo = s('m1', 'm1-c', 'Rezultat Final & Totali', '1 & Mbi 1.5');
    expect(findCorrelatedSelections([combo, s('m1', 'm1-x', 'Numri i golave', '0-3')])).not.toBeNull();
    expect(findCorrelatedSelections([combo, s('m1', 'm1-h2h', 'Rezultat Final', '2')])).not.toBeNull();
  });
  it('refuses two corner or two card selections of one match', () => {
    expect(findCorrelatedSelections([s('m1', 'a', 'Korner Mbi/Nen 8.5', 'Mbi'), s('m1', 'b', 'Korner Mbi/Nen 9.5', 'Mbi')])?.family).toBe('corners');
    expect(findCorrelatedSelections([s('m1', 'a', 'Kartona Mbi/Nen 3.5', 'Mbi'), s('m1', 'b', 'Kartona Mbi/Nen 4.5', 'Mbi')])?.family).toBe('cards');
  });
  it('allows independent legs: other matches, result + goals, result + BTTS, goals + corners', () => {
    expect(findCorrelatedSelections([s('m1', 'm1-h2h', 'Rezultat Final', '1'), s('m2', 'm2-h2h', 'Rezultat Final', '1')])).toBeNull();
    expect(findCorrelatedSelections([s('m1', 'm1-h2h', 'Rezultat Final', '1'), s('m1', 'm1-totals', 'Totali i golave', 'Mbi 2.5')])).toBeNull();
    expect(findCorrelatedSelections([s('m1', 'm1-h2h', 'Rezultat Final', '1'), s('m1', 'm1-btts', 'Gol/Jogol', 'Gol')])).toBeNull();
    expect(findCorrelatedSelections([s('m1', 'm1-totals', 'Totali i golave', 'Mbi 2.5'), s('m1', 'a', 'Korner Mbi/Nen 8.5', 'Mbi')])).toBeNull();
  });
});
