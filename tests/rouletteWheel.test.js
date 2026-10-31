import { describe, it, expect } from 'vitest';
import { WHEEL_ORDER, POCKETS, SLOT_DEG, pocketIndex, pocketCenterDeg, pocketColor, landingBallAngle, easeOutCubic, polar } from '../utils/rouletteWheel.ts';

// distance between two angles on the circle (359.9999 and 0 are the same place)
const circ = (x) => { const m = ((x % 360) + 360) % 360; return Math.min(m, 360 - m); };

describe('roulette wheel geometry', () => {
  it('is the real European wheel: 37 pockets, every number once, 0 first', () => {
    expect(POCKETS).toBe(37);
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
    expect(WHEEL_ORDER[0]).toBe(0);
    expect(WHEEL_ORDER.slice(0, 4)).toEqual([0, 32, 15, 19]);
  });
  it('colours: 0 green, 1 red, 2 black, 36 red', () => {
    expect([0, 1, 2, 36].map(pocketColor)).toEqual(['green', 'red', 'black', 'red']);
  });
  it('the pocket centre is the middle of its slot', () => {
    expect(pocketCenterDeg(0)).toBeCloseTo(SLOT_DEG / 2);
    expect(pocketCenterDeg(pocketIndex(32))).toBeCloseTo(1.5 * SLOT_DEG);
  });
  it('polar: top is 0 degrees, right is 90', () => {
    expect(polar(100, 100, 10, 0)).toEqual({ x: 100, y: 90 });
    expect(polar(100, 100, 10, 90).x).toBeCloseTo(110);
  });
});

describe('landing: the ball ends in the pocket of the result', () => {
  it('for every number and any starting angle', () => {
    for (const n of WHEEL_ORDER) {
      for (const [ballFrom, wheelAtEnd] of [[0, 0], [1234.5, 77.7], [-500, 3000.2], [359.9, 12]]) {
        const idx = pocketIndex(n);
        const end = landingBallAngle(ballFrom, wheelAtEnd, idx);
        expect(circ(end - wheelAtEnd - pocketCenterDeg(idx))).toBeLessThan(1e-6);
        expect(end).toBeLessThanOrEqual(ballFrom - 720); // at least two real turns against the wheel
        expect(end).toBeGreaterThan(ballFrom - 720 - 360 * 4); // and not an endless spin
      }
    }
  });
  it('easeOutCubic runs 0 -> 1 and slows down', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5) - easeOutCubic(0.4)).toBeGreaterThan(easeOutCubic(1) - easeOutCubic(0.9));
  });
});
