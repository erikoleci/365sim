import { describe, it, expect, beforeEach, vi } from 'vitest';
import { observeVcFrame, getUnmappedVcReport, __resetVcDeltaForTests } from '../server/vcDeltaSampler.js';

const frame = (o) => ({ VC: '', T: '3700', SC: '0-1', C1: '1', C2: '1', YC1: '2', YC2: '0', RC1: '0', RC2: '0', H3: '56', A3: '43', ...o });

describe('vcDeltaSampler', () => {
  beforeEach(() => {
    __resetVcDeltaForTests();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('records which counters moved on the first frame of an unmapped code', () => {
    observeVcFrame('1', frame({ VC: '1001' }), true);
    const s = observeVcFrame('1', frame({ VC: '1099', YC1: '3' }), false, { match: 'A - B' });
    expect(s.changed).toEqual([{ key: 'YC1', from: '2', to: '3' }]);
    expect(s.hint).toMatch(/yellow/);
    const rep = getUnmappedVcReport();
    expect(rep).toHaveLength(1);
    expect(rep[0]).toMatchObject({ code: '1099', count: 1, tally: { YC1: 1 } });
  });

  it('says "no counter moved" when nothing changes (e.g. an injury-type event)', () => {
    observeVcFrame('1', frame({ VC: '1001' }), true);
    const s = observeVcFrame('1', frame({ VC: '1098' }), false);
    expect(s.changed).toEqual([]);
    expect(s.hint).toMatch(/no counter/);
    expect(getUnmappedVcReport()[0].tally).toEqual({ '(none)': 1 });
  });

  it('ignores repeated frames of the same code, mapped codes and the first frame of a match', () => {
    expect(observeVcFrame('1', frame({ VC: '1099' }), false)).toBeNull(); // no previous frame
    expect(observeVcFrame('1', frame({ VC: '1099' }), false)).toBeNull(); // same code again
    expect(observeVcFrame('1', frame({ VC: '1001' }), true)).toBeNull(); // mapped
    expect(getUnmappedVcReport()).toEqual([]);
  });

  it('counts how often each counter moves with the same code', () => {
    for (let i = 0; i < 3; i++) {
      observeVcFrame('1', frame({ VC: '1001', C1: String(i) }), true);
      observeVcFrame('1', frame({ VC: '1097', C1: String(i + 1) }), false);
    }
    const r = getUnmappedVcReport().find((x) => x.code === '1097');
    expect(r.count).toBe(3);
    expect(r.tally.C1).toBe(3);
  });
});
