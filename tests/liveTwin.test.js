import { describe, it, expect } from 'vitest';
import { pickLiveTwin } from '../server/liveTwin.js';

const row = (id, home, away, extra = {}) => ({ id, home_team: home, away_team: away, start_time: '2026-11-03T23:20:00Z', live_home_score: null, live_away_score: null, live_minute: null, ...extra });

describe('pickLiveTwin', () => {
  it('finds the in-play record of the same fixture for a pre-match record without live data', () => {
    const pre = row('l365-1', 'AD Pasto', 'Jaguares de Cordoba');
    const live = row('l365-2', 'Deportivo Pasto FC', 'Jaguares de Cordoba', { live_home_score: 0, live_away_score: 0, live_minute: 85 });
    expect(pickLiveTwin(pre, [live])?.id).toBe('l365-2');
  });
  it('returns null when the record receives live data itself', () => {
    expect(pickLiveTwin(row('a', 'X', 'Y', { live_minute: 10 }), [row('b', 'X', 'Y', { live_minute: 10 })])).toBeNull();
  });
  it('ignores a different match and a different day', () => {
    const pre = row('l365-1', 'AD Pasto', 'Jaguares de Cordoba');
    const other = row('l365-3', 'Millonarios', 'Santa Fe', { live_minute: 40, live_home_score: 1, live_away_score: 0 });
    const nextWeek = row('l365-4', 'AD Pasto', 'Jaguares de Cordoba', { live_minute: 40, live_home_score: 1, live_away_score: 0, start_time: '2026-11-10T23:20:00Z' });
    expect(pickLiveTwin(pre, [other, nextWeek])).toBeNull();
  });
});
