import { describe, it, expect } from 'vitest';
import { extraMarketOutcome } from '../server/extraMarkets.js';

const leg = (sel) => ({ selection_name: sel, selection_id: sel });
const ctx = (h, a) => ({ homeScore: 1, awayScore: 0, stats: { penaltiesHome: h, penaltiesAway: a } });

describe('penalty during the match', () => {
  for (const name of ['a do te kete penallti gjate ndeshjes?', 'will there be a penalty']) {
    it(name + ': a logged penalty decides it', () => {
      expect(extraMarketOutcome(leg('Po'), name, ctx(1, 0))).toBe('WON');
      expect(extraMarketOutcome(leg('Jo'), name, ctx(0, 2))).toBe('LOST');
      expect(extraMarketOutcome(leg('Yes'), name, ctx(0, 1))).toBe('WON');
      expect(extraMarketOutcome(leg('No'), name, ctx(1, 1))).toBe('LOST');
    });
    it(name + ': no logged penalty is never assumed, stays pending', () => {
      expect(extraMarketOutcome(leg('Po'), name, ctx(0, 0))).toBeNull();
      expect(extraMarketOutcome(leg('Jo'), name, ctx(0, 0))).toBeNull();
      expect(extraMarketOutcome(leg('Jo'), name, { homeScore: 1, awayScore: 0 })).toBeNull();
    });
  }
  it('an unknown option stays pending', () => {
    expect(extraMarketOutcome(leg('X'), 'a do te kete penallti gjate ndeshjes?', ctx(1, 0))).toBeNull();
  });
});
