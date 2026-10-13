import { describe, it, expect } from 'vitest';
import { navKey, planNav } from '../utils/navHistory.ts';

const HOME = { detailMatchId: null, isMobileSlipOpen: false, showLiveOnly: false, showResults: false, currentLeague: 'All Top Football' };
const nav = (o) => ({ ...HOME, ...o });

describe('planNav - phone back / in-app back share one history', () => {
  it('same screen: nothing to do', () => {
    expect(planNav([HOME], 0, HOME)).toEqual({ type: 'none' });
  });
  it('opening a match is a new entry', () => {
    const detail = nav({ detailMatchId: 'l365-1' });
    const plan = planNav([HOME], 0, detail);
    expect(plan).toEqual({ type: 'push', stack: [HOME, detail], idx: 1 });
  });
  it('closing the match returns to the previous entry (history.back), it does not pile up a new one', () => {
    const detail = nav({ detailMatchId: 'l365-1' });
    expect(planNav([HOME, detail], 1, HOME)).toEqual({ type: 'back' });
  });
  it('list -> live -> match -> back -> back walks through exactly those screens', () => {
    const live = nav({ showLiveOnly: true });
    const detail = nav({ showLiveOnly: true, detailMatchId: 'l365-1' });
    let stack = [HOME]; let idx = 0;
    for (const n of [live, detail]) { const p = planNav(stack, idx, n); expect(p.type).toBe('push'); stack = p.stack; idx = p.idx; }
    expect(idx).toBe(2);
    expect(planNav(stack, idx, live)).toEqual({ type: 'back' }); idx = 1;
    expect(planNav(stack, idx, HOME)).toEqual({ type: 'back' });
  });
  it('the bet slip drawer is its own step: back closes the drawer, not the match page', () => {
    const detail = nav({ detailMatchId: 'l365-1' });
    const slip = nav({ detailMatchId: 'l365-1', isMobileSlipOpen: true });
    const stack = [HOME, detail, slip];
    expect(planNav(stack, 2, detail)).toEqual({ type: 'back' }); // closing the drawer
  });
  it('a new screen after going back discards the old forward entries', () => {
    const a = nav({ detailMatchId: 'a' }); const b = nav({ detailMatchId: 'b' });
    const plan = planNav([HOME, a], 0, b); // user is on HOME (idx 0) after a back, then opens b
    expect(plan).toEqual({ type: 'push', stack: [HOME, b], idx: 1 });
  });
  it('navKey differs for any screen difference', () => {
    expect(navKey(HOME)).not.toBe(navKey(nav({ currentLeague: 'epl' })));
    expect(navKey(HOME)).not.toBe(navKey(nav({ showResults: true })));
    expect(navKey(HOME)).toBe(navKey({ ...HOME }));
  });
});
