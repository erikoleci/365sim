import { describe, it, expect } from 'vitest';
import { summarizeLiveHealth } from '../server/liveHealth.js';
import { createStatusSampler } from '../server/liveStatusSampler.js';

const NOW = 1_800_000_000_000;
const row = (o) => ({ id: 'l365-1', live_minute: '75:39', live_minute_updated_at: String(NOW - 5000), live_home_score: 1, live_away_score: 0, ...o });

describe('summarizeLiveHealth', () => {
  it('ok when live rows have fresh provider clocks', () => {
    const s = summarizeLiveHealth([row({}), row({ id: 'l365-2' })], NOW);
    expect(s).toMatchObject({ verdict: 'ok', liveRows: 2, withProviderClock: 2, withoutProviderClock: 0, withScore: 2, newestClockAgeSeconds: 5 });
  });
  it('counts rows without a clock and lists a sample (the ghosts)', () => {
    const s = summarizeLiveHealth([row({}), row({ id: 'ghost', live_minute: null, live_minute_updated_at: null, live_home_score: null, live_away_score: null })], NOW);
    expect(s.withoutProviderClock).toBe(1);
    expect(s.sampleWithoutClock).toEqual(['ghost']);
    expect(s.withScore).toBe(1);
  });
  it('says PROBLEM when matches are live but no clock exists, or the newest clock is old', () => {
    expect(summarizeLiveHealth([row({ live_minute: null, live_minute_updated_at: null })], NOW).verdict).toMatch(/PROBLEM/);
    expect(summarizeLiveHealth([row({ live_minute_updated_at: String(NOW - 10 * 60000) })], NOW).verdict).toMatch(/PROBLEM/);
    expect(summarizeLiveHealth([], NOW).verdict).toBe('no live matches');
  });
});

describe('createStatusSampler', () => {
  it('logs the first samples of each api_status once, distinct minutes only, then goes quiet', () => {
    const s = createStatusSampler(2);
    expect(s.note('3', '75:39', 'a')).toContain('api_status=3');
    expect(s.note('3', '75:50', 'b')).toContain('75:50');
    expect(s.note('3', '80:00', 'c')).toBeNull(); // limit reached
    expect(s.note('1', '12:04', 'd')).toContain('api_status=1');
    expect(s.note('1', '12:04', 'e')).toBeNull(); // same minute: nothing new
  });
  it('ignores a missing status', () => {
    const s = createStatusSampler();
    expect(s.note(null, '10', 'x')).toBeNull();
    expect(s.note('', '10', 'x')).toBeNull();
  });
});
