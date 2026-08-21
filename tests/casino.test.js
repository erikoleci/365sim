import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  validateStake,
  calcBjScore,
  buildShuffledDeck,
  resolveBlackjackResult,
  scoreBaccaratHand,
  dealBaccaratRound,
  WIN_CHANCE,
} from '../server/routes/casino.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateStake', () => {
  it('accepts stakes within [1, 5000]', () => {
    expect(validateStake(1)).toBe(true);
    expect(validateStake(5000)).toBe(true);
    expect(validateStake(250)).toBe(true);
  });
  it('rejects out-of-range or malformed stakes', () => {
    expect(validateStake(0)).toBe(false);
    expect(validateStake(5001)).toBe(false);
    expect(validateStake(-10)).toBe(false);
    expect(validateStake(NaN)).toBe(false);
    expect(validateStake('50')).toBe(false);
    expect(validateStake(undefined)).toBe(false);
  });
});

describe('calcBjScore (blackjack scoring incl. soft aces)', () => {
  const c = (value, numValue) => ({ value, numValue });

  it('sums a plain hand', () => {
    expect(calcBjScore([c('7', 7), c('9', 9)])).toBe(16);
  });

  it('counts a natural blackjack as 21', () => {
    expect(calcBjScore([c('A', 11), c('K', 10)])).toBe(21);
  });

  it('downgrades an Ace from 11 to 1 to avoid busting', () => {
    // A + 5 + 8 = 11 + 5 + 8 = 24 (bust) -> Ace becomes 1 -> 14
    expect(calcBjScore([c('A', 11), c('5', 5), c('8', 8)])).toBe(14);
  });

  it('handles multiple aces correctly', () => {
    // A + A + 9 = 11+11+9=31 -> one ace to 1 -> 21
    expect(calcBjScore([c('A', 11), c('A', 11), c('9', 9)])).toBe(21);
  });

  it('still reports a bust when no ace adjustment can save it', () => {
    expect(calcBjScore([c('K', 10), c('Q', 10), c('5', 5)])).toBe(25);
  });
});

describe('buildShuffledDeck', () => {
  it('produces exactly 52 unique cards', () => {
    const deck = buildShuffledDeck();
    expect(deck).toHaveLength(52);
    const keys = new Set(deck.map((c) => `${c.suit}${c.value}`));
    expect(keys.size).toBe(52);
  });

  it('gives every card a numeric blackjack value', () => {
    const deck = buildShuffledDeck();
    for (const card of deck) {
      expect(typeof card.numValue).toBe('number');
      expect(card.numValue).toBeGreaterThan(0);
    }
    // Face cards are worth 10, Ace worth 11 (soft, downgraded later by calcBjScore)
    expect(deck.find((c) => c.value === 'K').numValue).toBe(10);
    expect(deck.find((c) => c.value === 'A').numValue).toBe(11);
  });
});

describe('resolveBlackjackResult (house-gated payouts)', () => {
  const stake = 100;

  it('a LOSS always pays 0', () => {
    const outcome = resolveBlackjackResult(stake, { kind: 'LOSS', message: 'DEALER WINS' });
    expect(outcome.payout).toBe(0);
    expect(outcome.message).toBe('DEALER WINS');
  });

  it('a PUSH always returns exactly the stake (no net gain/loss)', () => {
    const outcome = resolveBlackjackResult(stake, { kind: 'PUSH', message: 'PUSH' });
    expect(outcome.payout).toBe(stake);
  });

  it('a WIN is downgraded to DEALER WINS (payout 0) outside the house win chance', () => {
    vi.spyOn(Math, 'random').mockReturnValue(WIN_CHANCE + 0.5); // well above the win threshold
    const outcome = resolveBlackjackResult(stake, { kind: 'WIN', message: 'YOU WIN' });
    expect(outcome.payout).toBe(0);
    expect(outcome.message).toBe('DEALER WINS');
  });

  it('a WIN inside the house win chance pays a small capped profit (5%-50% of stake)', () => {
    // First Math.random() call gates WIN_CHANCE (must be < WIN_CHANCE to win),
    // second call feeds smallProfitMultiplier's own Math.random().
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0) // wins the gate
      .mockReturnValueOnce(0); // smallProfitMultiplier at its floor (1.05x)
    const outcome = resolveBlackjackResult(stake, { kind: 'WIN', message: 'YOU WIN' });
    expect(outcome.payout).toBeCloseTo(105, 5); // 100 * 1.05
    expect(outcome.message).toBe('YOU WIN');
  });

  it('a winning payout never exceeds 1.5x stake (the capped profit ceiling)', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)   // wins the gate
      .mockReturnValueOnce(1);  // smallProfitMultiplier at its ceiling
    const outcome = resolveBlackjackResult(stake, { kind: 'WIN', message: 'YOU WIN' });
    expect(outcome.payout).toBeLessThanOrEqual(stake * 1.5);
  });
});

describe('scoreBaccaratHand', () => {
  it('scores as the last digit of the sum (mod 10)', () => {
    expect(scoreBaccaratHand([{ numValue: 7 }, { numValue: 8 }])).toBe(5); // 15 -> 5
    expect(scoreBaccaratHand([{ numValue: 3 }, { numValue: 4 }])).toBe(7);
    expect(scoreBaccaratHand([{ numValue: 9 }, { numValue: 9 }, { numValue: 9 }])).toBe(7); // 27 -> 7
  });
});

describe('dealBaccaratRound (real card-drawing rules)', () => {
  it('always produces a valid result and legal hand sizes over many rounds', () => {
    for (let i = 0; i < 200; i++) {
      const { pHand, bHand, result } = dealBaccaratRound();
      expect(['PLAYER', 'BANKER', 'TIE']).toContain(result);
      expect(pHand.length === 2 || pHand.length === 3).toBe(true);
      expect(bHand.length === 2 || bHand.length === 3).toBe(true);

      const pScore = scoreBaccaratHand(pHand);
      const bScore = scoreBaccaratHand(bHand);
      if (pScore > bScore) expect(result).toBe('PLAYER');
      else if (bScore > pScore) expect(result).toBe('BANKER');
      else expect(result).toBe('TIE');
    }
  });

  it('never draws a third card for either hand when either starting hand is a natural (8 or 9)', () => {
    // Run many rounds and check the invariant whenever a natural occurs.
    let checkedANatural = false;
    for (let i = 0; i < 500; i++) {
      const { pHand, bHand } = dealBaccaratRound();
      const initialP = scoreBaccaratHand(pHand.slice(0, 2));
      const initialB = scoreBaccaratHand(bHand.slice(0, 2));
      if (initialP >= 8 || initialB >= 8) {
        checkedANatural = true;
        expect(pHand.length).toBe(2);
        expect(bHand.length).toBe(2);
      }
    }
    expect(checkedANatural).toBe(true); // sanity check the test actually exercised this branch
  });
});
