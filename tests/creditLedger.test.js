import { describe, it, expect } from 'vitest';
import { buildCreditLedger, feeRateFromEnv } from '../server/creditLedger.js';

const admins = [
  { id: 'a1', name: 'Admin 1', username: 'admin1', balance: 60000, balance_eur: 400 },
  { id: 'a2', name: 'Admin 2', username: 'admin2', balance: 0, balance_eur: 0 },
];
const rows = [
  { id: 1, created_at: 1000, amount: 100000, currency: 'ALL', type: 'SUPER_TO_ADMIN', admin_id: 'a1' },
  { id: 2, created_at: 1001, amount: 1000, currency: 'EUR', type: 'SUPER_TO_ADMIN', admin_id: 'a1' },
  { id: 3, created_at: 2000, amount: 10000, currency: 'ALL', type: 'ADMIN_TO_SUPER', admin_id: 'a1' },
  { id: 4, created_at: 1500, amount: 5000, currency: null, type: 'SUPER_TO_ADMIN', admin_id: 'gone' },
];

describe('credit ledger', () => {
  it('counts given / taken back / remaining per admin, lek and euro apart, with 10% cash on what was given', () => {
    const l = buildCreditLedger({ admins, rows });
    const a1 = l.admins.find((a) => a.id === 'a1');
    expect(a1.given).toEqual({ ALL: 100000, EUR: 1000 });
    expect(a1.takenBack).toEqual({ ALL: 10000, EUR: 0 });
    expect(a1.net).toEqual({ ALL: 90000, EUR: 1000 });
    expect(a1.cash).toEqual({ ALL: 10000, EUR: 100 });
    expect(a1.remaining).toEqual({ ALL: 60000, EUR: 400 });
    expect(a1.used).toEqual({ ALL: 30000, EUR: 600 });
    expect(a1.leftPct).toEqual({ ALL: 67, EUR: 40 });
    expect(l.totals.cash).toEqual({ ALL: 10000, EUR: 100 });
  });
  it('the history is newest first, marks credit / take-back and ignores accounts that are not admins', () => {
    const l = buildCreditLedger({ admins, rows });
    expect(l.history.map((h) => h.id)).toEqual([3, 2, 1]);
    expect(l.history[0]).toMatchObject({ kind: 'TAKE_BACK', cash: 0 });
    expect(l.history[2]).toMatchObject({ kind: 'CREDIT', cash: 10000, currency: 'ALL' });
  });
  it('one admin only, and an admin with no credit has no percentage', () => {
    expect(buildCreditLedger({ admins, rows, adminId: 'a2' }).history).toEqual([]);
    expect(buildCreditLedger({ admins, rows }).admins.find((a) => a.id === 'a2').leftPct).toEqual({ ALL: null, EUR: null });
  });
  it('the fee rate defaults to 10% and can be set (0-1)', () => {
    expect(feeRateFromEnv(undefined)).toBe(0.1);
    expect(feeRateFromEnv('0.15')).toBe(0.15);
    expect(feeRateFromEnv('abc')).toBe(0.1);
    expect(buildCreditLedger({ admins, rows, feeRate: 0.2 }).totals.cash.ALL).toBe(20000);
  });
});
