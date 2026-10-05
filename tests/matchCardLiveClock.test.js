import { describe, it, expect } from 'vitest';
import { parseLiveClock } from '../components/MatchCard.tsx';

// Same production bug as normalizeLiveMinute (server/london365.js), fixed
// here too since /api/matches serves matches_cache.live_minute as-is (not
// re-normalized) -- a stale pre-fix DB value must still render sanely.
describe('parseLiveClock - rejects nonsense sentinel values', () => {
  it('discards a bare integer still over 130 minutes once read as seconds (was "5015:24 Penallti")', () => {
    expect(parseLiveClock('300924')).toBeNull();
  });
  it('still parses a real seconds-based clock normally', () => {
    expect(parseLiveClock('1776')).toEqual({ minute: 29, second: 36, half: 'Pjesa I' });
  });
  it('a normal mm:ss value in the second half parses correctly (the Ukraine/Hungary case: 50:16)', () => {
    expect(parseLiveClock('50:16')).toEqual({ minute: 50, second: 16, half: 'Pjesa II' });
  });
});
