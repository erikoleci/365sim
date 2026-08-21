import { describe, it, expect } from 'vitest';
import { findConflictingSelection, validateStakeAmount } from '../server/betValidation.js';

describe('findConflictingSelection', () => {
  it('returns null for selections across different matches/markets', () => {
    const selections = [
      { matchId: 'm1', marketId: 'm1-h2h', selectionId: 'HOME' },
      { matchId: 'm2', marketId: 'm2-h2h', selectionId: 'AWAY' },
      { matchId: 'm1', marketId: 'm1-totals', selectionId: 'Over-2.5' },
    ];
    expect(findConflictingSelection(selections)).toBeNull();
  });

  it('flags two selections from the same market on the same match (Home + Draw)', () => {
    const selections = [
      { matchId: 'm1', marketId: 'm1-h2h', selectionId: 'HOME' },
      { matchId: 'm1', marketId: 'm1-h2h', selectionId: 'DRAW' },
    ];
    const conflict = findConflictingSelection(selections);
    expect(conflict).toEqual({ existingSelectionId: 'HOME', newSelectionId: 'DRAW' });
  });

  it('flags Over + Under from the same totals market', () => {
    const selections = [
      { matchId: 'm1', marketId: 'm1-totals', selectionId: 'Over-2.5' },
      { matchId: 'm1', marketId: 'm1-totals', selectionId: 'Under-2.5' },
    ];
    expect(findConflictingSelection(selections)).not.toBeNull();
  });

  it('does not flag the same market on two different matches', () => {
    const selections = [
      { matchId: 'm1', marketId: 'm1-h2h', selectionId: 'HOME' },
      { matchId: 'm2', marketId: 'm2-h2h', selectionId: 'HOME' },
    ];
    expect(findConflictingSelection(selections)).toBeNull();
  });
});

describe('validateStakeAmount', () => {
  const bounds = { min: 10, max: 50000 };

  it('accepts a stake within bounds', () => {
    expect(validateStakeAmount(100, bounds)).toBeNull();
  });
  it('rejects a non-number stake', () => {
    expect(validateStakeAmount('100', bounds)).toMatch(/positive number/);
  });
  it('rejects NaN/Infinity', () => {
    expect(validateStakeAmount(NaN, bounds)).toMatch(/positive number/);
    expect(validateStakeAmount(Infinity, bounds)).toMatch(/positive number/);
  });
  it('rejects zero or negative stakes', () => {
    expect(validateStakeAmount(0, bounds)).toMatch(/positive number/);
    expect(validateStakeAmount(-5, bounds)).toMatch(/positive number/);
  });
  it('rejects below minimum', () => {
    expect(validateStakeAmount(5, bounds)).toMatch(/Minimum stake is 10/);
  });
  it('rejects above maximum', () => {
    expect(validateStakeAmount(100000, bounds)).toMatch(/Maximum stake is 50000/);
  });
  it('accepts the exact boundary values', () => {
    expect(validateStakeAmount(10, bounds)).toBeNull();
    expect(validateStakeAmount(50000, bounds)).toBeNull();
  });
});
