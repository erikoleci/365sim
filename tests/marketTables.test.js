import { describe, it, expect } from 'vitest';
import { groupMarkets, parseOverUnderOption, parseRaceOption, parseAsianHandicapOption } from '../utils/marketTables.ts';

const opt = (id, name, odds = 2) => ({ id, name, odds });
const mk = (id, name, options, category = 'goals') => ({ id, name, category, options });

describe('parseOverUnderOption', () => {
  it('reads every spelling of over / under with a line', () => {
    expect(parseOverUnderOption('Lart 2.5')).toMatchObject({ over: true, line: 2.5, word: 'Lart' });
    expect(parseOverUnderOption('Poshte 2.5')).toMatchObject({ over: false, line: 2.5 });
    expect(parseOverUnderOption('Poshtë 0,5')).toMatchObject({ over: false, line: 0.5, text: '0.5' });
    expect(parseOverUnderOption('Mbi 3.5')).toMatchObject({ over: true });
    expect(parseOverUnderOption('Nën 3.5')).toMatchObject({ over: false });
    expect(parseOverUnderOption('Under-1.5')).toMatchObject({ over: false, line: 1.5 });
  });
  it('rejects everything else', () => {
    expect(parseOverUnderOption('Sakte 10')).toBeNull();
    expect(parseOverUnderOption('1 & Lart 2.5')).toBeNull();
    expect(parseOverUnderOption('Po')).toBeNull();
  });
});

describe('parseRaceOption', () => {
  it('reads side + N in the usual spellings', () => {
    expect(parseRaceOption('1 5', 'Chile', 'Vina')).toEqual({ n: 5, side: 'HOME' });
    expect(parseRaceOption('X 9', 'Chile', 'Vina')).toEqual({ n: 9, side: 'NONE' });
    expect(parseRaceOption('2|7', 'Chile', 'Vina')).toEqual({ n: 7, side: 'AWAY' });
    expect(parseRaceOption('7 Vina', 'Chile', 'Vina')).toEqual({ n: 7, side: 'AWAY' });
    expect(parseRaceOption('Chile 3', 'Chile', 'Vina')).toEqual({ n: 3, side: 'HOME' });
  });
  it('does not guess', () => {
    expect(parseRaceOption('1 2', 'Chile', 'Vina')).toBeNull();
    expect(parseRaceOption('Lart 2.5', 'Chile', 'Vina')).toBeNull();
  });
});

describe('parseAsianHandicapOption', () => {
  it('reads own side + signed line', () => {
    expect(parseAsianHandicapOption('1 -0.5')).toMatchObject({ side: 1, line: -0.5 });
    expect(parseAsianHandicapOption('2 +1')).toMatchObject({ side: 2, line: 1, text: '+1' });
    expect(parseAsianHandicapOption('1 0:1')).toBeNull(); // european handicap
  });
});

describe('groupMarkets', () => {
  it('puts the lines of ONE market into one table (rows ascending, Lart / Poshtë columns)', () => {
    const m = mk('m1', 'Total Gola', [
      opt('a', 'Poshte 1.5', 3.4), opt('b', 'Lart 1.5', 1.3), opt('c', 'Lart 0.5', 1.07), opt('d', 'Poshte 0.5', 9),
    ]);
    const blocks = groupMarkets([m], 'A', 'B');
    expect(blocks).toHaveLength(1);
    const s = blocks[0].section;
    expect(blocks[0].type).toBe('table');
    expect(s.headers).toEqual(['Lart', 'Poshte']);
    expect(s.rows.map((r) => r.label)).toEqual(['0.5', '1.5']);
    expect(s.rows[0].cells.map((c) => c.option.odds)).toEqual([1.07, 9]);
    expect(s.rows[1].cells.map((c) => c.option.odds)).toEqual([1.3, 3.4]);
  });

  it('merges markets with the SAME name (one line each) into one table, cells keep their own market id', () => {
    const blocks = groupMarkets([
      mk('m1', 'Total Gola', [opt('a', 'Lart 2.5'), opt('b', 'Poshte 2.5')]),
      mk('m2', 'Total Gola', [opt('c', 'Lart 0.5'), opt('d', 'Poshte 0.5')]),
      mk('m3', 'Total Gola', [opt('e', 'Lart 1.5'), opt('f', 'Poshte 1.5')]),
    ], 'A', 'B');
    expect(blocks).toHaveLength(1);
    const s = blocks[0].section;
    expect(s.rows.map((r) => r.label)).toEqual(['0.5', '1.5', '2.5']);
    expect(s.rows.map((r) => r.cells[0].marketId)).toEqual(['m2', 'm3', 'm1']);
  });

  it('keeps different names apart (Total Gola vs Total Gola P1) and the order of first appearance', () => {
    const blocks = groupMarkets([
      mk('p1', 'Total Gola P1', [opt('a', 'Lart 0.5'), opt('b', 'Poshte 0.5')]),
      mk('h2h', '1X2', [opt('1', '1'), opt('x', 'X'), opt('2', '2')], 'main'),
      mk('t', 'Total Gola', [opt('c', 'Lart 2.5'), opt('d', 'Poshte 2.5')]),
      mk('p2', 'Total Gola P1', [opt('e', 'Lart 1.5'), opt('f', 'Poshte 1.5')]),
    ], 'A', 'B');
    expect(blocks.map((b) => (b.type === 'table' ? b.section.title : b.market.name))).toEqual(['Total Gola P1', '1X2', 'Total Gola']);
    expect(blocks[0].section.rows).toHaveLength(2);
  });

  it('corner totals: over / under lines in the table, "Sakte N" kept as extras', () => {
    const m = mk('c1', 'Lart/Poshtë Korne Totali', [opt('a', 'Lart 9.5'), opt('b', 'Poshte 9.5'), opt('c', 'Sakte 10'), opt('d', 'Lart 10.5'), opt('e', 'Poshte 10.5')], 'corners');
    const s = groupMarkets([m], 'A', 'B')[0].section;
    expect(s.rows.map((r) => r.label)).toEqual(['9.5', '10.5']);
    expect(s.extras.map((c) => c.option.name)).toEqual(['Sakte 10']);
  });

  it('Gara e Korneve: one table, one row per N, columns 1 / X / 2', () => {
    const race = (id, n, a = 2, b = 3, c = 4) => mk(id, 'Gara e Korneve', [opt(`${id}1`, `1 ${n}`, a), opt(`${id}x`, `X ${n}`, b), opt(`${id}2`, `2 ${n}`, c)], 'corners');
    const blocks = groupMarkets([race('r9', 9, 7.5, 1.11, 12), race('r3', 3, 2.25, 34, 1.57), race('r5', 5)], 'Chile', 'Vina');
    expect(blocks).toHaveLength(1);
    const s = blocks[0].section;
    expect(s.kind).toBe('race');
    expect(s.headers).toEqual(['1', 'X', '2']);
    expect(s.rows.map((r) => r.label)).toEqual(['3', '5', '9']);
    expect(s.rows[0].cells.map((c) => c.option.odds)).toEqual([2.25, 34, 1.57]);
    expect(s.rows[2].cells.map((c) => c.marketId)).toEqual(['r9', 'r9', 'r9']);
  });

  it('asian handicap: "1 -0.5" and "2 +0.5" share a row, the signed line is the cell label', () => {
    const m = mk('h', 'Handikap Aziatik', [opt('a', '1 -0.5', 1.9), opt('b', '2 +0.5', 1.9), opt('c', '1 -1.5', 3), opt('d', '2 +1.5', 1.3)], 'handicap');
    const s = groupMarkets([m], 'A', 'B')[0].section;
    expect(s.kind).toBe('handicap');
    expect(s.hasLabelColumn).toBe(false);
    expect(s.rows).toHaveLength(2);
    expect(s.rows[0].cells.map((c) => c.label)).toEqual(['-1.5', '+1.5']);
    expect(s.rows[1].cells.map((c) => c.label)).toEqual(['-0.5', '+0.5']);
  });

  it('leaves every other market untouched', () => {
    const h2h = mk('x', '1X2 - Fituesi', [opt('1', 'A'), opt('x', 'Barazim'), opt('2', 'B')], 'main');
    const btts = mk('y', 'Gol/Jo Gol', [opt('1', 'Po'), opt('2', 'Jo')]);
    const blocks = groupMarkets([h2h, btts], 'A', 'B');
    expect(blocks).toEqual([{ type: 'market', market: h2h }, { type: 'market', market: btts }]);
  });

  it('a duplicated line gets its own row instead of overwriting the first', () => {
    const blocks = groupMarkets([
      mk('m1', 'Total Gola', [opt('a', 'Lart 2.5', 2), opt('b', 'Poshte 2.5', 1.7)]),
      mk('m2', 'Total Gola', [opt('c', 'Lart 2.5', 2.1), opt('d', 'Poshte 2.5', 1.6)]),
    ], 'A', 'B');
    expect(blocks[0].section.rows).toHaveLength(2);
  });

  it('a market with a single over / under option stays a plain box', () => {
    const m = mk('m', 'Total Gola', [opt('a', 'Lart 2.5')]);
    expect(groupMarkets([m], 'A', 'B')[0].type).toBe('market');
  });
});
