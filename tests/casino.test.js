import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  validateStake,
  calcBjScore,
  buildShuffledDeck,
  resolveBlackjackResult,
  scoreBaccaratHand,
  dealBaccaratRound,
  PAYOUT,
  evaluatePokerHand,
  VP_PAYS,
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

describe('resolveBlackjackResult (fair payouts)', () => {
  const stake = 100;

  it('a LOSS pays 0', () => {
    expect(resolveBlackjackResult(stake, { kind: 'LOSS', message: 'DEALER WINS' }).payout).toBe(0);
  });

  it('a PUSH returns exactly the stake', () => {
    expect(resolveBlackjackResult(stake, { kind: 'PUSH', message: 'PUSH' }).payout).toBe(stake);
  });

  it('a WIN always pays 2x the stake (no gate)', () => {
    for (const r of [0, 0.5, 0.99]) {
      vi.spyOn(Math, 'random').mockReturnValue(r);
      const outcome = resolveBlackjackResult(stake, { kind: 'WIN', message: 'YOU WIN' });
      expect(outcome.payout).toBe(stake * PAYOUT.WIN);
      expect(outcome.message).toBe('YOU WIN');
    }
  });

  it('a natural BLACKJACK pays 3:2', () => {
    expect(resolveBlackjackResult(stake, { kind: 'WIN', message: 'BLACKJACK' }).payout).toBe(250);
  });
});

describe('evaluatePokerHand (Jacks or Better)', () => {
  const h = (...c) => c.map(([value, suit]) => ({ value, suit }));
  it('recognises the pay tiers', () => {
    expect(evaluatePokerHand(h(['10', '♠'], ['J', '♠'], ['Q', '♠'], ['K', '♠'], ['A', '♠']))).toBe('ROYAL FLUSH');
    expect(evaluatePokerHand(h(['5', '♥'], ['6', '♥'], ['7', '♥'], ['8', '♥'], ['9', '♥']))).toBe('STRAIGHT FLUSH');
    expect(evaluatePokerHand(h(['9', '♠'], ['9', '♥'], ['9', '♦'], ['9', '♣'], ['2', '♠']))).toBe('4 OF A KIND');
    expect(evaluatePokerHand(h(['9', '♠'], ['9', '♥'], ['9', '♦'], ['2', '♣'], ['2', '♠']))).toBe('FULL HOUSE');
    expect(evaluatePokerHand(h(['A', '♠'], ['2', '♥'], ['3', '♦'], ['4', '♣'], ['5', '♠']))).toBe('STRAIGHT');
    expect(evaluatePokerHand(h(['J', '♠'], ['J', '♥'], ['3', '♦'], ['4', '♣'], ['6', '♠']))).toBe('JACKS OR BETTER');
    expect(evaluatePokerHand(h(['10', '♠'], ['10', '♥'], ['3', '♦'], ['4', '♣'], ['6', '♠']))).toBe(null);
    expect(VP_PAYS['JACKS OR BETTER']).toBe(1);
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
