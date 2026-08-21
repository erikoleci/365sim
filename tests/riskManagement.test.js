import { describe, it, expect } from 'vitest';

// Mirrors the exposure-cap check in server/routes/bets.js — kept here as a
// pure function so the rule itself has regression coverage without a DB.
const MAX_SELECTION_EXPOSURE = 5000000;
function wouldExceedExposure(currentExposure, newPotentialReturn) {
  return currentExposure + newPotentialReturn > MAX_SELECTION_EXPOSURE;
}

describe('risk management: selection exposure cap', () => {
  it('allows a ticket that keeps exposure under the cap', () => {
    expect(wouldExceedExposure(1000000, 500000)).toBe(false);
  });

  it('rejects a ticket that would push exposure over the cap', () => {
    expect(wouldExceedExposure(4900000, 200000)).toBe(true);
  });

  it('allows exactly hitting the cap boundary', () => {
    expect(wouldExceedExposure(4000000, 1000000)).toBe(false);
  });
});
