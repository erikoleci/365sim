import { describe, it, expect } from 'vitest';
import { determineLegOutcome } from '../server/matchSettlement.js';

// Final 2-1, half-time 1-0 (no goal for the away side in the first half).
const ctx = { winner: 'HOME', totalGoals: 3, bothScored: true, homeScore: 2, awayScore: 1, htHome: 1, htAway: 0 };
const out = (market_name, sel) => determineLegOutcome({ market_id: 'x_m1', market_name, selection_id: sel, selection_name: sel, match_home: 'Newcastle United', match_away: 'Everton FC' }, ctx);

describe('feed market names (Newcastle - Everton sample)', () => {
  it('"Numri i Golave Pritesi" = the home side total goals (home scored 2)', () => {
    expect(out('Numri i Golave Pritesi', 'Lart 1.5')).toBe('WON');
    expect(out('Numri i Golave Pritesi', 'Poshte 1.5')).toBe('LOST');
    expect(out('Numri i Golave Udhetuesi', 'Lart 0.5')).toBe('WON');
  });
  it('first-half double chance & BTTS: the half covers both parts (HT 1-0: BTTS No)', () => {
    expect(out('1st half - double chance & both teams to score', 'HomeAway / No')).toBe('WON');
    expect(out('1st half - double chance & both teams to score', 'HomeDraw / No')).toBe('WON');
    expect(out('1st half - double chance & both teams to score', 'HomeAway / Yes')).toBe('LOST');
    expect(out('1st half - double chance & both teams to score', 'DrawAway / No')).toBe('LOST');
  });
  it('first-half 1x2 & BTTS', () => {
    expect(out('1st half - 1x2 & both teams to score', 'Home / No')).toBe('WON');
    expect(out('1st half - 1x2 & both teams to score', 'Home / Yes')).toBe('LOST');
  });
  it('"Double chance (match) & 1st half both teams score": full-time DC, first-half BTTS', () => {
    expect(out('Double chance (match) & 1st half both teams score', 'HomeDraw / No')).toBe('WON');
    expect(out('Double chance (match) & 1st half both teams score', 'HomeDraw / Yes')).toBe('LOST');
    expect(out('Double chance (match) & 1st half both teams score', 'DrawAway / No')).toBe('LOST');
  });
});

describe('Gol/JoGol and Dopio Shans (+ combos) at several scores', () => {
  const c = (h, a) => ({ winner: h > a ? 'HOME' : a > h ? 'AWAY' : 'DRAW', totalGoals: h + a, bothScored: h > 0 && a > 0, homeScore: h, awayScore: a, htHome: 0, htAway: 0 });
  const o = (m, s, h, a) => determineLegOutcome({ market_id: 'x_m', market_name: m, selection_id: s, selection_name: s, match_home: 'A', match_away: 'B' }, c(h, a));
  it('Gol = both teams score, Jo Gol = not both', () => {
    expect(o('Gol/JoGol', 'Po', 2, 1)).toBe('WON'); expect(o('Gol/JoGol', 'Jo', 2, 0)).toBe('WON'); expect(o('Gol/JoGol', 'Jo', 1, 1)).toBe('LOST');
  });
  it('Dopio Shans: 1X draw or home, X2 draw or away, 12 either wins (X1 / 2X written the other way too)', () => {
    expect(o('Dopio Shans', '1X', 1, 1)).toBe('WON'); expect(o('Dopio Shans', 'X2', 2, 1)).toBe('LOST'); expect(o('Dopio Shans', '12', 1, 1)).toBe('LOST');
    expect(o('Dopio Shans', 'X1', 0, 2)).toBe('LOST'); expect(o('Dopio Shans', '2X', 0, 2)).toBe('WON');
  });
  it('double chance + goals, separated by "/", "_" or a space ("X1 3+")', () => {
    const m = 'Dopio Shans & Numri i Golave në Ndeshje';
    expect(o(m, '1X/3+', 2, 1)).toBe('WON'); expect(o(m, 'X1 3+', 2, 1)).toBe('WON'); expect(o(m, 'X1 3+', 1, 0)).toBe('LOST');
    expect(o(m, 'X2/0-2', 0, 1)).toBe('WON'); expect(o(m, 'X2/0-2', 1, 3)).toBe('LOST');
  });
  it('"Fiton Pritesi ose 3+", "Barazim ose 3+", "Fiton Udhetuesi ose 0-2 Gola"', () => {
    expect(o('Fiton Pritesi ose 3+', 'Po', 1, 0)).toBe('WON'); expect(o('Fiton Pritesi ose 3+', 'Po', 0, 1)).toBe('LOST'); expect(o('Fiton Pritesi ose 3+', 'Po', 0, 3)).toBe('WON');
    expect(o('Barazim ose 3+', 'Po', 0, 0)).toBe('WON'); expect(o('Barazim ose 3+', 'Po', 1, 0)).toBe('LOST');
    expect(o('Fiton Udhetuesi ose 0-2 Gola', 'Po', 3, 1)).toBe('LOST'); expect(o('Fiton Udhetuesi ose 0-2 Gola', 'Po', 0, 1)).toBe('WON');
  });
});
