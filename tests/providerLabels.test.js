import { describe, it, expect } from 'vitest';
import { extractMatches } from '../server/providerLabels.js';

describe('extractMatches', () => {
  it('finds a code next to the label text', () => {
    const js = 'var A={"1007":"Rivënie fundore","1010":"Goditje dënimi","1020":"Penallti"};';
    const r = extractMatches(js, 'app.js');
    expect(r.some((x) => x.pairs.some((p) => p.code === '1020' && p.text === 'Penallti'))).toBe(true);
  });
});
