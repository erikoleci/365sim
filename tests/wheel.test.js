import { describe, it, expect } from 'vitest';
import { WHEEL_SEGMENTS, wheelRtp, wheelSpin } from '../server/wheel.js';
import { CASINO_GAME_KEYS } from '../server/casinoAccess.js';

describe('wheel of fortune', () => {
  it('has 24 equal segments and a house edge (RTP below 100%, above 90%)', () => {
    expect(WHEEL_SEGMENTS).toHaveLength(24);
    expect(wheelRtp()).toBeGreaterThan(0.9);
    expect(wheelRtp()).toBeLessThan(1);
  });
  it('pays the multiplier of the drawn segment', () => {
    for (let i = 0; i < 24; i += 1) expect(wheelSpin(() => i)).toEqual({ index: i, multiplier: WHEEL_SEGMENTS[i] });
  });
  it('can be switched off like every other game', () => {
    expect(CASINO_GAME_KEYS).toContain('wheel');
  });
});
