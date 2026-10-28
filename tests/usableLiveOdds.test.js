import { describe, it, expect } from 'vitest';
import { usableLiveOdds } from '../server/london365/markets.js';

describe('usableLiveOdds', () => {
  it('falls back to the list odds when the detail answers with one empty row', () => {
    const odds = usableLiveOdds([{ coefId: 'x', coef: NaN, option: '', marketId: '' }], '964371161|2.1|1|6575,964371160|4|X|6575,964371159|2.875|2|6575');
    expect(odds.map((o) => o.coef)).toEqual([2.1, 4, 2.875]);
  });
  it('does not offer locked placeholders (1.00) from the list', () => {
    expect(usableLiveOdds([], '1|1|1|6575,2|1|X|6575,3|1|2|6575')).toEqual([]);
  });
  it('keeps the detail rows when they have usable odds', () => {
    const odds = usableLiveOdds([{ coefId: 'a', coef: 1.5, option: '1', marketId: '6575' }], '9|9|1|6575');
    expect(odds.map((o) => o.coef)).toEqual([1.5]);
  });
});
