import { describe, it, expect } from 'vitest';
import { determineLegOutcome } from '../server/matchSettlement.js';

const leg = (market_id, selection_id) => ({ market_id, selection_id });

describe('determineLegOutcome — 1X2 (h2h)', () => {
  it('settles HOME as WON when the home team wins', () => {
    expect(determineLegOutcome(leg('m1-h2h', 'HOME'), { winner: 'HOME', totalGoals: 2, bothScored: false })).toBe('WON');
  });
  it('settles AWAY as LOST when the home team wins', () => {
    expect(determineLegOutcome(leg('m1-h2h', 'AWAY'), { winner: 'HOME', totalGoals: 2, bothScored: false })).toBe('LOST');
  });
  it('settles DRAW as WON on a draw', () => {
    expect(determineLegOutcome(leg('m1-h2h', 'DRAW'), { winner: 'DRAW', totalGoals: 2, bothScored: true })).toBe('WON');
  });
});

describe('determineLegOutcome — totals (over/under)', () => {
  it('Over 2.5 wins when total goals > 2.5', () => {
    expect(determineLegOutcome(leg('m1-totals', 'Over-2.5'), { winner: 'HOME', totalGoals: 3, bothScored: false })).toBe('WON');
  });
  it('Over 2.5 loses when total goals < 2.5', () => {
    expect(determineLegOutcome(leg('m1-totals', 'Over-2.5'), { winner: 'HOME', totalGoals: 1, bothScored: false })).toBe('LOST');
  });
  it('Under 2.5 wins when total goals < 2.5', () => {
    expect(determineLegOutcome(leg('m1-totals', 'Under-2.5'), { winner: 'AWAY', totalGoals: 1, bothScored: false })).toBe('WON');
  });
  it('a push line (exact total = line) is left pending for manual review', () => {
    expect(determineLegOutcome(leg('m1-totals', 'Over-3'), { winner: 'HOME', totalGoals: 3, bothScored: true })).toBeNull();
  });
});

describe('determineLegOutcome — both teams to score (btts)', () => {
  it('Yes wins when both teams scored', () => {
    expect(determineLegOutcome(leg('m1-btts', 'Yes'), { winner: 'HOME', totalGoals: 2, bothScored: true })).toBe('WON');
  });
  it('No wins when only one team scored', () => {
    expect(determineLegOutcome(leg('m1-btts', 'No'), { winner: 'HOME', totalGoals: 2, bothScored: false })).toBe('WON');
  });
});

describe('determineLegOutcome — markets intentionally left pending', () => {
  it('double_chance is never auto-settled', () => {
    expect(determineLegOutcome(leg('m1-double_chance', 'HOME_DRAW'), { winner: 'HOME', totalGoals: 2, bothScored: false })).toBeNull();
  });
  it('draw_no_bet is never auto-settled', () => {
    expect(determineLegOutcome(leg('m1-draw_no_bet', 'HOME'), { winner: 'HOME', totalGoals: 2, bothScored: false })).toBeNull();
  });
  it('spreads (handicap) is never auto-settled', () => {
    expect(determineLegOutcome(leg('m1-spreads', 'Home--1.5'), { winner: 'HOME', totalGoals: 2, bothScored: false })).toBeNull();
  });
});
