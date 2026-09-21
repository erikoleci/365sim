import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isTrackedGame, trackGame, noteMatchStatus, hasKnownLiveMatches, applyTrackerSnapshot,
  retainLiveKnown, getLiveRow, setLiveRow, isTrackerLoaded, __resetLiveTrackerForTests,
} from '../server/liveTracker.js';

beforeEach(() => { __resetLiveTrackerForTests(); vi.useRealTimers(); });

describe('liveTracker - fail-open before it has been loaded', () => {
  it('treats every game as tracked and possibly live until a snapshot is applied', () => {
    expect(isTrackerLoaded()).toBe(false);
    expect(isTrackedGame('l365-123')).toBe(true);
    expect(isTrackedGame('999')).toBe(true);
    expect(hasKnownLiveMatches()).toBe(true);
  });
});

describe('liveTracker - after a snapshot', () => {
  it('only tracks ids that exist, accepting both "l365-<id>" and bare ids', () => {
    applyTrackerSnapshot([{ id: 'l365-1', status: 'UPCOMING' }, { id: 'l365-2', status: 'LIVE' }], Date.now());
    expect(isTrackedGame('l365-1')).toBe(true);
    expect(isTrackedGame('2')).toBe(true);
    expect(isTrackedGame('3')).toBe(false);
  });

  it('knows whether anything is live, and goes idle once nothing is', () => {
    applyTrackerSnapshot([{ id: 'l365-1', status: 'UPCOMING' }], Date.now());
    expect(hasKnownLiveMatches()).toBe(false);
    noteMatchStatus('l365-1', 'LIVE');
    expect(hasKnownLiveMatches()).toBe(true);
    noteMatchStatus('l365-1', 'FINISHED');
    expect(hasKnownLiveMatches()).toBe(false);
  });

  it('a game upserted AFTER the snapshot query began survives the snapshot (race-safe)', async () => {
    const startedAt = Date.now();
    await new Promise((r) => setTimeout(r, 5));
    trackGame('l365-77');
    noteMatchStatus('l365-77', 'LIVE');
    applyTrackerSnapshot([], startedAt); // snapshot did not see it
    expect(isTrackedGame('77')).toBe(true);
    expect(hasKnownLiveMatches()).toBe(true);
  });

  it('a purged row (older than the snapshot, absent from it) is dropped', () => {
    trackGame('l365-5');
    const startedAt = Date.now() + 5;
    applyTrackerSnapshot([], startedAt);
    expect(isTrackedGame('5')).toBe(false);
  });

  it('retainLiveKnown drops ids the DB no longer lists as LIVE', () => {
    applyTrackerSnapshot([{ id: 'l365-1', status: 'LIVE' }, { id: 'l365-2', status: 'LIVE' }], Date.now());
    retainLiveKnown(['l365-1'], Date.now() + 5);
    noteMatchStatus('l365-1', 'FINISHED');
    expect(hasKnownLiveMatches()).toBe(false);
  });
});

describe('liveTracker - live row cache', () => {
  it('returns a copy of what was stored, and expires after the TTL', () => {
    vi.useFakeTimers();
    setLiveRow('l365-9', { home_team: 'A', away_team: 'B', live_home_score: 1, live_away_score: 0, live_minute: '10' });
    const r = getLiveRow('9');
    expect(r).toEqual({ home_team: 'A', away_team: 'B', live_home_score: 1, live_away_score: 0, live_minute: '10' });
    r.live_home_score = 99; // mutating the copy must not touch the cache
    expect(getLiveRow('l365-9').live_home_score).toBe(1);
    vi.advanceTimersByTime(21000);
    expect(getLiveRow('l365-9')).toBeNull();
  });
});
