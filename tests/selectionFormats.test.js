import { describe, it, expect } from 'vitest';
import { determineLegOutcome } from '../server/matchSettlement.js';
import { parseCountSelection, parseDoubleChance, parseHalfFull } from '../server/selectionParse.js';

// Every way the feed (or a person typing a selection) can spell the same option must settle to the
// same WON / LOST; nothing in these families may stay PENDING (null).

const sign = (h, a) => (h > a ? '1' : a > h ? '2' : 'x');
const ctxOf = (ht, ft, stats, htStats) => ({
  winner: ft[0] > ft[1] ? 'HOME' : ft[1] > ft[0] ? 'AWAY' : 'DRAW',
  totalGoals: ft[0] + ft[1], bothScored: ft[0] > 0 && ft[1] > 0,
  homeScore: ft[0], awayScore: ft[1], htHome: ht[0], htAway: ht[1], stats, htStats,
});
const leg = (market_name, sel) => ({ market_id: 'x_m1', market_name, selection_id: sel, selection_name: sel, match_home: 'Alpha FC', match_away: 'Beta United' });

describe('parseCountSelection', () => {
  const cases = [
    ['10+', [10, Infinity]], ['+10', [10, Infinity]], ['10 +', [10, Infinity]], ['>=10', [10, Infinity]],
    ['10 e me shume', [10, Infinity]], ['10 ose më shumë', [10, Infinity]], ['10 or more', [10, Infinity]], ['3+ gola', [3, Infinity]], ['+3 Gola', [3, Infinity]],
    ['9', [9, 9]], ['0-8', [0, 8]], ['2 – 3', [2, 3]], ['2 deri 3', [2, 3]],
    ['-2', [0, 2]], ['2-', [0, 2]], ['<=2', [0, 2]], ['2 e me pak', [0, 2]], ['max 2', [0, 2]],
  ];
  it.each(cases)('%s', (text, range) => expect(parseCountSelection(text)).toEqual(range));
  it('does not read things that are not counts', () => {
    for (const t of ['', 'Lart 2.5', 'Po', 'x', '3-1-2', '5-2']) expect(parseCountSelection(t)).toBeNull();
  });
});

describe('parseDoubleChance', () => {
  const teams = { home: 'Alpha FC', away: 'Beta United' };
  const cases = [
    ['1X', '1X'], ['x1', '1X'], ['X2', 'X2'], ['x2', 'X2'], ['2X', 'X2'], ['x-2', 'X2'], ['x/2', 'X2'], ['X 2', 'X2'], ['12', '12'], ['1-2', '12'], ['1 / 2', '12'],
    ['Barazim ose 2', 'X2'], ['X ose 2', 'X2'], ['draw or 2', 'X2'], ['Fiton Udhetuesi ose Barazim', 'X2'], ['Pritesi ose Barazim', '1X'],
    ['Alpha FC ose Barazim', '1X'], ['Alpha FC or Draw', '1X'], ['Alpha_FC_or_Draw', '1X'], ['Beta United ose Barazim', 'X2'], ['Alpha FC ose Beta United', '12'], ['Alpha_FC_or_Beta_United', '12'],
  ];
  it.each(cases)('%s', (text, expected) => expect(parseDoubleChance(text, teams)).toBe(expected));
  it('returns null for a single result or nonsense', () => {
    for (const t of ['1', 'x', 'Po', 'Lart 2.5', '1X2']) expect(parseDoubleChance(t, teams)).toBeNull();
  });
});

describe('parseHalfFull', () => {
  it.each([['x-2', ['x', '2']], ['X/2', ['x', '2']], ['1 / 1', ['1', '1']], ['x|2', ['x', '2']], ['Barazim/2', ['x', '2']], ['x2', ['x', '2']]])('%s', (t, e) => expect(parseHalfFull(t)).toEqual(e));
});

describe('Dopio Shans: every spelling is decided', () => {
  const spellings = { '1X': ['1X', 'x1', '1-X', 'Alpha FC ose Barazim', 'Pritesi ose Barazim', '1 ose X'], X2: ['X2', 'x2', '2X', 'x-2', 'Barazim ose 2', 'Beta United ose Barazim', 'Fiton Udhetuesi ose Barazim', 'X or 2'], 12: ['12', '1-2', 'Alpha FC ose Beta United', '1 ose 2'] };
  for (const ft of [[2, 0], [1, 1], [0, 3]]) {
    const res = sign(...ft);
    for (const [dc, texts] of Object.entries(spellings)) {
      const expected = dc.toLowerCase().includes(res) ? 'WON' : 'LOST';
      it.each(texts)(`${dc} "%s" at ${ft.join('-')} -> ${expected}`, (t) => {
        expect(determineLegOutcome(leg('Dopio Shans', t), ctxOf([0, 0], ft))).toBe(expected);
      });
    }
  }
  it('the Odds API market (id Alpha_or_Draw) settles too', () => {
    const l = { market_id: 'm1-double_chance', market_name: 'Shans i Dyfishtë', selection_id: 'Alpha_FC_or_Draw', selection_name: 'Alpha FC ose Barazim', match_home: 'Alpha FC', match_away: 'Beta United' };
    expect(determineLegOutcome(l, ctxOf([0, 0], [1, 1]))).toBe('WON');
    expect(determineLegOutcome(l, ctxOf([0, 0], [0, 2]))).toBe('LOST');
  });
});

describe('45/90 & goals: every half-time / full-time / goals combination is WON or LOST', () => {
  const marketNames = ['45/90 & Numri i Golave', '45/90 & Gola', '45/90 & Totali', '45/90 dhe Numri i Golave', '45/90 Pjese Gola'];
  const goalSpecs = [
    // [spelling(s), predicate over total goals]
    [['0-1', '0-1 gola'], (g) => g <= 1], [['2-3'], (g) => g >= 2 && g <= 3], [['4+', '+4', '4 e me shume', '4 ose me shume'], (g) => g >= 4],
    [['3+', '+3', '3 +'], (g) => g >= 3], [['-2', '2-', '<=2'], (g) => g <= 2], [['2'], (g) => g === 2],
  ];
  const results = ['1', 'x', '2'];
  const htScores = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1]];
  const h2Scores = [[0, 0], [1, 0], [0, 2], [2, 2], [3, 0]];

  it('never returns null and always matches the independent expectation', () => {
    let checked = 0;
    for (const market of marketNames) {
      for (const ht of htScores) for (const h2 of h2Scores) {
        const ft = [ht[0] + h2[0], ht[1] + h2[1]];
        const goals = ft[0] + ft[1];
        for (const r1 of results) for (const r2 of results) {
          for (const [spellings, pred] of goalSpecs) for (const goalText of spellings) {
            const expected = sign(...ht) === r1 && sign(...ft) === r2 && pred(goals) ? 'WON' : 'LOST';
            for (const pair of [`${r1}-${r2}`, `${r1.toUpperCase()}/${r2}`]) {
              for (const sel of [`${pair}/${goalText}`, `${pair} & ${goalText}`]) {
                const out = determineLegOutcome(leg(market, sel), ctxOf(ht, ft));
                if (out !== expected) throw new Error(`${market} | ${sel} | ht ${ht} ft ${ft}: got ${out}, expected ${expected}`);
                checked++;
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10000);
  });

  it('the exact option of the report: "x-2/+3"', () => {
    const l = leg('45/90 & Numri i Golave', 'x-2/+3');
    expect(determineLegOutcome(l, ctxOf([1, 1], [1, 3]))).toBe('WON'); // x at the break, 2 at the end, 4 goals
    expect(determineLegOutcome(l, ctxOf([1, 1], [1, 2]))).toBe('WON'); // exactly 3 goals counts
    expect(determineLegOutcome(l, ctxOf([1, 1], [1, 1]))).toBe('LOST'); // ends x
    expect(determineLegOutcome(l, ctxOf([0, 0], [0, 2]))).toBe('LOST'); // only 2 goals
    expect(determineLegOutcome(l, ctxOf([1, 0], [1, 3]))).toBe('LOST'); // 1 at the break
  });

  it('"x/2/+3" (the pair itself written with a slash) is not mistaken for three parts', () => {
    expect(determineLegOutcome(leg('45/90 & Numri i Golave', 'x/2/+3'), ctxOf([1, 1], [1, 3]))).toBe('WON');
  });
});

describe('Total corners: every spelling of "10 or more" and the other options', () => {
  const stats = (h, a) => ({ cornersHome: h, cornersAway: a, cardsHome: 0, cardsAway: 0 });
  const markets = ['Shuma Totale Korne', 'Total Korne', 'Korne Totali', 'Numri i Korneve', 'Total Corners'];
  for (const total of [4, 9, 10, 11, 14]) {
    for (const market of markets) {
      const at = (sel, expected) => it(`${market} "${sel}" with ${total} corners -> ${expected}`, () => {
        expect(determineLegOutcome(leg(market, sel), ctxOf([0, 0], [1, 0], stats(Math.ceil(total / 2), Math.floor(total / 2))))).toBe(expected);
      });
      for (const t of ['10+', '+10', '10 e me shume', '10 ose me shume', '10 or more', '>=10']) at(t, total >= 10 ? 'WON' : 'LOST');
      for (const t of ['0-8', '-8', '8-', '8 e me pak']) at(t, total <= 8 ? 'WON' : 'LOST');
      at('9', total === 9 ? 'WON' : 'LOST');
      at('9-10', total >= 9 && total <= 10 ? 'WON' : 'LOST');
    }
  }
  it('a bare 1 / 2 in a side market is never read as a corner count', () => {
    const l = leg('Korne Cila Skuadra', '2');
    expect(determineLegOutcome(l, ctxOf([0, 0], [1, 0], stats(6, 5)))).toBeNull();
  });
});

describe('goal-count markets accept the same spellings', () => {
  const c = ctxOf([0, 0], [2, 1]); // 3 goals
  it.each([['3+', 'WON'], ['+3', 'WON'], ['3 e me shume', 'WON'], ['3', 'WON'], ['4+', 'LOST'], ['+4', 'LOST'], ['-2', 'LOST'], ['-3', 'WON'], ['0-1', 'LOST'], ['2-3', 'WON']])(
    'Numri i Golave "%s" with 3 goals -> %s', (sel, expected) => expect(determineLegOutcome(leg('Numri i Golave', sel), c)).toBe(expected));
  it('"Gola" is the same market', () => expect(determineLegOutcome(leg('Gola', '+3'), c)).toBe('WON'));
});

describe('combinations with a double chance', () => {
  const c = ctxOf([0, 0], [1, 2]); // X2 and 3 goals
  it.each([
    ['Dopio Shans me Kombinime', 'x2_3+', 'WON'], ['Dopio Shans me Kombinime', 'x2_+3', 'WON'], ['Dopio Shans me Kombinime', 'X2 & 3+', 'WON'], ['Dopio Shans me Kombinime', '1x_3+', 'LOST'], ['Dopio Shans me Kombinime', 'x2_0-1', 'LOST'],
    ['Dopio Shans & Numri i Golave', 'x2/+3', 'WON'], ['Dopio Shans & Numri i Golave', 'Barazim ose 2 & 3+', 'WON'], ['Dopio Shans & Numri i Golave', '1x/+3', 'LOST'],
    ['Dopio Shans & Numri i Golave', 'x2 & -2', 'LOST'], ['Dopio Shans dhe Numri i Golave', 'x2 / 2-3', 'WON'],
  ])('%s | %s -> %s', (market, sel, expected) => expect(determineLegOutcome(leg(market, sel), c)).toBe(expected));
});

// ---- option labels exactly as the live board prints them (from the market report) ----
describe('real feed labels that used to stay PENDING', () => {
  const L = (market_name, sel) => ({ market_id: 'x_m1', market_name, selection_id: sel, selection_name: sel, match_home: 'SS Lazio', match_away: 'FC Sudtirol Bolzano' });
  const run = (market, sel, ht, ft) => determineLegOutcome(L(market, sel), ctxOf(ht, ft));

  it('Rezultat Final | Barazim', () => {
    expect(run('Rezultat Final', 'Barazim', [0, 0], [1, 1])).toBe('WON');
    expect(run('Rezultat Final', 'Barazim', [0, 0], [2, 1])).toBe('LOST');
  });

  it('Numri i Golave Pritesi (home) like Udhetuesi (away)', () => {
    expect(run('Numri i Golave Pritesi', 'Lart 1.5', [0, 0], [2, 0])).toBe('WON');
    expect(run('Numri i Golave Pritesi', 'Poshte 1.5', [0, 0], [2, 0])).toBe('LOST');
    expect(run('Numri i Golave Udhetuesi', 'Lart 0.5', [0, 0], [2, 0])).toBe('LOST');
  });

  it('plain Handikap "1 -0.5" / "2 +1" / "(undefined)"', () => {
    expect(run('Handikap', '1 -0.5', [0, 0], [1, 0])).toBe('WON');
    expect(run('Handikap', '1 -0.5 (undefined)', [0, 0], [0, 0])).toBe('LOST');
    expect(run('Handikap', '2 -0.5', [0, 0], [0, 1])).toBe('WON');
    expect(run('Handikap', '2 +1', [0, 0], [1, 1])).toBe('WON');
    expect(run('Handikap', '1 -1', [0, 0], [1, 0])).toBe('VOID');
  });

  describe('Home / Away no bet: the named side winning refunds', () => {
    it.each([
      ['Away no bet', '1', [2, 0], 'WON'], ['Away no bet', '1', [1, 1], 'LOST'], ['Away no bet', '1', [0, 1], 'VOID'],
      ['Away  no bet', 'X', [1, 1], 'WON'], ['Away no bet', 'X', [2, 0], 'LOST'], ['Away no bet', 'X', [0, 3], 'VOID'],
      ['Home  no bet', 'X', [0, 0], 'WON'], ['Home no bet', 'X', [0, 2], 'LOST'], ['Home no bet', 'X', [2, 0], 'VOID'],
      ['Home no bet', '2', [0, 2], 'WON'], ['Home no bet', '2', [1, 1], 'LOST'], ['Home no bet', '2', [3, 0], 'VOID'],
    ])('%s | %s at %j -> %s', (market, sel, ft, expected) => expect(run(market, sel, [0, 0], ft)).toBe(expected));
  });

  describe('Halftime/fulltime & exact goals "1 Draw/Home"', () => {
    it.each([
      ['0 Draw/Draw', [0, 0], [0, 0], 'WON'], ['1 Draw/Home', [0, 0], [1, 0], 'WON'], ['1 Draw/Home', [0, 0], [2, 0], 'LOST'],
      ['1 Home/Home', [1, 0], [1, 0], 'WON'], ['1 Draw/Away', [0, 0], [0, 1], 'WON'], ['1 Draw/Away', [0, 1], [0, 1], 'LOST'],
      ['3+ Home/Home', [1, 0], [3, 0], 'WON'], ['3+ Home/Home', [1, 0], [2, 0], 'LOST'],
    ])('%s | ht %j ft %j -> %s', (sel, ht, ft, expected) => expect(run('Halftime/fulltime & exact goals', sel, ht, ft)).toBe(expected));
  });

  describe('Double chance (match) & 1st / 2nd half both teams score', () => {
    // 0-0 at the break, 2-2 final: second half 2-2 (both scored), first half none
    it.each([
      ['1st', 'HomeDraw / Yes', 'LOST'], ['1st', 'HomeDraw / No', 'WON'], ['1st', 'HomeAway / No', 'LOST'], ['1st', 'HomeAway / Yes', 'LOST'],
      ['2nd', 'HomeDraw / Yes', 'WON'], ['2nd', 'HomeDraw / No', 'LOST'], ['2nd', 'HomeAway / Yes', 'LOST'], ['2nd', 'DrawAway / Yes', 'WON'],
    ])('%s half | %s -> %s', (half, sel, expected) => expect(run(`Double chance (match) & ${half} half both teams score`, sel, [0, 0], [2, 2])).toBe(expected));
  });

  describe('RP1/RP2 & Gol/JoGol with GG / JG', () => {
    // first half 1-1 (both scored), second half 0-1 (not both) -> GG / JG
    it.each([['GG / JG', 'WON'], ['GG / GG', 'LOST'], ['JG / GG', 'LOST'], ['JG/ JG', 'LOST']])('%s -> %s', (sel, expected) =>
      expect(run('RP1/RP2 & Gol/JoGol', sel, [1, 1], [1, 2])).toBe(expected));
  });

  describe('Dopio Shans & Gol/JGol "X2_Gol"', () => {
    it.each([['X2_Gol', [1, 1], 'WON'], ['X2_JoGol', [0, 2], 'WON'], ['1X_Gol', [2, 2], 'WON'], ['1X_JoGol', [2, 0], 'WON'], ['12_Gol', [1, 1], 'LOST'], ['X2_Gol', [2, 0], 'LOST']])(
      '%s at %j -> %s', (sel, ft, expected) => expect(run('Dopio Shans & Gol/JGol', sel, [0, 0], ft)).toBe(expected));
  });
});
