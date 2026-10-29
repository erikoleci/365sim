import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const users = new Map();
  const queries = [];
  const tx = [];
  function query(sql, params = []) {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    queries.push(s);
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return Promise.resolve({ rows: [] });
    let m = s.match(/^SELECT (balance|balance_eur) FROM users WHERE id = \$1 FOR UPDATE/);
    if (m) { const r = users.get(params[0]); return Promise.resolve({ rows: r ? [{ [m[1]]: r[m[1]] }] : [] }); }
    m = s.match(/^UPDATE users SET (balance|balance_eur) = \1 ([+-]) \$1 WHERE id = \$2/);
    if (m) { const r = users.get(params[1]); r[m[1]] += m[2] === '+' ? params[0] : -params[0]; return Promise.resolve({ rows: [] }); }
    if (s.startsWith('INSERT INTO transactions')) { tx.push(params); return Promise.resolve({ rows: [] }); }
    throw new Error('unmocked query: ' + s);
  }
  const client = { query, release: vi.fn() };
  return { users, queries, tx, pool: { connect: () => Promise.resolve(client), query } };
});
vi.mock('../server/db.js', () => ({ default: mocks.pool, pool: mocks.pool }));

const { amountParts, transferBalances, walletColumn, normalizeCurrency } = await import('../server/ledger.js');

describe('amountParts', () => {
  it('reads lek and euro from one request, dropping zero parts', () => {
    expect(amountParts({ amount: 500, amountEur: 20 })).toEqual([{ currency: 'ALL', amount: 500 }, { currency: 'EUR', amount: 20 }]);
    expect(amountParts({ amountEur: 20 })).toEqual([{ currency: 'EUR', amount: 20 }]);
    expect(amountParts({ amount: 0, amountEur: 0 })).toBeNull();
    expect(amountParts({})).toBeNull();
  });
  it('rejects negatives unless signed, and non-numbers always', () => {
    expect(amountParts({ amount: -5 })).toBeNull();
    expect(amountParts({ amount: -5 }, { signed: true })).toEqual([{ currency: 'ALL', amount: -5 }]);
    expect(amountParts({ amount: '5' })).toBeNull();
    expect(amountParts({ amountEur: NaN })).toBeNull();
  });
});

describe('wallet helpers', () => {
  it('maps currency to column; anything but EUR is lek', () => {
    expect(walletColumn('EUR')).toBe('balance_eur');
    expect(walletColumn('ALL')).toBe('balance');
    expect(walletColumn(undefined)).toBe('balance');
    expect(normalizeCurrency('USD')).toBe('ALL');
  });
});

describe('transferBalances: lek and euro together', () => {
  it('moves both wallets in one transaction and ledgers each in its own currency', async () => {
    mocks.users.set('agent', { balance: 1000, balance_eur: 50 });
    mocks.users.set('user', { balance: 0, balance_eur: 0 });
    await transferBalances({ actorId: 'agent', sourceId: 'agent', targetId: 'user', type: 'AGENT_TO_USER', reference: 'u' },
      [{ currency: 'ALL', amount: 400 }, { currency: 'EUR', amount: 20 }]);
    expect(mocks.users.get('agent')).toEqual({ balance: 600, balance_eur: 30 });
    expect(mocks.users.get('user')).toEqual({ balance: 400, balance_eur: 20 });
    expect(mocks.tx.map((t) => t[11])).toEqual(['ALL', 'EUR']);
    expect(mocks.queries.filter((q) => q === 'BEGIN')).toHaveLength(1);
  });
  it('rolls everything back when the euro part is not covered', async () => {
    mocks.queries.length = 0;
    mocks.users.set('agent', { balance: 1000, balance_eur: 5 });
    await expect(transferBalances({ actorId: 'agent', sourceId: 'agent', targetId: 'user', type: 'AGENT_TO_USER' },
      [{ currency: 'ALL', amount: 100 }, { currency: 'EUR', amount: 20 }])).rejects.toThrow('Insufficient balance');
    expect(mocks.queries).toContain('ROLLBACK');
    expect(mocks.queries).not.toContain('COMMIT');
  });
});
