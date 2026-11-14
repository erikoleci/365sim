import { describe, it, expect } from 'vitest';
import { liveFairProbability, liveEdge, edgeTestApplies } from '../server/matchSettlement.js';

const leg = (sel) => ({ market_id: 'x_m1', market_name: 'Rezultat Final', selection_id: sel, selection_name: sel, match_home: 'A', match_away: 'B' });

describe('live price gate: the "too generous" test is not applied while the score is level in the first half', () => {
  it('0-0 at minute 30: "1" at 3.2 is over the model edge limit, but the test does not apply (a weak home team is a real 3.2)', () => {
    const f = liveFairProbability(leg('1'), { h: 0, a: 0 }, 30);
    expect(liveEdge(3.2, f)).toBeGreaterThan(1.25); // the old gate refused this price
    expect(edgeTestApplies({ h: 0, a: 0 }, 30)).toBe(false);
    expect(edgeTestApplies({ h: 1, a: 1 }, 44)).toBe(false);
  });
  it('still applies after a goal (stale price), in the second half and with no minute', () => {
    expect(edgeTestApplies({ h: 1, a: 0 }, 30)).toBe(true);
    expect(edgeTestApplies({ h: 0, a: 0 }, 60)).toBe(true);
    expect(edgeTestApplies({ h: 0, a: 0 }, 46)).toBe(true);
    expect(edgeTestApplies({ h: 0, a: 0 }, NaN)).toBe(true);
  });
  it('a leading team at 1.2 is still caught by the probability limit and the edge test', () => {
    const f = liveFairProbability(leg('1'), { h: 3, a: 0 }, 80);
    expect(f.pWin).toBeGreaterThan(0.93);
  });
});
