import { describe, it, expect } from 'vitest';
import { getBetBlockReason } from '../server/marketRules.js';

const market = { id: 'x', name: 'Shenon Pritesi ne P1/P2' };
const po = { id: 'Po', name: 'Po' };
const live = (h, a) => ({
  id: '1', start_time: new Date(Date.now() - 30 * 60000).toISOString(), status: 'LIVE', live_status: '1H',
  live_home_score: h, live_away_score: a, live_minute: "30'", home_team: 'A', away_team: 'B',
});

describe('"Shenon Pritesi ne P1/P2" is offered in play only at 0-0', () => {
  it('is open at 0-0', () => expect(getBetBlockReason(live(0, 0), market, po)).toBeNull());
  it('is closed once either side has scored', () => {
    expect(getBetBlockReason(live(1, 0), market, po)).toBe('ONLY_AT_0_0');
    expect(getBetBlockReason(live(0, 1), market, po)).toBe('ONLY_AT_0_0');
  });
  it('is closed when the live score is unknown', () => expect(getBetBlockReason(live(null, null), market, po)).toBe('ONLY_AT_0_0'));
  it('is open before kick-off', () => {
    const pre = { ...live(null, null), start_time: new Date(Date.now() + 3600000).toISOString(), status: 'UPCOMING', live_status: null };
    expect(getBetBlockReason(pre, market, po)).toBeNull();
  });
});
