import { describe, it, expect } from 'vitest';
import { allowsCurrency, disallowedPart, normalizeAccountCurrency, accountCurrencyError } from '../server/ledger.js';

describe('account currency: an account never holds a currency it was not opened in', () => {
  it('normalises the value, defaulting to both wallets', () => {
    expect(normalizeAccountCurrency('EUR')).toBe('EUR');
    expect(normalizeAccountCurrency('ALL')).toBe('ALL');
    expect(normalizeAccountCurrency(undefined)).toBe('BOTH');
    expect(normalizeAccountCurrency('USD')).toBe('BOTH');
  });
  it('a euro account bets / plays only euro, a lek account only lek, both accounts either', () => {
    expect(allowsCurrency('EUR', 'EUR')).toBe(true);
    expect(allowsCurrency('EUR', 'ALL')).toBe(false);
    expect(allowsCurrency('ALL', 'EUR')).toBe(false);
    expect(allowsCurrency('ALL', 'ALL')).toBe(true);
    expect(allowsCurrency('BOTH', 'EUR')).toBe(true);
    expect(allowsCurrency('BOTH', 'ALL')).toBe(true);
    expect(allowsCurrency(undefined, 'EUR')).toBe(true); // accounts from before the column existed
  });
  it('credit / debit / opening balance in the other currency is refused', () => {
    expect(disallowedPart('EUR', [{ currency: 'ALL', amount: 500 }])).toEqual({ currency: 'ALL', amount: 500 });
    expect(disallowedPart('EUR', [{ currency: 'EUR', amount: 20 }])).toBeUndefined();
    expect(disallowedPart('EUR', [{ currency: 'ALL', amount: 0 }, { currency: 'EUR', amount: 20 }])).toBeUndefined(); // a zero part is nothing
    expect(disallowedPart('ALL', [{ currency: 'EUR', amount: 5 }])).toBeTruthy();
    expect(disallowedPart('BOTH', [{ currency: 'ALL', amount: 5 }, { currency: 'EUR', amount: 5 }])).toBeUndefined();
  });
  it('tells the user which currency the account plays', () => {
    expect(accountCurrencyError('EUR')).toMatch(/euro/);
    expect(accountCurrencyError('ALL')).toMatch(/lek/);
  });
});
