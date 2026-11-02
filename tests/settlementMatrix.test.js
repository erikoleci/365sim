import { describe, it, expect } from 'vitest';
import { determineLegOutcome } from '../server/matchSettlement.js';

// WIN / LOSS / VOID / PENDING matrix per market format. Every case states the final and half-time score.
const base = (h, a, ht, at, extra = {}) => ({
  winner: h > a ? 'HOME' : a > h ? 'AWAY' : 'DRAW',
  totalGoals: h + a, bothScored: h > 0 && a > 0, homeScore: h, awayScore: a, htHome: ht, htAway: at, ...extra,
});
const leg = (market_name, sel) => ({ market_id: '', market_name, selection_id: sel, selection_name: sel, match_home: 'Elche CF', match_away: 'Valencia CF' });
const run = (m, s, ctx) => determineLegOutcome(leg(m, s), ctx);

const c21 = base(2, 1, 1, 0);   // home win 2-1, HT 1-0
const c00 = base(0, 0, 0, 0);   // goalless draw
const c13 = base(1, 3, 1, 1);   // away win 1-3, HT 1-1
const noHt = base(2, 1, NaN, NaN);

const cases = [
  // [market, selection, ctx, expected]
  ['Rezultat Final', '1', c21, 'WON'], ['Rezultat Final', 'X', c21, 'LOST'], ['Rezultat Final', '2', c21, 'LOST'],
  ['Rezultat Final', 'X', c00, 'WON'], ['Rezultat Final', '2', c13, 'WON'],
  ['Dopio Shans', '1X', c21, 'WON'], ['Dopio Shans', 'X2', c21, 'LOST'], ['Dopio Shans', '12', c21, 'WON'],
  ['Dopio Shans', '1X', c13, 'LOST'], ['Dopio Shans', 'X2', c13, 'WON'], ['Dopio Shans', '12', c00, 'LOST'], ['Dopio Shans', 'X2', c00, 'WON'],
  ['Gol/Jogol', 'Gol', c21, 'WON'], ['Gol/Jogol', 'JoGol', c21, 'LOST'], ['Gol/Jogol', 'Gol', c00, 'LOST'], ['Gol/Jogol', 'JoGol', c00, 'WON'],
  ['Numri i Golave ne Ndeshje', 'Lart 2.5', c21, 'WON'], ['Numri i Golave ne Ndeshje', 'Poshte 2.5', c21, 'LOST'],
  ['Numri i Golave ne Ndeshje', 'Lart 3', c21, 'VOID'], ['Numri i Golave ne Ndeshje', 'Poshte 3', c21, 'VOID'],
  ['Numri i Golave ne Ndeshje', 'Poshte 0.5', c00, 'WON'], ['Numri i Golave ne Ndeshje', 'Lart 0.5', c00, 'LOST'],
  ['Tek/Çift', 'Tek', c21, 'WON'], ['Tek/Çift', 'Çift', c21, 'LOST'], ['Tek/Çift', 'Çift', c00, 'WON'],
  ['Rezultati i Saktë', '2-1', c21, 'WON'], ['Rezultati i Saktë', '1-2', c21, 'LOST'], ['Rezultati i Saktë', '0-0', c00, 'WON'],
  // 45/90 is played BY HALVES (confirmed from a real ticket): 2-1 with HT 1-0 = home wins H1 (1-0), H2 is 1-1 (X).
  ['Pushim/Fund', '1/X', c21, 'WON'], ['Pushim/Fund', '1/1', c21, 'LOST'], ['Pushim/Fund', '1/2', c21, 'LOST'],
  // 1-3 with HT 1-1: H1 draw, H2 0-2 = away
  ['Pushim/Fund', 'X/2', c13, 'WON'], ['Pushim/Fund', 'X/X', c13, 'LOST'],
  ['Pushim/Fund', '1/1', noHt, null], ['Pushim/Fund', '2/2', noHt, 'LOST'],
  ['Handikap', '1 -0.5', c21, 'WON'], ['Handikap', '1 -1.5', c21, 'LOST'], ['Handikap', '1 -1', c21, 'VOID'], ['Handikap', '2 +1', c21, 'VOID'],
  ['Handikap', '2 +1.5', c21, 'WON'],
  ['Rezultat Final & Totali', '1 & Lart 2.5', c21, 'WON'], ['Rezultat Final & Totali', '1 & Poshte 2.5', c21, 'LOST'],
  ['Rezultat Final & Totali', '2 & Lart 2.5', c21, 'LOST'], ['Rezultat Final & Totali', 'X & Poshte 0.5', c00, 'WON'],
  ['Dopio Shans & Numri i Golave në Ndeshje', '1X & Lart 2.5', c21, 'WON'],
  ['Dopio Shans & Numri i Golave në Ndeshje', 'X2 & Lart 2.5', c21, 'LOST'],
];

describe('settlement matrix: WON / LOST / VOID / PENDING per format', () => {
  for (const [m, s, ctx, expected] of cases) {
    it(`${m} | ${s} | ${ctx.homeScore}-${ctx.awayScore} -> ${expected === null ? 'PENDING' : expected}`, () => {
      expect(run(m, s, ctx)).toBe(expected);
    });
  }
});

describe('PENDING, never a guess', () => {
  it('unknown market names stay pending', () => {
    expect(run('Treg i Panjohur 123', 'A', c21)).toBeNull();
    expect(run('Diçka e Panjohur', '1', c21)).toBeNull();
  });
  it('a score that is not a number stays pending', () => {
    const noScore = base(NaN, NaN, NaN, NaN, { winner: undefined, totalGoals: NaN });
    expect(run('Rezultat Final', '1', noScore)).toBeNull();
    expect(run('Dopio Shans', '1X', noScore)).toBeNull();
    expect(run('Home No Bet', '1', noScore)).toBeNull();
  });
});

// ---- corners / cards / halves: with counters, with line on the number (VOID), and WITHOUT counters (PENDING) ----
const stats = { cornersHome: 6, cornersAway: 4, cardsHome: 2, cardsAway: 1, yellowHome: 2, yellowAway: 1, redHome: 0, redAway: 0 };
const htStats = { cornersHome: 3, cornersAway: 1, cardsHome: 1, cardsAway: 0, yellowHome: 1, yellowAway: 0, redHome: 0, redAway: 0 };
const withStats = { ...c21, stats, htStats };   // 10 corners (4 in H1, 6 in H2)
const noStats = { ...c21 };

describe('corner totals (10 corners)', () => {
  const m = 'Lart/Poshtë Korne Totali';
  const rows = [['Lart 9.5', 'WON'], ['Poshte 9.5', 'LOST'], ['Lart 10.5', 'LOST'], ['Poshte 10.5', 'WON'], ['Lart 10', 'VOID'], ['Poshte 10', 'VOID']];
  for (const [s, e] of rows) it(`${m} | ${s} -> ${e}`, () => expect(run(m, s, withStats)).toBe(e));
  it('no counters -> PENDING', () => expect(run(m, 'Lart 9.5', noStats)).toBeNull());
});

describe('corner totals per half', () => {
  it('first half 4 corners', () => {
    expect(run('Lart/Poshtë Korne Pjesa 1-rë', 'Lart 3.5', withStats)).toBe('WON');
    expect(run('Lart/Poshtë Korne Pjesa 1-rë', 'Lart 4.5', withStats)).toBe('LOST');
  });
  it('second half 6 corners', () => {
    expect(run('Lart/Poshtë Korne Pjesa 2-të', 'Lart 5.5', withStats)).toBe('WON');
    expect(run('Lart/Poshtë Korne Pjesa 2-të', 'Poshte 5.5', withStats)).toBe('LOST');
  });
  it('half counters missing -> PENDING', () => {
    expect(run('Lart/Poshtë Korne Pjesa 1-rë', 'Lart 3.5', { ...c21, stats })).toBeNull();
  });
});

describe('Shuma e korneve P1+P2 (4 in H1, 6 in H2)', () => {
  it('both halves must fit', () => {
    expect(run('Shuma e korneve P1+P2', '4+|6+', withStats)).toBe('WON');
    expect(run('Shuma e korneve P1+P2', '5+|6+', withStats)).toBe('LOST');
    expect(run('Shuma e korneve P1+P2', '4+|7+', withStats)).toBe('LOST');
  });
  it('no counters -> PENDING', () => expect(run('Shuma e korneve P1+P2', '4+|6+', noStats)).toBeNull());
});

describe('card totals (3 cards)', () => {
  const m = 'Kartonë Totali';
  it('over / under / push', () => {
    expect(run(m, 'Lart 2.5', withStats)).toBe('WON');
    expect(run(m, 'Poshte 2.5', withStats)).toBe('LOST');
    expect(run(m, 'Lart 3', withStats)).toBe('VOID');
  });
  it('no counters -> PENDING', () => expect(run(m, 'Lart 2.5', noStats)).toBeNull());
});

describe('halves: goals', () => {
  // 2-1, HT 1-0: H1 1 goal, H2 2 goals
  it('Tek/Çift per half', () => {
    expect(run('Tek/Çift Pjesa 1', 'Tek', c21)).toBe('WON');
    expect(run('Tek/Çift Pjesa 1', 'Çift', c21)).toBe('LOST');
    expect(run('Tek/Çift Pjesa 2', 'Çift', c21)).toBe('WON');
  });
  it('no half-time score -> PENDING', () => {
    expect(run('Tek/Çift Pjesa 1', 'Tek', noHt)).toBeNull();
  });
});
