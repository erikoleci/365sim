import { describe, it, expect, beforeEach } from 'vitest';
import { recordEventFrame, getEventFrames, __resetEventFramesForTests } from '../server/feedKeySampler.js';
describe('recordEventFrame', () => {
  beforeEach(() => __resetEventFramesForTests());
  it('ignores the first frame and clock-only changes, records a real change with the changed fields', () => {
    recordEventFrame('1', { T: '100', YC1: '0', VC: '5' });
    recordEventFrame('1', { T: '101', YC1: '0', VC: '5' });
    expect(getEventFrames()).toHaveLength(0);
    recordEventFrame('1', { T: '102', YC1: '1', VC: '5', PN: 'Kauan Gomes' });
    const f = getEventFrames();
    expect(f).toHaveLength(1);
    expect(f[0].changed.sort()).toEqual(['PN', 'YC1']);
    expect(f[0].from.YC1).toBe('0');
    expect(f[0].frame.PN).toBe('Kauan Gomes');
  });
});
