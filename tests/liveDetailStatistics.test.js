import { describe, it, expect } from 'vitest';
import { buildLiveStatistics } from '../server/liveDetail.js';
import { pickClockSource, formatScore } from '../utils/liveStatus.ts';

const NOW = 1_800_000_000_000;
const cache = (o = {}) => ({ status: 'LIVE', home_team: 'Chelsea', away_team: 'Bournemouth', live_minute: '75:39', live_minute_updated_at: String(NOW - 3000), live_home_score: 5, live_away_score: 1, ...o });
const stats = (o = {}) => ({ match_id: 'l365-5200421', minute: 72, home_score: 4, away_score: 1, possession_home: 61, cards_home: 1, updated_at: String(NOW - 10_000), ...o });

describe('buildLiveStatistics (GET /matches/:id/live-detail)', () => {
  it('the clock is the cache clock WITH its stamp - not the stats table minute with the cache stamp', () => {
    const s = buildLiveStatistics(stats(), cache(), NOW);
    expect(s.clock).toBe('75:39');
    expect(s.minute).toBe(75);
    expect(s.minuteUpdatedAt).toBe(NOW - 3000);
  });
  it('the score is the cache score, even when the stats table is behind (4-1 vs 5-1)', () => {
    const s = buildLiveStatistics(stats(), cache(), NOW);
    expect([s.home_score, s.away_score]).toEqual([5, 1]);
    expect(s.possession_home).toBe(61); // table-only counters are kept while fresh
  });
  it('a stale stats table drops only its counters; minute and score survive (it used to return null)', () => {
    const s = buildLiveStatistics(stats({ updated_at: String(NOW - 5 * 60_000) }), cache(), NOW);
    expect(s).not.toBeNull();
    expect(s.possession_home).toBeNull();
    expect(s.cards_home).toBeNull();
    expect([s.minute, s.clock, s.home_score, s.away_score]).toEqual([75, '75:39', 5, 1]);
  });
  it('no stats row at all still gives minute and score from the cache', () => {
    const s = buildLiveStatistics(null, cache(), NOW);
    expect([s.minute, s.clock, s.home_score, s.away_score]).toEqual([75, '75:39', 5, 1]);
  });
  it('an unstamped minute is a minute only: no clock/stamp, so the client cannot tick seconds from it', () => {
    const s = buildLiveStatistics(null, cache({ live_minute_updated_at: null }), NOW);
    expect(s.minute).toBe(75);
    expect(s.clock).toBeUndefined();
    expect(s.minuteUpdatedAt).toBeUndefined();
  });
  it('a real 0-0 from the cache stays 0-0; a missing cache score does not overwrite the stats score', () => {
    expect(buildLiveStatistics(null, cache({ live_home_score: 0, live_away_score: 0 }), NOW)).toMatchObject({ home_score: 0, away_score: 0 });
    const s = buildLiveStatistics(stats(), cache({ live_home_score: null, live_away_score: null }), NOW);
    expect([s.home_score, s.away_score]).toEqual([4, 1]);
  });
  it('without a cache row the old behaviour stays (fresh row returned, stale row null)', () => {
    expect(buildLiveStatistics(stats(), null, NOW)).toMatchObject({ minute: 72 });
    expect(buildLiveStatistics(null, null, NOW)).toBeNull();
  });
});

describe('detail view helpers', () => {
  it('a missing score is shown as a dash, never 0; a real 0 stays 0', () => {
    expect(formatScore(undefined)).toBe('–');
    expect(formatScore(null)).toBe('–');
    expect(formatScore(0)).toBe('0');
    expect(formatScore(5)).toBe('5');
  });
  it('clock source is always ONE coherent pair', () => {
    const match = { currentMinute: '75:39', currentMinuteUpdatedAt: 111, currentMinuteEstimated: false };
    expect(pickClockSource(match, { clock: '72:00', minuteUpdatedAt: 5 })).toEqual({ raw: '75:39', stamp: 111, estimated: false });
    expect(pickClockSource({}, { clock: '72:10', minuteUpdatedAt: 5 })).toEqual({ raw: '72:10', stamp: 5, estimated: false });
    expect(pickClockSource({}, { minute: 72 })).toEqual({ raw: '72', stamp: undefined, estimated: false });
    expect(pickClockSource({ currentMinute: '40', currentMinuteEstimated: true }, null)).toEqual({ raw: '40', stamp: undefined, estimated: true });
  });
});
