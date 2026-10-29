import { describe, it, expect } from 'vitest';
import { findCorrelatedSelections, selectionFamilies } from '../server/ticketCorrelation.js';

const s = (matchId, marketId, marketName, optionName, extra = {}) => ({ matchId, marketId, marketName, optionName, home: 'Chelsea FC', away: 'Manchester United', ...extra });
const clash = (...sel) => findCorrelatedSelections(sel);

describe('one match, one ticket: 1 result + 1 corners + 1 cards', () => {
  it('refuses the five-leg slip on one match (result / goals / both teams to score ...)', () => {
    const slip = [
      s('m1', 'a', 'Fiton Udhetuesi ose Gol/JoGol', 'Jo'),
      s('m1', 'b', '1st half - 1x2 & both teams to score', 'Draw / Yes'),
      s('m1', 'c', 'RP1/RP2 & Gol/JoGol', 'GG / GG'),
      s('m1', 'd', 'Gol/JoGol', 'Jo'),
      s('m1', 'e', 'Away to win', '1X'),
    ];
    expect(findCorrelatedSelections(slip)?.family).toBe('score');
    // any two of them already clash
    for (let i = 0; i < slip.length; i++) for (let j = i + 1; j < slip.length; j++) expect(clash(slip[i], slip[j])?.family).toBe('score');
  });
  it('treats every result / goals market as ONE group, whatever its name or language', () => {
    for (const [a, b] of [
      [s('m1', 'r', 'Rezultat Final', '1'), s('m1', 't', 'Totali i golave', 'Mbi 2.5')],
      [s('m1', 'r', 'Rezultat Final', '1'), s('m1', 'dc', 'Dopioshans', '1X')],
      [s('m1', 'r', 'Rezultat Final', '1'), s('m1', 'b', 'Gol/Jogol', 'Gol')],
      [s('m1', 'g1', 'Numri i Golave', '4+'), s('m1', 'g2', 'Numri i Golave 2', '1+')],
      [s('m1', 'h', '45/90', 'X-2'), s('m1', 'r', 'Rezultat Final', '2')],
      [s('m1', 'c', 'Dopio Shans & Gol/JGol', 'X2_Gol'), s('m1', 'd', 'Gol/Jogol', 'Gol')],
      [s('m1', 'q', 'Skuadra qe kualifikohet', '1'), s('m1', 'r', 'Rezultat Final', '1')],
      [s('m1', 'f', 'Shenon golin e pare (skuadra)', '1'), s('m1', 'b', 'Gol/Jogol', 'Gol')],
      [s('m1', 'x', 'Total Gola P1', 'Lart 0.5'), s('m1', 'y', 'Total Gola P2', 'Lart 0.5')],
      [s('m1', 'x', 'Some market the provider added', 'Yes'), s('m1', 'r', 'Rezultat Final', '1')], // unknown name: still a score selection
    ]) expect(clash(a, b)?.family, a.marketName + ' + ' + b.marketName).toBe('score');
  });
  it('allows one result + one corners + one cards selection of the same match', () => {
    const result = s('m1', 'r', 'Rezultat Final', '1');
    const corners = s('m1', 'c', 'Shuma total e korneve', '10+');
    const cards = s('m1', 'k', 'Kartona Mbi/Nen 3.5', 'Mbi');
    expect(findCorrelatedSelections([result, corners, cards])).toBeNull();
    expect(findCorrelatedSelections([result, corners])).toBeNull();
    expect(findCorrelatedSelections([corners, cards])).toBeNull();
  });
  it('refuses two corners selections and two cards selections', () => {
    expect(clash(s('m1', 'a', 'Korner Mbi/Nen 8.5', 'Mbi'), s('m1', 'b', 'Korner Mbi/Nen 9.5', 'Mbi'))?.family).toBe('corners');
    expect(clash(s('m1', 'a', 'Shuma total e korneve', '10+'), s('m1', 'b', 'Corners Over/Under', 'Over 9.5'))?.family).toBe('corners');
    expect(clash(s('m1', 'a', 'Kartona Mbi/Nen 3.5', 'Mbi'), s('m1', 'b', 'Kartona Mbi/Nen 4.5', 'Mbi'))?.family).toBe('cards');
  });
  it('a combination of corners/cards with a result counts as a result selection too', () => {
    expect([...selectionFamilies({ marketId: 'x', marketName: 'Rezultat & Korne', home: 'A', away: 'B' })].sort()).toEqual(['corners', 'score']);
    expect(clash(s('m1', 'x', 'Rezultat & Korne', '1 & Mbi 8.5'), s('m1', 'r', 'Rezultat Final', '1'))?.family).toBe('score');
  });
  it('different matches never clash; one match listed under two ids is one match', () => {
    expect(clash(s('m1', 'r', 'Rezultat Final', '1'), s('m2', 'r', 'Rezultat Final', '1', { home: 'Roma', away: 'Lazio' }))).toBeNull();
    const a = s('l365-1', 'a', 'Numri i golave', '4+', { startTime: '2026-10-27T18:00:00Z' });
    const b = s('l365-2', 'b', 'Numri i golave 2', '2+', { startTime: '2026-10-27T18:00:00Z' });
    expect(clash(a, b)).not.toBeNull();
    expect(clash(a, { ...b, startTime: '2026-11-03T18:00:00Z' })).toBeNull(); // same teams a week later = another match
  });
  it('a single selection is never refused', () => {
    expect(findCorrelatedSelections([s('m1', 'r', 'Rezultat Final', '1')])).toBeNull();
  });
});
