import { describe, it, expect } from 'vitest';
import { determineLegOutcome } from '../server/matchSettlement.js';

// Final 1-3, half-time 0-0, corners 6 + 5 = 11 (5 at the break), both teams scored.
const ctx = {
  winner: 'AWAY', totalGoals: 4, bothScored: true, homeScore: 1, awayScore: 3, htHome: 0, htAway: 0,
  stats: { cornersHome: 6, cornersAway: 5 }, htStats: { cornersHome: 3, cornersAway: 2 },
};
const leg = (market, selection) => ({ market_id: 'x_m1', market_name: market, selection_id: selection, selection_name: selection, match_home: 'Venezia FC', match_away: 'Inter Milano' });
const out = (market, selection) => determineLegOutcome(leg(market, selection), ctx);

describe('combination markets settle to WON or LOST (never left open / refunded)', () => {
  it('"Dopio Shans & Gol/JGol": double chance AND both teams score (selection "X2_Gol", "1X_JGol" ...)', () => {
    expect(out('Dopio Shans & Gol/JGol', 'X2_Gol')).toBe('WON');   // away won, both scored
    expect(out('Dopio Shans & Gol/JGol', '12_Gol')).toBe('WON');
    expect(out('Dopio Shans & Gol/JGol', '1X_Gol')).toBe('LOST');  // 1X fails
    expect(out('Dopio Shans & Gol/JGol', 'X2_JGol')).toBe('LOST'); // they did both score
    expect(out('Dopio Shans & Gol/JGol', '1X_JoGol')).toBe('LOST');
    expect(out('Dopio Shans & Gol/JGol', 'X2_Jo Gol')).toBe('LOST');
  });
  it('"Rezultat Final & Gol/JGol" with "_", "/" or "&"', () => {
    expect(out('Rezultat Final & Gol/JGol', '2_Gol')).toBe('WON');
    expect(out('Rezultat Final & Gol/JGol', '1_Gol')).toBe('LOST');
    expect(out('Rezultat Final & Gol/Jogol', '2 & Po')).toBe('WON');
    expect(out('Rezultat Final & Gol/Jogol', '2 & Jo')).toBe('LOST');
  });
  it('"45/90 & Numri i Golave në Ndeshje": half-time result - full-time result / goals ("X-2/3+")', () => {
    expect(out('45/90 & Numri i Golave në Ndeshje', 'X-2/3+')).toBe('WON');   // HT draw, away win, 4 goals
    expect(out('45/90 & Numri i Golave në Ndeshje', 'X-2/5+')).toBe('LOST');  // only 4 goals
    expect(out('45/90 & Numri i Golave në Ndeshje', '1-2/3+')).toBe('LOST');  // HT was a draw
    expect(out('45/90 & Numri i Golave në Ndeshje', 'X-2_3+')).toBe('WON');
    expect(out('45/90 & Numri i Golave në Ndeshje', 'X/2/3+')).toBe('WON');   // the HT/FT part written with a slash
    expect(out('45/90 & Gol/JGol', 'X-2_Gol')).toBe('WON');
    expect(out('45/90 & Totali', 'X-2 & Lart 2.5')).toBe('WON');
  });
  it('other double / result + goals combinations', () => {
    expect(out('Dopio Shans & Totali', 'X2 & Lart 2.5')).toBe('WON');
    expect(out('Dopio Shans & Totali', 'X2_Lart 2.5')).toBe('WON');
    expect(out('Dopio Shans & Totali', '1X & Lart 2.5')).toBe('LOST');
    expect(out('Dopio Shans & Numri i Golave', 'X2/3+')).toBe('WON');
    expect(out('Rezultat Final & Numri i Golave', 'X/5+')).toBe('LOST');
    expect(out('Totali & Gol/JGol', 'Lart 2.5 & Po')).toBe('WON');
  });
  it('"Shuma total e korneve" counts BOTH teams\' corners: 10+ / 0-8 / 9-10 / Mbi 9.5 / Sakte 11', () => {
    expect(out('Shuma total e korneve', '10+')).toBe('WON');   // 11 corners
    expect(out('Shuma total e korneve', '12+')).toBe('LOST');
    expect(out('Shuma total e korneve', '0-8')).toBe('LOST');
    expect(out('Shuma total e korneve', '9-10')).toBe('LOST');
    expect(out('Shuma total e korneve', '11-14')).toBe('WON');
    expect(out('Shuma total e korneve', 'Mbi 9.5')).toBe('WON');
    expect(out('Shuma total e korneve', 'Sakte 11')).toBe('WON');
  });
  it('a team called "A" does not turn the corner total into that team\'s corners', () => {
    const l = { market_id: 'x', market_name: 'Shuma total e korneve', selection_id: '10+', selection_name: '10+', match_home: 'A', match_away: 'B' };
    expect(determineLegOutcome(l, ctx)).toBe('WON');
  });
});
