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
