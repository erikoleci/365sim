import { describe, it, expect } from 'vitest';
import { GAMES, getGame, spinReels, multiplierFor, payoutFor, exactRtp, describeGame } from '../server/slots.js';

const fruit = GAMES.fruit;

describe('slots: fruit game maths', () => {
  it('has the same number of stops on the strip as it advertises (32)', () => {
    expect(Object.values(fruit.strip).reduce((a, b) => a + b, 0)).toBe(32);
  });

  it('pins the exact RTP (~95.84%) and hit frequency (~8.5%) by full enumeration', () => {
    const { rtp, hitFrequency } = exactRtp(fruit);
    expect(rtp * 100).toBeCloseTo(95.84, 1);
    expect(hitFrequency * 100).toBeCloseTo(8.5, 1);
  });

  it('keeps the house edge positive but small (RTP between 90% and 99%)', () => {
    const { rtp } = exactRtp(fruit);
    expect(rtp).toBeGreaterThan(0.9);
    expect(rtp).toBeLessThan(0.99);
  });

  it('describeGame publishes the real RTP and the paytable', () => {
    const d = describeGame(fruit);
    expect(d.rtp).toBeCloseTo(95.84, 1);
    expect(d.maxMultiplier).toBe(300);
    expect(d.paytable['7️⃣']).toBe(300);
  });
});

describe('slots: paytable', () => {
  it('pays three of a kind', () => {
    expect(multiplierFor(fruit, ['7️⃣', '7️⃣', '7️⃣'])).toBe(300);
    expect(multiplierFor(fruit, ['🍒', '🍒', '🍒'])).toBe(8);
    expect(multiplierFor(fruit, ['🍋', '🍋', '🍋'])).toBe(12);
  });

  it('pays two cherries on the first two reels, whatever the third', () => {
    expect(multiplierFor(fruit, ['🍒', '🍒', '🍋'])).toBe(2);
    expect(multiplierFor(fruit, ['🍒', '🍋', '🍒'])).toBe(0);
    expect(multiplierFor(fruit, ['🍋', '🍒', '🍒'])).toBe(0);
  });

  it('pays nothing for a mixed result', () => {
    expect(multiplierFor(fruit, ['🍋', '🍇', '🔔'])).toBe(0);
    expect(multiplierFor(fruit, ['💎', '💎', '🔔'])).toBe(0);
  });

  it('rounds payouts to 2 decimals', () => {
    expect(payoutFor(10, 12)).toBe(120);
    expect(payoutFor(0.33, 8)).toBe(2.64);
    expect(payoutFor(1.15, 2)).toBe(2.3);
  });
});

describe('slots: the spin is a plain uniform draw (no rigging)', () => {
  it('uses the injected RNG once per reel and maps it onto the strip', () => {
    const calls = [];
    const reels = spinReels(fruit, (n) => { calls.push(n); return 0; });
    expect(calls).toEqual([32, 32, 32]);
    expect(reels).toEqual(['🍒', '🍒', '🍒']); // stop 0 of the strip is a cherry
  });

  it('can reach every symbol on every reel (last stop is the seven)', () => {
    const reels = spinReels(fruit, (n) => n - 1);
    expect(reels).toEqual(['7️⃣', '7️⃣', '7️⃣']);
  });

  it('observed return over 400k real spins is close to the exact RTP', () => {
    let paid = 0;
    const N = 400000;
    for (let i = 0; i < N; i++) paid += multiplierFor(fruit, spinReels(fruit));
    const observed = paid / N;
    // Standard deviation of one spin is ~9x stake (the 300x seven), so 400k spins => ~1.4% sigma.
    expect(Math.abs(observed - exactRtp(fruit).rtp)).toBeLessThan(0.07);
  });

  it('knows its games', () => {
    expect(getGame()?.id).toBe('fruit');
    expect(getGame('fruit')?.id).toBe('fruit');
    expect(getGame('nope')).toBeNull();
  });
});
