import { describe, it, expect } from 'vitest';
import {
  socketLooksDead, needsFullResync, hasLiveMatches, anyLiveClockStale,
  SOCKET_SILENCE_MS, BACKGROUND_RESYNC_MS,
} from '../utils/resumeSync.ts';

const NOW = 1_800_000_000_000;
const live = (over = {}) => ({ status: 'LIVE', currentMinute: '60:00', currentMinuteUpdatedAt: NOW - 10_000, ...over });

describe('socketLooksDead', () => {
  it('closed / missing socket is dead, open + recent traffic is alive', () => {
    expect(socketLooksDead(undefined, NOW, NOW, true)).toBe(true);
    expect(socketLooksDead(3, NOW, NOW, true)).toBe(true);
    expect(socketLooksDead(1, NOW - 5_000, NOW, true)).toBe(false);
  });
  it('an open socket that stayed silent while matches are live is dead; silence with no live match is normal', () => {
    expect(socketLooksDead(1, NOW - SOCKET_SILENCE_MS - 1, NOW, true)).toBe(true);
    expect(socketLooksDead(1, NOW - SOCKET_SILENCE_MS - 1, NOW, false)).toBe(false);
  });
});

describe('needsFullResync', () => {
  it('only after a real absence', () => {
    expect(needsFullResync(null, NOW)).toBe(false);
    expect(needsFullResync(NOW - 2_000, NOW)).toBe(false);
    expect(needsFullResync(NOW - BACKGROUND_RESYNC_MS, NOW)).toBe(true);
  });
});

describe('live clock watchdog', () => {
  it('sees a frozen clock but not a fresh one, halftime or a non-live match', () => {
    expect(hasLiveMatches([live()])).toBe(true);
    expect(anyLiveClockStale([live()], NOW)).toBe(false);
    expect(anyLiveClockStale([live({ currentMinuteUpdatedAt: NOW - 400_000 })], NOW)).toBe(true);
    expect(anyLiveClockStale([live({ currentMinuteUpdatedAt: NOW - 400_000, liveStatus: 'HT' })], NOW)).toBe(false);
    expect(anyLiveClockStale([live({ status: 'UPCOMING', currentMinuteUpdatedAt: NOW - 400_000 })], NOW)).toBe(false);
  });
});
