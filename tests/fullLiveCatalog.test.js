import { describe, it, expect } from 'vitest';
import { buildEvent, applyFullLiveCatalog, mergeEvents, FULL_LIVE_MIN_MARKETS } from '../server/london365/markets.js';

// rows of N markets named "M<i>" with two options each, plus an optional extra market
const rows = (n, extra = []) => {
  const out = [];
  for (let i = 1; i <= n; i++) {
    out.push({ coefId: `c${i}a`, coef: 1.9, option: 'Po', marketId: String(i), marketName: `Market-${i}` });
    out.push({ coefId: `c${i}b`, coef: 1.8, option: 'Jo', marketId: String(i), marketName: `Market-${i}` });
  }
  for (const e of extra) out.push(e);
  return out;
};
const goals3 = [{ coefId: 'g3a', coef: 8.1, option: '1|3+', marketId: '900', marketName: 'Rezultati Final Gola 3+' }];
const goals4 = [{ coefId: 'g4a', coef: 8.14, option: '1|4+', marketId: '901', marketName: 'Rezultati Final Gola 4+' }];
const ev = (r, full) => { const e = buildEvent('1', 'A', 'B', new Date().toISOString(), r); if (full) e.liveFull = true; return e; };
const names = (e) => e.bookmakers[0].markets.map((m) => m.label);

describe('full live catalog replaces the market list', () => {
  it('a market the provider no longer lists (Gola 3+ -> 4+) is gone, not kept on its old price', () => {
    const old = applyFullLiveCatalog(null, ev(rows(10, goals3), true)); // score 0-0: the provider offers 3+
    expect(names(old)).toContain('Rezultati Final Gola 3+');
    const now = applyFullLiveCatalog(old, ev(rows(10, goals4), true));    // score 1-1: the provider offers 4+
    expect(names(now)).toContain('Rezultati Final Gola 4+');
    expect(names(now)).not.toContain('Rezultati Final Gola 3+');
    // the old behaviour (merge) is what kept it
    expect(names(mergeEvents(old, ev(rows(10, goals4))))).toContain('Rezultati Final Gola 3+');
  });
  it('a degraded response (under half of the previous catalog) is not trusted: caller merges as before', () => {
    const old = applyFullLiveCatalog(null, ev(rows(20), true));
    expect(applyFullLiveCatalog(old, ev(rows(FULL_LIVE_MIN_MARKETS), true))).toBeNull(); // 8 < 20 / 2
    expect(applyFullLiveCatalog(old, ev(rows(14), true))).not.toBeNull();                  // 14 >= 10
  });
  it('only a full catalog counts: packed / socket updates and tiny responses are left to the merge', () => {
    expect(applyFullLiveCatalog(null, ev(rows(20), false))).toBeNull();
    expect(applyFullLiveCatalog(null, ev(rows(FULL_LIVE_MIN_MARKETS - 1), true))).toBeNull();
    expect(applyFullLiveCatalog(null, null)).toBeNull();
  });
  it('remembers the size of the catalog for the next comparison', () => {
    expect(applyFullLiveCatalog(null, ev(rows(12), true)).liveCatalog).toBe(12);
  });
});
