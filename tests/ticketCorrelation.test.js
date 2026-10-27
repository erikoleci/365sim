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

  it('BTTS Yes with Over 0.5 / 1.5 / 1+ / 2+ is refused (needs 2+ goals); BTTS No with Under 1.5 too', () => {
    const yes = s('m1', 'm1-btts', 'Gol/Jogol', 'Gol');
    const no = s('m1', 'm1-btts', 'Gol/Jogol', 'Jogol');
    expect(findCorrelatedSelections([yes, s('m1', 'm1-t1', 'Totali i golave', 'Mbi 0.5')])?.family).toBe('btts');
    expect(findCorrelatedSelections([yes, s('m1', 'm1-t1', 'Totali i golave', 'Mbi 1.5')])).not.toBeNull();
    expect(findCorrelatedSelections([yes, s('m1', 'm1-t2', 'Numri i golave', '2+')])).not.toBeNull();
    expect(findCorrelatedSelections([yes, s('m1', 'm1-t3', 'Totali i golave', 'Nen 1.5')])).not.toBeNull(); // impossible together
    expect(findCorrelatedSelections([no, s('m1', 'm1-t4', 'Totali i golave', 'Nen 1.5')])).not.toBeNull();
    expect(findCorrelatedSelections([no, s('m1', 'm1-t5', 'Numri i golave', '0-1')])).not.toBeNull();
  });
  it('allows BTTS with goal selections that are not decided by it', () => {
    const yes = s('m1', 'm1-btts', 'Gol/Jogol', 'Gol');
    expect(findCorrelatedSelections([yes, s('m1', 'm1-t', 'Totali i golave', 'Mbi 2.5')])).toBeNull();
    expect(findCorrelatedSelections([s('m1', 'm1-btts', 'Gol/Jogol', 'Jogol'), s('m1', 'm1-t', 'Totali i golave', 'Mbi 2.5')])).toBeNull();
  });
  it('treats one real match listed under two ids as the same match', () => {
    const a = { ...s('l365-1', 'a', 'Numri i golave', '4+'), home: 'UD Almeria', away: 'Elche CF', startTime: '2026-10-27T18:00:00Z' };
    const b = { ...s('l365-2', 'b', 'Numri i golave 2', '2+'), home: 'UD Almeria', away: 'Elche CF', startTime: '2026-10-27T18:00:00Z' };
    expect(findCorrelatedSelections([a, b])).not.toBeNull();
    // same teams a week later is another match
    expect(findCorrelatedSelections([a, { ...b, startTime: '2026-11-03T18:00:00Z' }])).toBeNull();
  });
  it('refuses a result with "qualifies", and scoring facts with each other / with BTTS', () => {
    expect(findCorrelatedSelections([s('m1', 'm1-h2h', 'Rezultat Final', '1'), s('m1', 'q', 'Skuadra qe kualifikohet', '1')])?.family).toBe('result');
    expect(findCorrelatedSelections([s('m1', 'a', 'Shenon golin e pare (skuadra)', '1'), s('m1', 'm1-btts', 'Gol/Jogol', 'Gol')])?.family).toBe('scoring');
    expect(findCorrelatedSelections([s('m1', 'a', 'Skuadra qe shenon e pare', '1'), s('m1', 'b', 'Shenon golin e fundit (skuadra)', '1')])?.family).toBe('scoring');
  });
  it('refuses Asian goal lines together with other goal selections', () => {
    expect(findCorrelatedSelections([s('m1', 'a', 'Gola Aziatik', 'Mbi 2.25'), s('m1', 'm1-totals', 'Totali i golave', 'Mbi 1.5')])?.family).toBe('goals');
  });
});

describe('the provider\'s own markets follow the same logic rule', () => {
  const S = (marketName, optionName, extra = {}) => ({ matchId: 'm1', marketId: 'mk-' + marketName, marketName, optionName, home: 'Udinese', away: 'AC Milan', startTime: '2026-10-27T18:00:00Z', ...extra });
  const blocked = (...sels) => Boolean(findCorrelatedSelections(sels));

  it('team goal counts (1 Gol / 2 Gola / 3+ Gola) cannot sit with each other or with goal totals', () => {
    expect(blocked(S('Nr-Gola Pritesi', '3+ Gola'), S('Nr-Gola Udhetuesi', '3+ Gola'))).toBe(true);
    expect(blocked(S('Nr-Gola Pritesi', '1 Gol'), S('Numri i Golave në Ndeshje', 'Lart 2.5'))).toBe(true);
    expect(blocked(S('Nr-Gola Pritesi', '0 Gola'), S('Gol Jo Gol Live', '1'))).toBe(true);
  });
  it('result & goals / result & both-teams-score / result at minute N share the result family', () => {
    expect(blocked(S('Rezultat Final/Gol-Gol', '1|G'), S('Rezultat Final', '1'))).toBe(true);
    expect(blocked(S('RF-60Min', '1'), S('Rezultat Final', '1'))).toBe(true);
    expect(blocked(S('Rezultati Final Gola 3+', '2|3+'), S('Rezultati Final Gola 4+', '1|4+'))).toBe(true);
  });
  it('goal before minute N and scoring in a half are scoring / goal facts', () => {
    expect(blocked(S('Goli i Dyte Shenohet perpara min. 60:00', 'Po'), S('Numri i Golave në Ndeshje', 'Lart 1.5'))).toBe(true);
    expect(blocked(S('Shenon Pritesi ne P2', 'Po'), S('Nr-Gola Pritesi', '0 Gola'))).toBe(true);
  });
  it('next goal / corner / card belong to scoring / corners / cards', () => {
    expect(blocked(S('Goli i radhës', '1'), S('Shenon golin e dyte (skuadra)', '1'))).toBe(true);
    expect(blocked(S('Korneri i radhës', '1'), S('Korne Totali', '5+'))).toBe(true);
    expect(blocked(S('Godet kornen e fundit', '1'), S('Korneri i radhës', '2'))).toBe(true);
    expect(blocked(S('Kartoni i radhës', '1'), S('Merr kartonin e pare', '2'))).toBe(true);
  });
  it('independent facts still go together, and so do different matches', () => {
    expect(blocked(S('Shenon Pritesi ne P2', 'Po'), S('Rezultat Final', '1'))).toBe(false);        // scoring vs result
    expect(blocked(S('Nr-Gola Pritesi', '1 Gol'), S('Korne Totali', '5+'))).toBe(false);           // goals vs corners
    expect(blocked(S('Godet kornen e fundit', '1'), S('Numri i Golave në Ndeshje', 'Lart 2.5'))).toBe(false);
    expect(blocked(S('Nr-Gola Pritesi', '3+ Gola'), S('Nr-Gola Pritesi', '3+ Gola', { matchId: 'm2', home: 'Roma', away: 'Lazio' }))).toBe(false);
  });
  it('"3+ Gola" / "1 Gol" options count as goal numbers in a generic goals market', () => {
    expect(blocked(S('Gola', '1 Gol'), S('Golat', '3+ Gola'))).toBe(true);
  });
});
