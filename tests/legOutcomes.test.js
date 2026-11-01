import { describe, it, expect } from 'vitest';
import { determineLegOutcome } from '../server/matchSettlement.js';
import { resultsInSelection } from '../server/commission.js';

const ctx = (h, a) => ({ winner: h > a ? 'HOME' : a > h ? 'AWAY' : 'DRAW', totalGoals: h + a, bothScored: h > 0 && a > 0, homeScore: h, awayScore: a });
const out = (leg, h, a) => determineLegOutcome({ market_name: '', selection_name: '', ...leg }, ctx(h, a));

describe('single-result markets settle correctly (1, X, 2, goals 2+/3+/4+, GG, JG)', () => {
  it('1 / X / 2', () => {
    expect(out({ market_id: 'm-h2h', selection_id: 'HOME' }, 2, 0)).toBe('WON');
    expect(out({ market_id: 'm-h2h', selection_id: 'DRAW' }, 1, 1)).toBe('WON');
    expect(out({ market_id: 'm-h2h', selection_id: 'AWAY' }, 2, 0)).toBe('LOST');
  });
  it('goals over 1.5 / 2.5 / 3.5 (2+ / 3+ / 4+) and under', () => {
    expect(out({ market_id: 'm-totals', selection_id: 'Over-1.5' }, 1, 1)).toBe('WON');
    expect(out({ market_id: 'm-totals', selection_id: 'Over-2.5' }, 1, 1)).toBe('LOST');
    expect(out({ market_id: 'm-totals', selection_id: 'Over-3.5' }, 3, 1)).toBe('WON');
    expect(out({ market_id: 'm-totals', selection_id: 'Under-3.5' }, 3, 1)).toBe('LOST');
  });
  it('GG / JG (NG) by canonical id and by label', () => {
    expect(out({ market_id: 'm-btts', selection_id: 'Yes' }, 1, 1)).toBe('WON');
    expect(out({ market_id: 'm-btts', selection_id: 'No' }, 2, 0)).toBe('WON');
    for (const label of ['Gol', 'GG']) expect(out({ market_id: 'x', market_name: 'Gol/JoGol', selection_id: label, selection_name: label }, 1, 1)).toBe('WON');
    for (const label of ['Jo Gol', 'JG', 'NG']) {
      expect(out({ market_id: 'x', market_name: 'Gol/JoGol', selection_id: label, selection_name: label }, 2, 0)).toBe('WON');
      expect(out({ market_id: 'x', market_name: 'Gol/JoGol', selection_id: label, selection_name: label }, 1, 1)).toBe('LOST');
    }
  });
  it('each of these counts as ONE result for the commission; 45/90 and combined markets count as two', () => {
    for (const m of ['Rezultat Final', 'Dopioshans', 'Gol/JoGol', 'Mbi/Nën 2.5', 'Rezultati i sakte', 'Handikap']) expect(resultsInSelection(m)).toBe(1);
    for (const m of ['45/90', 'Rezultat Final & Numri i Golave']) expect(resultsInSelection(m)).toBe(2);
  });

  describe('45/90 (half-time / full-time) without a stored half-time score', () => {
    const htft = (selection, h, a, ht) => determineLegOutcome(
      { market_id: 'x', market_name: '45/90', selection_id: selection, selection_name: selection },
      { ...ctx(h, a), htHome: ht ? ht[0] : undefined, htAway: ht ? ht[1] : undefined });
    it('Racing 0-3 Real Madrid, ticket 1/2 -> LOST even without the half-time score', () => {
      expect(htft('1/2', 0, 3)).toBe('LOST');
    });
    it('a loss is proven when a side that must win a half did not score enough goals in the whole match', () => {
      expect(htft('1/1', 0, 3)).toBe('LOST');   // two home half-wins need two home goals
      expect(htft('1/1', 1, 3)).toBe('LOST');
      expect(htft('2/2', 3, 0)).toBe('LOST');
      expect(htft('2/1', 2, 2)).toBeNull();     // 0-1 at the break, 2-1 in the second half is possible
    });
    it('a win (or anything not provable) stays open without the half-time score', () => {
      expect(htft('1/2', 1, 3)).toBeNull();
      expect(htft('x/2', 0, 3)).toBeNull();
    });
    it('with the half-time score known it settles both ways', () => {
      expect(htft('1/2', 1, 3, [1, 0])).toBe('WON');
      expect(htft('1/2', 1, 3, [0, 0])).toBe('LOST');
      expect(htft('x/2', 0, 3, [0, 0])).toBe('WON');
    });
    it('Real Madrid - Barcelona: each half is decided on its own goals', () => {
      expect(htft('1/2', 1, 2, [1, 0])).toBe('WON');   // Real take the 1st half 1-0, Barcelona the 2nd 0-2
      expect(htft('2/1', 1, 2, [1, 0])).toBe('LOST');
      expect(htft('2/1', 3, 1, [0, 1])).toBe('WON');   // Barcelona 0-1 up, then Real win the 2nd half 3-0
      expect(htft('1/1', 3, 2, [2, 0])).toBe('LOST');  // 2-0, then 1-2: Real do not win the 2nd half
      expect(htft('1/2', 3, 2, [2, 0])).toBe('WON');
      expect(htft('x/x', 2, 2, [1, 1])).toBe('WON');   // 1-1 and 1-1
    });
  });
});
