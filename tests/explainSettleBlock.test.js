import { describe, it, expect } from 'vitest';
import { explainSettleBlock, canSettleFromLiveScore } from '../server/matchSettlement.js';

const NOW = Date.parse('2026-10-24T15:30:00Z');
const min = (n) => new Date(NOW - n * 60000).toISOString();
const row = (o = {}) => ({ live_home_score: 2, live_away_score: 1, live_minute: '93:10', start_time: min(110), settled_at: null, ...o });

describe('explainSettleBlock (why a finished match is still open)', () => {
  it('says so when the result is reliable and the next sweep will settle it', () => {
    expect(canSettleFromLiveScore(row(), NOW)).toBe(true);
    expect(explainSettleBlock(row(), NOW)).toMatch(/^ready: .*2-1/);
  });
  it('a stored score with NO clock is not trusted (the case that left tickets open until the 24h refund)', () => {
    const r = row({ live_minute: null });
    expect(canSettleFromLiveScore(r, NOW)).toBe(false);
    expect(explainSettleBlock(r, NOW)).toMatch(/score is stored \(2-1\) but no match clock was ever stored.*by hand/);
  });
  it('no score at all', () => {
    expect(explainSettleBlock(row({ live_home_score: null, live_away_score: null }), NOW)).toMatch(/no score was ever stored/);
  });
  it('a clock still short of the end and too soon after kickoff: states both numbers', () => {
    const r = row({ live_minute: '85:00', start_time: min(97) });
    expect(canSettleFromLiveScore(r, NOW)).toBe(false);
    const why = explainSettleBlock(r, NOW);
    expect(why).toMatch(/not over by our rules yet/);
    expect(why).toMatch(/85:00/);
    expect(why).toMatch(/97 min since kickoff/);
  });
  it('already settled / unknown match', () => {
    expect(explainSettleBlock(row({ settled_at: 1 }), NOW)).toBe('already settled');
    expect(explainSettleBlock(null, NOW)).toBe('match not found');
  });
  it('every explanation agrees with canSettleFromLiveScore (never says "ready" when it would not settle)', () => {
    for (const r of [row(), row({ live_minute: null }), row({ live_minute: '60:00', start_time: min(70) }), row({ live_minute: '60:00', start_time: min(130) })]) {
      expect(explainSettleBlock(r, NOW).startsWith('ready')).toBe(canSettleFromLiveScore(r, NOW));
    }
  });
});
