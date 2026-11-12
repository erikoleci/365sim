import { describe, it, expect } from 'vitest';
import { chronological } from '../server/routes/matches.js';

describe('chronological events', () => {
  it('puts a late-logged half-time substitution at minute 46, not among the 80th-minute events', () => {
    const list = [
      { minute: 19, half: 1, type: 'GOAL' },
      { minute: 81, half: 2, type: 'CORNER' },
      { minute: 84, half: 2, type: 'CORNER' },
      { minute: 46, half: 2, type: 'SUBSTITUTION' },
      { minute: 87, half: 2, type: 'GOAL' },
    ];
    expect(chronological(list).map((e) => e.minute)).toEqual([19, 46, 81, 84, 87]);
  });
  it('first-half stoppage time (46+) stays before the second half', () => {
    const list = [{ minute: 46, half: 2, type: 'SUBSTITUTION' }, { minute: 48, half: 1, type: 'CORNER' }];
    expect(chronological(list).map((e) => e.half)).toEqual([1, 2]);
  });
  it('keeps the order of equal minutes and of rows without a minute', () => {
    const list = [{ minute: 10, half: 1, type: 'A' }, { minute: null, type: 'B' }, { minute: 10, half: 1, type: 'C' }];
    expect(chronological(list).map((e) => e.type)).toEqual(['A', 'B', 'C']);
  });
});
