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
});
