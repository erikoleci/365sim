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
