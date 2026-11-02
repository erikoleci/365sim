import { describe, it, expect } from 'vitest';
import { determineLegOutcome } from '../server/matchSettlement.js';
import { extraMarketOutcome } from '../server/extraMarkets.js';

// Final 2-1, half-time 1-0 (second half 1-1).
// Cards: first half 3 yellow (home 1, away 2), whole match 4 yellow (home 2, away 2), second half 1 (home).
const ctx = {
  winner: 'HOME', totalGoals: 3, bothScored: true, homeScore: 2, awayScore: 1, htHome: 1, htAway: 0,
  stats: { yellowHome: 2, yellowAway: 2, redHome: 0, redAway: 0, cardsHome: 2, cardsAway: 2, cornersHome: 5, cornersAway: 3 },
  htStats: { cardsHome: 1, cardsAway: 2, redHome: 0, redAway: 0, cornersHome: 2, cornersAway: 1 },
};
const leg = (market_name, sel) => ({ market_id: '', market_name, selection_id: sel, selection_name: sel, match_home: 'Elche CF', match_away: 'Valencia CF' });
const out = (m, s, c = ctx) => determineLegOutcome(leg(m, s), c);

describe('RP1/RP2 & Gol/JoGol: GG / JG = both teams score (or not) in each half', () => {
  // first half 1-0 (no both-score), second half 1-1 (both score)
  it('reads the first-half and second-half Gol/JoGol', () => {
    expect(out('RP1/RP2 & Gol/JoGol', 'JG / GG')).toBe('WON');
    expect(out('RP1/RP2 & Gol/JoGol', 'GG / GG')).toBe('LOST');
    expect(out('RP1/RP2 & Gol/JoGol', 'GG / JG')).toBe('LOST');
    expect(out('RP1/RP2 & Gol/JoGol', 'JG / JG')).toBe('LOST');
  });
  it('accepts the other spellings of the separator', () => {
    expect(out('RP1/RP2 & Gol/JoGol', 'jg/gg')).toBe('WON');
    expect(out('RP1/RP2 & Gol/JoGol', 'JG GG')).toBe('WON');
    expect(out('RP1/RP2 & Gol/JoGol', 'JG - GG')).toBe('WON');
  });
  it('stays open without a half-time score', () => {
    expect(out('RP1/RP2 & Gol/JoGol', 'JG / GG', { ...ctx, htHome: undefined, htAway: undefined })).toBeNull();
  });
  it('keeps the older "result / result & Gol" reading', () => {
    expect(out('RP1/RP2 & Gol/JoGol', '1/X & Gol')).toBe('WON');
  });
});

describe('Rezultat Final me Kartona: 1 / X / 2 + cards of the whole match (3.5 Lart = 4+ cards)', () => {
  it('reads the option in any order', () => {
    expect(out('Rezultat Final me Kartona', '1 & Lart 3.5')).toBe('WON');
    expect(out('Rezultat Final me Kartona', '1 / 3.5 Lart')).toBe('WON');
    expect(out('Rezultat Final me Kartona', '1 3.5 Lart')).toBe('WON');
    expect(out('Rezultat Final me Kartona', '1 - Mbi 3.5')).toBe('WON');
    expect(out('Rezultat Final me Kartona', 'Lart 3.5 1')).toBe('WON');
  });
  it('is lost when the result or the card side is wrong', () => {
    expect(out('Rezultat Final me Kartona', '1 Nen 3.5')).toBe('LOST');
    expect(out('Rezultat Final me Kartona', 'X & Lart 3.5')).toBe('LOST');
    expect(out('Rezultat Final me Kartona', '2 Nen 4.5')).toBe('LOST');
  });
  it('under a higher line wins', () => {
    expect(out('Rezultat Final me Kartona', '1 & Nen 4.5')).toBe('WON');
    expect(out('Rezultat Final me Kartona', '1 & Lart 4.5')).toBe('LOST');
  });
  it('takes the line from the market name when the option has only the result and the side', () => {
    expect(out('Rezultat Final me Kartona 3.5', '1 Lart')).toBe('WON');
    expect(out('Rezultat Final me Kartona 3.5', '1 Nen')).toBe('LOST');
  });
  it('an unreadable option stays open', () => {
    expect(out('Rezultat Final me Kartona', 'diçka tjetër')).toBeNull();
    expect(out('Rezultat Final me Kartona', '1')).toBeNull();
  });
  it('counts a red card as a card', () => {
    const red = { ...ctx, stats: { ...ctx.stats, yellowHome: 2, yellowAway: 1, redAway: 1 } };
    expect(out('Rezultat Final me Kartona', '1 & Lart 3.5', red)).toBe('WON');
  });
});

describe('Rezultat i P1 / P2 me kartona: result and cards of that half only', () => {
  it('P1: first half 1-0 with 3 cards', () => {
    expect(out('Rezultat i P1 me kartona', '1 & Lart 2.5')).toBe('WON');
    expect(out('Rezultat i P1 me kartona', '1 & Lart 3.5')).toBe('LOST');
    expect(out('Rezultat i P1 me kartona', '1 & Nen 3.5')).toBe('WON');
    expect(out('Rezultat i P1 me kartona', '1 / 4.5 Nen')).toBe('WON');
    expect(out('Rezultat i P1 me kartona', '2 & Nen 3.5')).toBe('LOST');
  });
  it('P2: second half 1-1 with 1 card', () => {
    expect(out('Rezultat i P2 me kartona', 'X & Nen 1.5')).toBe('WON');
    expect(out('Rezultat i P2 me kartona', 'X & Lart 0.5')).toBe('WON');
    expect(out('Rezultat i P2 me kartona', 'X & Lart 1.5')).toBe('LOST');
    expect(out('Rezultat i P2 me kartona', '1 & Lart 0.5')).toBe('LOST');
  });
  it('stays open when the half-time counters are missing', () => {
    const noHt = { ...ctx, htStats: undefined };
    expect(out('Rezultat i P1 me kartona', '1 & Lart 2.5', noHt)).toBeNull();
    expect(out('Rezultat i P2 me kartona', 'X & Lart 0.5', noHt)).toBeNull();
  });
  it('the rule exists for all three names', () => {
    for (const n of ['rezultat final me kartona', 'rezultat i p1 me kartona', 'rezultat i p2 me kartona']) {
      expect(extraMarketOutcome(leg(n, '1 & Lart 2.5'), n, ctx)).not.toBeUndefined();
    }
  });
});
