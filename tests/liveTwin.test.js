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

import { pickLiveTwin as pickFinishedTwin } from '../server/matchSettlement.js';
describe('finished twin of a leg that points at the pre-match record', () => {
  it('matches when only one club is spelled the same at the same kick-off', () => {
    const leg = { match_id: 'l365-1', match_home: 'AD Pasto', match_away: 'Jaguares de Cordoba', start_time: '2026-11-03T23:20:00Z', bet_created_at: Date.parse('2026-11-03T22:19:00Z') };
    const twin = { id: 'l365-2', home_team: 'Deportivo Pasto FC', away_team: 'Jaguares de Cordoba', start_time: '2026-11-03T23:20:00Z', status: 'FINISHED', result_home: 2, result_away: 3 };
    expect(pickFinishedTwin(leg, [twin], Date.parse('2026-11-04T05:00:00Z'))).toBe('l365-2');
  });
  it('does not match a different fixture at the same time', () => {
    const leg = { match_id: 'l365-1', match_home: 'AD Pasto', match_away: 'Jaguares de Cordoba', start_time: '2026-11-03T23:20:00Z', bet_created_at: 0 };
    const other = { id: 'l365-9', home_team: 'Millonarios', away_team: 'Santa Fe', start_time: '2026-11-03T23:20:00Z', status: 'FINISHED', result_home: 1, result_away: 0 };
    expect(pickFinishedTwin(leg, [other], Date.parse('2026-11-04T05:00:00Z'))).toBeNull();
  });
});
