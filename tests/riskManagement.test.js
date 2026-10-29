import { describe, it, expect } from 'vitest';

// Mirrors the exposure-cap check in server/routes/bets.js — kept here as a
// pure function so the rule itself has regression coverage without a DB.
const MAX_SELECTION_EXPOSURE = 5000000;
function wouldExceedExposure(currentExposure, newPotentialReturn) {
  return currentExposure + newPotentialReturn > MAX_SELECTION_EXPOSURE;
}

// Mirrors the per-ticket payout cap in server/routes/bets.js and components/BetSlip.tsx.
const MAX_POTENTIAL_RETURN = 1000000;
function exceedsMaxReturn(stake, totalOdds) {
  return Number((stake * totalOdds).toFixed(2)) > MAX_POTENTIAL_RETURN;
}

describe('risk management: max potential return per ticket', () => {
  it('allows a ticket that pays exactly the cap', () => {
    expect(exceedsMaxReturn(1000, 1000)).toBe(false);
  });

  it('blocks a ticket whose payout is above the cap', () => {
    expect(exceedsMaxReturn(1000, 1000.01)).toBe(true);
    expect(exceedsMaxReturn(10, 100001)).toBe(true);
  });

  it('allows a normal ticket', () => {
    expect(exceedsMaxReturn(500, 12.4)).toBe(false);
  });
});

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
