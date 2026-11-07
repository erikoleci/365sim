import { describe, it, expect } from 'vitest';
import { summarizeProfile } from '../server/cpuProfiler.js';

describe('summarizeProfile', () => {
  it('ranks busy time per function and file, ignoring idle', () => {
    const profile = {
      nodes: [
        { id: 1, callFrame: { functionName: '(idle)', url: '' } },
        { id: 2, callFrame: { functionName: 'parseJson', url: 'file:///app/server/a.js', lineNumber: 9 } },
        { id: 3, callFrame: { functionName: 'small', url: 'file:///app/server/b.js', lineNumber: 0 } },
      ],
      samples: [1, 2, 2, 3],
      timeDeltas: [5000, 3000, 3000, 2000],
    };
    const s = summarizeProfile(profile);
    expect(s.busyMs).toBe(8);
    expect(s.idleMs).toBe(5);
    expect(s.functions[0]).toMatchObject({ name: 'parseJson server/a.js:10', ms: 6, pct: 75 });
    expect(s.files[0].name).toBe('server/a.js');
  });
});
