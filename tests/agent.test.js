import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory fake of the subset of `pg` Pool/Client behavior transferBalance()
// relies on: pool.connect() -> client with query()/release(), BEGIN/COMMIT/
// ROLLBACK, `SELECT ... FOR UPDATE`, and the two UPDATE balance statements.
// This lets us verify the actual money-moving logic (atomicity, rollback on
// insufficient balance, correct before/after amounts) without a real DB.
const mocks = vi.hoisted(function () {
  const users = new Map();
  const transactions = [];
  let snapshot = null;

  function reset() {
    users.clear();
    transactions.length = 0;
    users.set('owner-1', { id: 'owner-1', balance: 100000 });
    users.set('agent-1', { id: 'agent-1', balance: 500 });
    users.set('user-1', { id: 'user-1', balance: 50 });
  }
  reset();

  function query(sql, params = []) {
    const s = String(sql);
    if (s.startsWith('BEGIN')) {
      // Snapshot balances so ROLLBACK can genuinely undo in-transaction
      // mutations, matching real Postgres transactional semantics.
      snapshot = new Map([...users].map(([k, v]) => [k, { ...v }]));
      return Promise.resolve({ rows: [] });
    }
    if (s.startsWith('COMMIT')) {
      snapshot = null;
      return Promise.resolve({ rows: [] });
    }
    if (s.startsWith('ROLLBACK')) {
      if (snapshot) { users.clear(); for (const [k, v] of snapshot) users.set(k, v); }
      snapshot = null;
      return Promise.resolve({ rows: [] });
    }
    if (s.includes('SELECT balance FROM users WHERE id = $1 FOR UPDATE')) {
      const row = users.get(params[0]);
      return Promise.resolve({ rows: row ? [{ balance: row.balance }] : [] });
    }
    if (s.startsWith('UPDATE users SET balance = balance - $1')) {
      const row = users.get(params[1]);
      if (row) row.balance -= params[0];
      return Promise.resolve({ rows: [], rowCount: row ? 1 : 0 });
    }
    if (s.startsWith('UPDATE users SET balance = balance + $1')) {
      const row = users.get(params[1]);
      if (row) row.balance += params[0];
      return Promise.resolve({ rows: [], rowCount: row ? 1 : 0 });
    }
    if (s.startsWith('INSERT INTO transactions')) {
      transactions.push({
        actorId: params[0], sourceId: params[1], targetId: params[2], amount: params[3],
        type: params[4], reference: params[5],
        sourceBefore: params[6], sourceAfter: params[7],
        targetBefore: params[8], targetAfter: params[9], createdAt: params[10],
      });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    throw new Error('unmocked query: ' + s);
  }

  const client = { query, release: vi.fn() };
  const pool = { connect: () => Promise.resolve(client), query };

  return { users, transactions, reset, pool };
});

vi.mock('../server/db.js', () => ({ default: mocks.pool, pool: mocks.pool }));

const { transferBalance } = await import('../server/ledger.js');
const { monthRange } = await import('../server/routes/agent.js');

beforeEach(() => {
  mocks.reset();
});

describe('transferBalance — Owner -> Agent -> User ledger', () => {
  it('moves money from source to target and records before/after balances', async () => {
    const result = await transferBalance({
      actorId: 'owner-1', sourceId: 'owner-1', targetId: 'agent-1',
      amount: 200, type: 'OWNER_TO_AGENT',
    });
    expect(result).toEqual({ sourceBefore: 100000, sourceAfter: 99800, targetBefore: 500, targetAfter: 700 });
    expect(mocks.users.get('owner-1').balance).toBe(99800);
    expect(mocks.users.get('agent-1').balance).toBe(700);
  });

  it('writes exactly one ledger row per transfer with the correct type', async () => {
    await transferBalance({ actorId: 'agent-1', sourceId: 'agent-1', targetId: 'user-1', amount: 30, type: 'AGENT_TO_USER' });
    expect(mocks.transactions).toHaveLength(1);
    expect(mocks.transactions[0]).toMatchObject({
      actorId: 'agent-1', sourceId: 'agent-1', targetId: 'user-1', amount: 30, type: 'AGENT_TO_USER',
      sourceBefore: 500, sourceAfter: 470, targetBefore: 50, targetAfter: 80,
    });
  });

  it('rejects a transfer larger than the source balance and moves nothing', async () => {
    await expect(
      transferBalance({ actorId: 'agent-1', sourceId: 'agent-1', targetId: 'user-1', amount: 9999, type: 'AGENT_TO_USER' })
    ).rejects.toThrow('Insufficient balance');
    // Rolled back — no partial mutation on either side, no ledger row.
    expect(mocks.users.get('agent-1').balance).toBe(500);
    expect(mocks.users.get('user-1').balance).toBe(50);
    expect(mocks.transactions).toHaveLength(0);
  });

  it('rejects a non-positive or non-numeric amount before touching the DB', async () => {
    await expect(transferBalance({ actorId: 'a', sourceId: 'a', targetId: 'b', amount: 0, type: 'X' })).rejects.toThrow();
    await expect(transferBalance({ actorId: 'a', sourceId: 'a', targetId: 'b', amount: -5, type: 'X' })).rejects.toThrow();
    await expect(transferBalance({ actorId: 'a', sourceId: 'a', targetId: 'b', amount: NaN, type: 'X' })).rejects.toThrow();
    expect(mocks.transactions).toHaveLength(0);
  });

  it('errors when the target account does not exist, and does not leave the source debited', async () => {
    await expect(
      transferBalance({ actorId: 'agent-1', sourceId: 'agent-1', targetId: 'ghost', amount: 10, type: 'AGENT_TO_USER' })
    ).rejects.toThrow('Target account not found');
    expect(mocks.users.get('agent-1').balance).toBe(500);
  });

  it('supports a null source (direct credit/mint) without requiring a source balance check', async () => {
    const result = await transferBalance({ actorId: 'owner-1', sourceId: null, targetId: 'user-1', amount: 25, type: 'ADMIN_CREDIT' });
    expect(result.sourceBefore).toBeNull();
    expect(mocks.users.get('user-1').balance).toBe(75);
  });
});

describe('monthRange — monthly report date boundaries', () => {
  it('computes [start, end) for a normal month', () => {
    const r = monthRange('2026-03');
    expect(r.label).toBe('2026-03');
    expect(new Date(r.rangeStart).toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(new Date(r.rangeEnd).toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('rolls over the year correctly for December', () => {
    const r = monthRange('2026-12');
    expect(new Date(r.rangeStart).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(new Date(r.rangeEnd).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('a bet created exactly at rangeEnd belongs to the NEXT month, not this one', () => {
    const r = monthRange('2026-03');
    // rangeEnd is used as an exclusive upper bound (b.created_at < rangeEnd)
    // by the route's SQL — this just documents/locks that boundary value.
    expect(r.rangeEnd).toBe(Date.UTC(2026, 3, 1));
  });

  it('falls back to the current month for a missing/invalid month param', () => {
    const now = new Date();
    const r = monthRange(undefined);
    expect(r.year).toBe(now.getUTCFullYear());
    expect(r.month).toBe(now.getUTCMonth() + 1);

    const rBad = monthRange('not-a-month');
    expect(rBad.label).toBe(r.label);
  });
});
