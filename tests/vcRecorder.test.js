import { describe, it, expect } from 'vitest';
import { rankPenaltyCandidates, recordUnmappedVc, flushVcRecorder } from '../server/vcRecorder.js';

describe('vc recorder', () => {
  it('ranks the code that keeps coming just before penalties first', () => {
    const seen = [
      { match_id: 'a', code: '1050', at: 1000000 }, { match_id: 'a', code: '1100', at: 1100000 },
      { match_id: 'b', code: '1050', at: 5000000 }, { match_id: 'b', code: '1200', at: 5300000 },
    ];
    const pens = [{ match_id: 'a', at: 1060000 }, { match_id: 'b', at: 5080000 }];
    const r = rankPenaltyCandidates(seen, pens);
    expect(r[0]).toMatchObject({ code: '1050', penaltiesAfter: 2, seen: 2 });
    expect(r.find((x) => x.code === '1200').penaltiesAfter).toBe(0);
  });
  it('flush writes the buffered codes once and survives a database error', async () => {
    recordUnmappedVc({ matchId: 'x', match: 'A - B', code: '1050' });
    const calls = [];
    expect(await flushVcRecorder({ query: async (...a) => { calls.push(a); return {}; } })).toBe(1);
    expect(calls.length).toBe(2);
    recordUnmappedVc({ matchId: 'x', code: '1051' });
    expect(await flushVcRecorder({ query: async () => { throw new Error('down'); } })).toBe(0);
  });
  it('ignores empty codes and a missing match id', async () => {
    recordUnmappedVc({ matchId: '', code: '1' }); recordUnmappedVc({ matchId: 'x', code: '' });
    expect(await flushVcRecorder({ query: async () => ({}) })).toBe(0);
  });
});
