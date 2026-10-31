import { describe, it, expect } from 'vitest';
import { keepNewerLive } from '../utils/liveMerge';

const live = (id, minute, at, extra = {}) => ({ id, status: 'LIVE', currentMinute: minute, currentMinuteUpdatedAt: at, liveHomeScore: 0, liveAwayScore: 0, ...extra });

describe('keepNewerLive', () => {
  it('an older list does not move the minute or score backwards', () => {
    const out = keepNewerLive([live('a', '60', 2000, { liveHomeScore: 1 })], [live('a', '58', 1000)]);
    expect(out[0].currentMinute).toBe('60');
    expect(out[0].liveHomeScore).toBe(1);
  });
  it('a newer list wins', () => {
    expect(keepNewerLive([live('a', '58', 1000)], [live('a', '60', 2000)])[0].currentMinute).toBe('60');
  });
  it('new matches and non-live matches pass through', () => {
    const up = { id: 'u', status: 'UPCOMING' };
    expect(keepNewerLive([], [up])).toEqual([up]);
    expect(keepNewerLive([live('a', '60', 2000)], [{ id: 'a', status: 'FINISHED' }])[0].status).toBe('FINISHED');
  });
});
