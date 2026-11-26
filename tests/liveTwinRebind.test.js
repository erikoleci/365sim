import { describe, it, expect } from 'vitest';
import { pickLiveTwin } from '../server/matchSettlement.js';

const now = Date.parse('2026-11-02T08:00:00Z');
const twin = { id: 'l365-2', home_team: 'Supra du Quebec', away_team: 'Cavalry FC', start_time: '2026-11-01T21:00:00.000Z', status: 'FINISHED', result_home: 2, result_away: 1 };
const leg = { match_id: 'l365-1', match_home: 'FC Supra Du Quebec', match_away: 'Cavalry FC', start_time: '2026-11-01T21:00:00.000Z', bet_created_at: Date.parse('2026-11-01T20:39:00Z') };

describe('pickLiveTwin', () => {
  it('finds the finished record of the same fixture', () => {
    expect(pickLiveTwin(leg, [twin], now)).toBe('l365-2');
  });
  it('works when the leg match row is gone (uses the bet time)', () => {
    expect(pickLiveTwin({ ...leg, start_time: null }, [twin], now)).toBe('l365-2');
  });
  it('ignores other fixtures, unfinished twins and itself', () => {
    expect(pickLiveTwin(leg, [{ ...twin, away_team: 'Pacific FC' }], now)).toBeNull();
    expect(pickLiveTwin(leg, [{ ...twin, status: 'LIVE' }], now)).toBeNull();
    expect(pickLiveTwin(leg, [{ ...twin, id: 'l365-1' }], now)).toBeNull();
  });
  it('does not touch a fixture that is not over yet', () => {
    expect(pickLiveTwin(leg, [twin], Date.parse('2026-11-01T22:00:00Z'))).toBeNull();
  });
  it('does not pick a twin with a very different kickoff', () => {
    expect(pickLiveTwin(leg, [{ ...twin, start_time: '2026-11-02T18:00:00.000Z' }], now)).toBeNull();
  });
});

import { twinCandidatesWithMoreData } from '../server/matchSettlement.js';
describe('legs on a finished pre-match record without the live data', () => {
  const nowT = Date.parse('2026-11-26T08:00:00Z');
  const leg = { match_id: 'l365-5281947', match_home: 'Inter Milano', match_away: 'VfB Stuttgart', start_time: '2026-11-25T20:00:00.000Z', bet_created_at: Date.parse('2026-11-25T20:58:00Z'), ev_count: 2, ht_home: 0 };
  const live = { id: 'l365-5342704', home_team: 'Inter Milan', away_team: 'VfB Stuttgart', start_time: '2026-11-25T20:00:00.000Z', status: 'FINISHED', result_home: 2, result_away: 0, ev_count: 25, ht_home: 0 };
  it('offers only records that hold more event rows', () => {
    expect(twinCandidatesWithMoreData(leg, [live, { ...live, id: 'x', ev_count: 1 }, { ...live, id: leg.match_id }]).map((c) => c.id)).toEqual(['l365-5342704']);
  });
  it('offers a record with a half-time score when the leg record has none', () => {
    expect(twinCandidatesWithMoreData({ ...leg, ev_count: 0, ht_home: null }, [{ ...live, ev_count: 0 }]).length).toBe(1);
    expect(twinCandidatesWithMoreData({ ...leg, ev_count: 0, ht_home: 0 }, [{ ...live, ev_count: 0 }]).length).toBe(0);
  });
  it('moves the leg to the live record and never to another fixture', () => {
    expect(pickLiveTwin(leg, twinCandidatesWithMoreData(leg, [live]), nowT)).toBe('l365-5342704');
    const other = { ...live, id: 'o', home_team: 'Juventus', away_team: 'Benfica' };
    expect(pickLiveTwin(leg, twinCandidatesWithMoreData(leg, [other]), nowT)).toBeNull();
  });
});
