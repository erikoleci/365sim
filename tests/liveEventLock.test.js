import { describe, it, expect } from 'vitest';
import { isLiveEventLocked } from '../server/betValidation.js';

const NOW = 1_000_000_000_000;
const live = { status: 'LIVE', live_status: '2H' };
const opts = { now: NOW, lockMs: 30000 };

describe('isLiveEventLocked', () => {
  it('locks a live match for the window after a goal / red card', () => {
    expect(isLiveEventLocked(live, NOW - 5000, opts)).toBe(true);
    expect(isLiveEventLocked(live, NOW - 29999, opts)).toBe(true);
  });
  it('opens again once the window has passed', () => {
    expect(isLiveEventLocked(live, NOW - 30000, opts)).toBe(false);
    expect(isLiveEventLocked(live, NOW - 120000, opts)).toBe(false);
  });
  it('never locks a match with no goal/red-card event, or a pre-match one', () => {
    expect(isLiveEventLocked(live, null, opts)).toBe(false);
    expect(isLiveEventLocked({ status: 'UPCOMING', live_status: null }, NOW - 1000, opts)).toBe(false);
  });
  it('is off when lockMs is 0 or unset', () => {
    expect(isLiveEventLocked(live, NOW - 1000, { now: NOW, lockMs: 0 })).toBe(false);
    expect(isLiveEventLocked(live, NOW - 1000, { now: NOW })).toBe(false);
  });
  it('works for a match the feed marks live even if status lags', () => {
    expect(isLiveEventLocked({ status: 'UPCOMING', live_status: '1H' }, NOW - 1000, opts)).toBe(true);
  });
  it('ignores an event time in the future or garbage', () => {
    expect(isLiveEventLocked(live, NOW + 5000, opts)).toBe(false);
    expect(isLiveEventLocked(live, 'abc', opts)).toBe(false);
  });
});
