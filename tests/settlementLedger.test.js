import { describe, it, expect } from 'vitest';
import { recomputeBetStatus } from '../server/matchSettlement.js';

// A fake client that records every write, with a user balance of 5000.
function fakeClient(bet, legs, { balance = 5000, failLedger = false, noUser = false } = {}) {
  const writes = [];
  return {
    writes,
    async query(sql, params = []) {
      if (/FROM bets WHERE id/.test(sql)) return { rows: [{ ...bet }] };
      if (/FROM bet_selections WHERE bet_id/.test(sql)) return { rows: legs };
      if (/SELECT balance FROM users/.test(sql)) return { rows: noUser ? [] : [{ balance }] };
      if (/INSERT INTO transactions/.test(sql) && failLedger) throw new Error('ledger down');
      writes.push({ sql, params });
      return { rows: [] };
    },
  };
}
const bet = (o = {}) => ({ id: 'b1', user_id: 'u1', stake: 1000, potential_return: 6000, status: 'PENDING', ...o });
const leg = (status, odds = 2) => ({ status, odds });
const ledger = (c) => c.writes.filter((w) => /INSERT INTO transactions/.test(w.sql)).map((w) => ({
  user: w.params[0], amount: w.params[1], type: w.params[2], ref: w.params[3], before: w.params[4], after: w.params[5],
}));
const credits = (c) => c.writes.filter((w) => /UPDATE users SET balance/.test(w.sql)).map((w) => w.params[0]);

describe('settlement payouts are written to the transactions ledger', () => {
  it('a winning ticket: balance credit AND a BET_WIN_PAYOUT row with before/after', async () => {
    const c = fakeClient(bet(), [leg('WON'), leg('WON')]);
    await recomputeBetStatus('b1', c);
    expect(credits(c)).toEqual([6000]);
    expect(ledger(c)).toEqual([{ user: 'u1', amount: 6000, type: 'BET_WIN_PAYOUT', ref: 'b1', before: 5000, after: 11000 }]);
  });
  it('a voided ticket: the refund is ledgered as BET_VOID_REFUND', async () => {
    const c = fakeClient(bet({ potential_return: 2000 }), [leg('VOID')]);
    await recomputeBetStatus('b1', c);
    expect(ledger(c)).toEqual([{ user: 'u1', amount: 1000, type: 'BET_VOID_REFUND', ref: 'b1', before: 5000, after: 6000 }]);
  });
  it('an accumulator with a refunded leg is ledgered with the RECALCULATED payout', async () => {
    const c = fakeClient(bet(), [leg('WON', 2), leg('VOID', 3)]);
    await recomputeBetStatus('b1', c);
    expect(ledger(c).map((r) => [r.type, r.amount])).toEqual([['BET_WIN_PAYOUT', 2000]]);
  });
  it('a losing ticket moves no money and writes no ledger row', async () => {
    const c = fakeClient(bet(), [leg('LOST'), leg('PENDING')]);
    await recomputeBetStatus('b1', c);
    expect(credits(c)).toEqual([]);
    expect(ledger(c)).toEqual([]);
  });
  it('an already settled ticket is not paid, and not ledgered, again', async () => {
    const c = fakeClient(bet({ status: 'WON' }), [leg('WON'), leg('WON')]);
    await recomputeBetStatus('b1', c);
    expect(credits(c)).toEqual([]);
    expect(ledger(c)).toEqual([]);
  });
  it('if the ledger write fails the settlement fails (so its transaction rolls back and is retried)', async () => {
    const c = fakeClient(bet(), [leg('WON'), leg('WON')], { failLedger: true });
    await expect(recomputeBetStatus('b1', c)).rejects.toThrow('ledger down');
  });
  it('a user that no longer exists is neither credited nor ledgered', async () => {
    const c = fakeClient(bet(), [leg('WON'), leg('WON')], { noUser: true });
    await recomputeBetStatus('b1', c);
    expect(credits(c)).toEqual([]);
    expect(ledger(c)).toEqual([]);
  });
});
