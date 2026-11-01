import { describe, it, expect } from 'vitest';
import { diceOutcome, DICE_BETS } from '../server/routes/casino.js';

describe('dice outcome', () => {
  it('classifies the sum of two dice', () => {
    expect(diceOutcome(1, 1)).toBe('UNDER');
    expect(diceOutcome(3, 3)).toBe('UNDER');
    expect(diceOutcome(3, 4)).toBe('SEVEN');
    expect(diceOutcome(6, 1)).toBe('SEVEN');
    expect(diceOutcome(4, 4)).toBe('OVER');
    expect(diceOutcome(6, 6)).toBe('OVER');
  });
  it('offers exactly the three bets', () => { expect(DICE_BETS).toEqual(['UNDER', 'SEVEN', 'OVER']); });
});
