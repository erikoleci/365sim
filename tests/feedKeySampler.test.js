import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sampleFeedKeys, getFeedKeySamples, __resetFeedKeysForTests } from '../server/feedKeySampler.js';

describe('feed key sampler', () => {
  beforeEach(() => { __resetFeedKeysForTests(); vi.spyOn(console, 'log').mockImplementation(() => {}); });

  it('records every scalar field with samples and logs each new field once', () => {
    sampleFeedKeys('socket', { SC: '1-0', T: 100, PLAYER: 'Haaland' });
    sampleFeedKeys('socket', { SC: '2-0', T: 101 });
    const f = Object.fromEntries(getFeedKeySamples().map((e) => [e.key, e]));
    expect(Object.keys(f).sort()).toEqual(['PLAYER', 'SC', 'T']);
    expect(f.SC.count).toBe(2);
    expect(f.SC.samples).toEqual(['1-0', '2-0']);
    expect(console.log).toHaveBeenCalledTimes(3); // PLAYER, SC, T once each
  });
  it('keeps sources apart and skips nested values', () => {
    sampleFeedKeys('rest', { id: 1, nested: { a: 1 }, list: [1, 2] });
    sampleFeedKeys('socket', { id: 9 });
    expect(getFeedKeySamples().map((e) => e.source + ':' + e.key)).toEqual(['rest:id', 'socket:id']);
  });
  it('bounds samples per field and truncates long values', () => {
    for (let i = 0; i < 20; i++) sampleFeedKeys('s', { k: 'v' + i + 'x'.repeat(100) });
    const e = getFeedKeySamples()[0];
    expect(e.samples.length).toBe(4);
    expect(e.samples[0].length).toBeLessThanOrEqual(60);
  });
  it('ignores non-objects', () => {
    sampleFeedKeys('s', null); sampleFeedKeys('s', 'text'); sampleFeedKeys('s', [1, 2]);
    expect(getFeedKeySamples()).toEqual([]);
  });
});
