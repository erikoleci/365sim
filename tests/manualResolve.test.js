import { describe, it, expect } from 'vitest';
import { planManualResolve } from '../server/manualResolve.js';

const legs = (...st) => st.map((status, i) => ({ id: i + 1, status }));

describe('super admin closes a ticket by hand', () => {
  it('an open ticket made WON: every open leg wins, nothing to take back', () => {
    const p = planManualResolve({ status: 'PENDING', potential_return: 388 }, legs('PENDING', 'WON'), 'WON');
    expect(p.legUpdates).toEqual([{ id: 1, status: 'WON' }]);
    expect(p.takeBack).toBe(0);
  });
  it('a lost ticket made WON: the lost legs win (settlement then pays it once)', () => {
    const p = planManualResolve({ status: 'LOST', potential_return: 388 }, legs('LOST', 'WON'), 'WON');
    expect(p.legUpdates).toEqual([{ id: 1, status: 'WON' }]);
  });
  it('an open ticket made LOST: open legs lose, no money moves (the stake was taken when it was placed)', () => {
    const p = planManualResolve({ status: 'PENDING', stake: 20, potential_return: 388 }, legs('PENDING', 'PENDING'), 'LOST');
    expect(p.legUpdates).toEqual([{ id: 1, status: 'LOST' }, { id: 2, status: 'LOST' }]);
    expect(p.takeBack).toBe(0);
  });
  it('a won ticket made LOST: one leg loses and the winnings that were paid are taken back', () => {
    const p = planManualResolve({ status: 'WON', potential_return: 388 }, legs('WON', 'WON'), 'LOST');
    expect(p.legUpdates).toEqual([{ id: 1, status: 'LOST' }]);
    expect(p.takeBack).toBe(388);
  });
  it('void legs are left alone; cancelled / void tickets and same-status requests change nothing', () => {
    expect(planManualResolve({ status: 'PENDING' }, legs('VOID', 'PENDING'), 'WON').legUpdates).toEqual([{ id: 2, status: 'WON' }]);
    expect(planManualResolve({ status: 'CANCELLED' }, legs('PENDING'), 'WON').error.code).toBe('BET_NOT_RESOLVABLE');
    expect(planManualResolve({ status: 'VOID' }, legs('VOID'), 'LOST').error.code).toBe('BET_NOT_RESOLVABLE');
    expect(planManualResolve({ status: 'WON' }, legs('WON'), 'WON').noop).toBe(true);
    expect(planManualResolve({ status: 'PENDING' }, legs('VOID'), 'WON').error.code).toBe('NO_ACTIVE_LEGS');
    expect(planManualResolve({ status: 'PENDING' }, legs('PENDING'), 'DRAW').error.code).toBe('BAD_OUTCOME');
  });
});
