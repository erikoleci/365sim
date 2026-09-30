import { describe, it, expect } from 'vitest';
import { shouldAcceptNewClockBase, projectClock } from '../components/MatchCard.tsx';

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

describe('projectClock - server-side reference timestamp resync (source_time + received_at)', () => {
  it('reconstructs the correct elapsed time from a server-side reference: source 41:23 at T, asked at T+7s -> 41:30', () => {
    const receivedAt = 1_000_000;
    const totalSecondsAtReceivedAt = 41 * 60 + 23;
    const result = projectClock(totalSecondsAtReceivedAt, receivedAt, receivedAt + 7000);
    expect(result.minute).toBe(41);
    expect(result.second).toBe(30);
  });

  it('a poll interval gap (e.g. 25s since the source last confirmed the minute) is correctly caught up, not shown stale', () => {
    // This is exactly the "Match Detail opens with a stale value and then
    // catches up" bug: if the reference is the REAL server timestamp (not
    // the moment this client happened to fetch), the very first read is
    // already correct.
    const receivedAt = 2_000_000;
    const totalSecondsAtReceivedAt = 10 * 60; // source said "10:00" at receivedAt
    const askedAt = receivedAt + 25_000; // client asks 25s later
    const result = projectClock(totalSecondsAtReceivedAt, receivedAt, askedAt);
    expect(result.minute).toBe(10);
    expect(result.second).toBe(25);
  });

  it('rolls over minutes correctly (59s -> next minute, 0s)', () => {
    const receivedAt = 0;
    const result = projectClock(22 * 60 + 59, receivedAt, receivedAt + 1000);
    expect(result.minute).toBe(23);
    expect(result.second).toBe(0);
  });

  it('never goes backward for a zero/negative gap (clock skew safety)', () => {
    const receivedAt = 5000;
    const result = projectClock(30 * 60, receivedAt, receivedAt - 500); // "now" before receivedAt
    expect(result.minute).toBe(30);
    expect(result.second).toBe(0); // elapsed clamped to 0, not negative
  });
});
