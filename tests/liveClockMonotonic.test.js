import { describe, it, expect } from 'vitest';
import { shouldAcceptNewClockBase } from '../components/MatchCard.tsx';

describe('shouldAcceptNewClockBase - the live clock must never visibly rewind', () => {
  it('always accepts the first value (no current base yet)', () => {
    expect(shouldAcceptNewClockBase(null, 12 * 60, 1000)).toBe(true);
  });

  it('accepts an incoming value that is ahead of the projected current time', () => {
    const current = { totalSeconds: 10 * 60, receivedAt: 0 };
    const now = 5000;
    expect(shouldAcceptNewClockBase(current, 15 * 60, now)).toBe(true);
  });

  it('rejects an incoming value that would rewind the clock (the exact reported bug)', () => {
    const current = { totalSeconds: 12 * 60 + 30, receivedAt: 0 };
    const now = 1000;
    expect(shouldAcceptNewClockBase(current, 9 * 60, now)).toBe(false);
  });

  it('accepts an incoming value equal to the current projected time', () => {
    const current = { totalSeconds: 10 * 60, receivedAt: 0 };
    const now = 3000;
    expect(shouldAcceptNewClockBase(current, 10 * 60 + 3, now)).toBe(true);
  });

  it('a legitimate half-time -> second-half transition (45 -> 46+) is an increase, always accepted', () => {
    const current = { totalSeconds: 45 * 60, receivedAt: 0 };
    const now = 0;
    expect(shouldAcceptNewClockBase(current, 46 * 60, now)).toBe(true);
  });
});
