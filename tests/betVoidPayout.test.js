import { describe, it, expect } from 'vitest';
import { recomputeBetStatus } from '../server/matchSettlement.js';

// Minimal fake pg client: one bet, its legs, and a log of writes.
function fakeClient(bet, legs) {
  const writes = [];
  return {
    writes,
    async query(sql, params) {
      if (/FROM bets WHERE id/.test(sql)) return { rows: [bet] };
      if (/FROM bet_selections WHERE bet_id/.test(sql)) return { rows: legs };
      writes.push({ sql, params });
      return { rows: [] };
    },
  };
}
const bet = (o = {}) => ({ id: 'b1', user_id: 'u1', stake: 1000, potential_return: 6000, status: 'PENDING', ...o });
const leg = (status, odds) => ({ status, odds });
const balanceCredits = (c) => c.writes.filter((w) => /UPDATE users SET balance/.test(w.sql)).map((w) => w.params[0]);

describe('recomputeBetStatus — VOID handling', () => {
  it('single bet that is VOID refunds the stake', async () => {
    const c = fakeClient(bet({ potential_return: 2000 }), [leg('VOID', 2)]);
    await recomputeBetStatus('b1', c);
    expect(c.writes[0].params[0]).toBe('VOID');
    expect(balanceCredits(c)).toEqual([1000]);
  });
  it('accumulator: VOID leg is dropped and payout recalculated on the rest', async () => {
    const c = fakeClient(bet(), [leg('WON', 2), leg('VOID', 3)]);
    await recomputeBetStatus('b1', c);
    expect(balanceCredits(c)).toEqual([2000]); // 1000 x 2, not 6000
  });
  it('accumulator with a LOST leg is LOST even if another leg is VOID', async () => {
    const c = fakeClient(bet(), [leg('LOST', 2), leg('VOID', 3)]);
    await recomputeBetStatus('b1', c);
    expect(c.writes[0].params[0]).toBe('LOST');
    expect(balanceCredits(c)).toEqual([]);
  });
  it('all legs WON pays the original potential return once', async () => {
    const c = fakeClient(bet(), [leg('WON', 2), leg('WON', 3)]);
    await recomputeBetStatus('b1', c);
    expect(balanceCredits(c)).toEqual([6000]);
  });
  it('already settled bet is not paid twice', async () => {
    const c = fakeClient(bet({ status: 'WON' }), [leg('WON', 2), leg('WON', 3)]);
    await recomputeBetStatus('b1', c);
    expect(c.writes).toEqual([]);
  });
  it('a ticket with no legs is never paid', async () => {
    const c = fakeClient(bet(), []);
    await recomputeBetStatus('b1', c);
    expect(c.writes).toEqual([]);
  });
});
