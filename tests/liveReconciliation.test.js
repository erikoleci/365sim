import { describe, it, expect } from 'vitest';
import { shouldSettleMissingLiveMatch } from '../server/london365.js';

const NOW = Date.parse('2026-09-15T18:00:00Z');

describe('shouldSettleMissingLiveMatch - fast reconciliation after a server restart', () => {
  it('does NOT settle on a single miss with fresh fetched_at and recent kickoff (avoids acting on one transient feed gap)', () => {
    const result = shouldSettleMissingLiveMatch({
      consecutiveMisses: 1,
      fetchedAt: NOW - 10 * 1000,
      startTime: new Date(NOW - 30 * 60 * 1000).toISOString(),
      now: NOW,
    });
    expect(result).toBe(false);
  });

  it('settles on the 2nd consecutive miss even with fresh fetched_at - this is what makes it fast right after boot', () => {
    const result = shouldSettleMissingLiveMatch({
      consecutiveMisses: 2,
      fetchedAt: NOW - 10 * 1000,
      startTime: new Date(NOW - 30 * 60 * 1000).toISOString(),
      now: NOW,
    });
    expect(result).toBe(true);
  });

  it('settles once fetched_at is stale (8+ minutes), even on the very first miss', () => {
    const result = shouldSettleMissingLiveMatch({
      consecutiveMisses: 1,
      fetchedAt: NOW - 9 * 60 * 1000,
      startTime: new Date(NOW - 30 * 60 * 1000).toISOString(),
      now: NOW,
    });
    expect(result).toBe(true);
  });

  it('settles once kickoff was 2.5+ hours ago, regardless of misses/fetchedAt (final safety net)', () => {
    const result = shouldSettleMissingLiveMatch({
      consecutiveMisses: 1,
      fetchedAt: NOW - 1000,
      startTime: new Date(NOW - 3 * 60 * 60 * 1000).toISOString(),
      now: NOW,
    });
    expect(result).toBe(true);
  });

  it('the exact restart scenario: match finished 3 minutes before a brief restart, fetched_at still looks recent', () => {
    const fetchedAt = NOW - 4 * 60 * 1000;
    const startTime = new Date(NOW - 50 * 60 * 1000).toISOString();
    expect(shouldSettleMissingLiveMatch({ consecutiveMisses: 1, fetchedAt, startTime, now: NOW })).toBe(false);
    expect(shouldSettleMissingLiveMatch({ consecutiveMisses: 2, fetchedAt, startTime, now: NOW })).toBe(true);
  });
});
