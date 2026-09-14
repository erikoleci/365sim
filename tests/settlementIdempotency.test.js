import { describe, it, expect, vi, beforeEach } from 'vitest';

// A fake Postgres pool that actually simulates row-level `FOR UPDATE`
// blocking (via a tiny per-key mutex released on COMMIT/ROLLBACK) --
// needed because the bug this guards against is specifically a
// concurrency race that a naive non-blocking mock would never reproduce.
const mocks = vi.hoisted(function () {
  const bets = new Map();
  const selections = new Map(); // betId -> [{id, status}]
  const users = new Map();

  const locks = new Map(); // key -> Promise chain (tail of the queue)
  function acquire(key) {
    const prev = locks.get(key) || Promise.resolve();
    let release;
    const held = new Promise((res) => { release = res; });
    locks.set(key, prev.then(() => held));
    return prev.then(() => release);
  }

  function reset() {
    bets.clear(); selections.clear(); users.clear(); locks.clear();
    users.set('user-1', { balance: 0 });
    bets.set('bet-1', { id: 'bet-1', status: 'PENDING', potential_return: 50, user_id: 'user-1' });
    selections.set('bet-1', [{ id: 1, status: 'WON' }]);
  }
  reset();

  function makeClient() {
    let heldRelease = null;
    let lockedBetId = null;
    return {
      async query(sql, params = []) {
        const s = String(sql);
        if (s.startsWith('BEGIN')) return { rows: [] };
        if (s.startsWith('COMMIT') || s.startsWith('ROLLBACK')) {
          if (heldRelease) { heldRelease(); heldRelease = null; locks.delete('bets:' + lockedBetId); }
          return { rows: [] };
        }
        if (s === 'SELECT * FROM bets WHERE id = $1 FOR UPDATE') {
          const betId = params[0];
          lockedBetId = betId;
          heldRelease = await acquire('bets:' + betId);
          const row = bets.get(betId);
          return { rows: row ? [{ ...row }] : [] };
        }
        if (s === 'SELECT * FROM bet_selections WHERE bet_id = $1') {
          return { rows: (selections.get(params[0]) || []).map((r) => ({ ...r })) };
        }
        if (s === 'UPDATE bets SET status = $1 WHERE id = $2') {
          const row = bets.get(params[1]);
          if (row) row.status = params[0];
          return { rows: [] };
        }
        if (s === 'UPDATE users SET balance = balance + $1 WHERE id = $2') {
          const row = users.get(params[1]);
          if (row) row.balance += params[0];
          return { rows: [] };
        }
        throw new Error('unmocked query: ' + s);
      },
      release: vi.fn(),
    };
  }

  const pool = { connect: () => Promise.resolve(makeClient()) };
  return { bets, selections, users, reset, pool };
});

vi.mock('../server/db.js', () => ({ default: mocks.pool, pool: mocks.pool }));

const { recomputeBetStatus } = await import('../server/matchSettlement.js');

beforeEach(() => { mocks.reset(); });

async function runInTransaction(fn) {
  const client = await mocks.pool.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

describe('recomputeBetStatus - settlement idempotency', () => {
  it('credits the win exactly once for a normal single call', async () => {
    await runInTransaction((client) => recomputeBetStatus('bet-1', client));
    expect(mocks.bets.get('bet-1').status).toBe('WON');
    expect(mocks.users.get('user-1').balance).toBe(50);
  });

  it('calling it again on an already-WON bet does NOT credit a second time (sequential double-call)', async () => {
    await runInTransaction((client) => recomputeBetStatus('bet-1', client));
    await runInTransaction((client) => recomputeBetStatus('bet-1', client));
    expect(mocks.users.get('user-1').balance).toBe(50);
  });

  it('two genuinely concurrent settlement transactions for the SAME bet only pay out once (the race this fix closes)', async () => {
    await Promise.all([
      runInTransaction((client) => recomputeBetStatus('bet-1', client)),
      runInTransaction((client) => recomputeBetStatus('bet-1', client)),
    ]);
    expect(mocks.bets.get('bet-1').status).toBe('WON');
    expect(mocks.users.get('user-1').balance).toBe(50);
  });

  it('three concurrent calls still only pay out once', async () => {
    await Promise.all([
      runInTransaction((client) => recomputeBetStatus('bet-1', client)),
      runInTransaction((client) => recomputeBetStatus('bet-1', client)),
      runInTransaction((client) => recomputeBetStatus('bet-1', client)),
    ]);
    expect(mocks.users.get('user-1').balance).toBe(50);
  });

  it('does nothing for a bet that still has a pending leg', async () => {
    mocks.selections.set('bet-1', [{ id: 1, status: 'WON' }, { id: 2, status: 'PENDING' }]);
    await runInTransaction((client) => recomputeBetStatus('bet-1', client));
    expect(mocks.bets.get('bet-1').status).toBe('PENDING');
    expect(mocks.users.get('user-1').balance).toBe(0);
  });

  it('a LOST leg loses the bet without crediting anything', async () => {
    mocks.selections.set('bet-1', [{ id: 1, status: 'WON' }, { id: 2, status: 'LOST' }]);
    await runInTransaction((client) => recomputeBetStatus('bet-1', client));
    expect(mocks.bets.get('bet-1').status).toBe('LOST');
    expect(mocks.users.get('user-1').balance).toBe(0);
  });

  it('is a no-op for a bet id that does not exist', async () => {
    await expect(runInTransaction((client) => recomputeBetStatus('ghost', client))).resolves.toBeUndefined();
  });
});
