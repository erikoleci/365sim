import { describe, it, expect } from 'vitest';
import { addToSlip } from '../utils/betSlipRules.ts';

const leg = (marketId, marketName, selectionName, matchId = 'm1', extra = {}) => ({
  matchId, matchHome: 'Udinese', matchAway: 'AC Milan', marketId, marketName,
  selectionId: `${marketId}-${selectionName}`, selectionName, odds: 2, status: 'PENDING', ...extra,
});
const names = (slip) => slip.map((s) => s.selectionName);
const pick = (slip, l) => addToSlip(slip, l).next;

describe('addToSlip: the new pick replaces every tied leg of the same match', () => {
  it('goal counts: 4+ drops 1+, 2+, 3+ from other goal markets', () => {
    let slip = [];
    slip = pick(slip, leg('g1', 'Numri i Golave', '1+'));
    slip = pick(slip, leg('g2', 'Numri i Golave 2', '2+'));
    slip = pick(slip, leg('g3', 'Numri i Golave 3', '3+'));
    expect(names(slip)).toEqual(['3+']);
    const res = addToSlip(slip, leg('g4', 'Numri i Golave 4', '4+'));
    expect(names(res.next)).toEqual(['4+']);
    expect(names(res.droppedTied)).toEqual(['3+']);
  });

  it('"1-3 goals" and "2+" cannot be on the slip together', () => {
    let slip = pick([], leg('g1', 'Numri i golave ne ndeshje', '1-3'));
    slip = pick(slip, leg('g2', 'Numri i Golave', '2+'));
    expect(names(slip)).toEqual(['2+']);
  });

  it('over lines of different totals markets replace each other', () => {
    let slip = pick([], leg('t1', 'Totali i golave', 'Mbi 1.5'));
    slip = pick(slip, leg('t2', 'Numri i Golave ne Ndeshje', 'Lart 2.5'));
    expect(names(slip)).toEqual(['Lart 2.5']);
  });

  it('result + double chance, BTTS + Over 1.5, two corner lines are tied too', () => {
    expect(names(pick([leg('r', 'Rezultat Final', '1')], leg('dc', 'Dopioshans', '1X')))).toEqual(['1X']);
    expect(names(pick([leg('b', 'Gol/Jogol', 'Gol')], leg('t', 'Totali i golave', 'Mbi 1.5')))).toEqual(['Mbi 1.5']);
    expect(names(pick([leg('c1', 'Korner Mbi/Nen 8.5', 'Mbi')], leg('c2', 'Korner Mbi/Nen 9.5', 'Mbi')))).toEqual(['Mbi']);
  });

  it('a pick from the SAME market replaces the old one without a notice', () => {
    const res = addToSlip([leg('r', 'Rezultat Final', '1')], leg('r', 'Rezultat Final', '2'));
    expect(names(res.next)).toEqual(['2']);
    expect(res.droppedTied).toEqual([]);
  });

  it('independent legs stay: result + goals, result + BTTS, goals + corners, other matches', () => {
    let slip = pick([], leg('r', 'Rezultat Final', '1'));
    slip = pick(slip, leg('t', 'Totali i golave', 'Mbi 2.5'));
    slip = pick(slip, leg('b', 'Gol/Jogol', 'Gol'));
    slip = pick(slip, leg('c', 'Korner Mbi/Nen 8.5', 'Mbi'));
    slip = pick(slip, leg('r2', 'Rezultat Final', '1', 'm2', { matchHome: 'Roma', matchAway: 'Lazio' }));
    slip = pick(slip, leg('t2', 'Totali i golave', 'Mbi 1.5', 'm2', { matchHome: 'Roma', matchAway: 'Lazio' }));
    expect(slip).toHaveLength(6);
  });
});
