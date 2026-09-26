import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';

// Regression test: User A must never be able to read or act on User B's
// bets, no matter what id/params are supplied in the request. Same
// in-memory fake-pool style as tests/agent.test.js / tests/requireAuth.test.js
// -- no real database needed to prove the ownership rule holds.

const mocks = vi.hoisted(function () {
  const users = new Map();
  const bets = new Map();
  const betSelections = new Map(); // bet_id -> selections[]

  function reset() {
    users.clear();
    bets.clear();
    betSelections.clear();
    users.set('user-a', { id: 'user-a', role: 'USER', is_active: true, balance: 1000 });
    users.set('user-b', { id: 'user-b', role: 'USER', is_active: true, balance: 1000 });
    // A pending bet that belongs to user-b, well within the cancel window.
    bets.set('bet-b1', {
      id: 'bet-b1', user_id: 'user-b', type: 'SINGLE', stake: 100,
      total_odds: 2, potential_return: 200, status: 'PENDING', created_at: Date.now(),
    });
  }
  reset();

  function query(sql, params = []) {
    const s = String(sql);
    if (s.startsWith('SELECT id, role, is_active FROM users WHERE id = $1')) {
      const row = users.get(params[0]);
      return Promise.resolve({ rows: row ? [row] : [] });
    }
    if (s.startsWith('SELECT * FROM bets WHERE user_id = $1')) {
      const rows = [...bets.values()].filter((b) => b.user_id === params[0]);
      return Promise.resolve({ rows });
    }
    if (s.startsWith('SELECT * FROM bet_selections WHERE bet_id = ANY')) {
      const ids = new Set(params[0]);
      const rows = [...betSelections.values()].flat().filter((s2) => ids.has(s2.bet_id));
      return Promise.resolve({ rows });
    }
    // Cancel endpoint looks a single bet up BY ID ALONE (no user_id in the
    // WHERE clause) and enforces ownership in application code afterwards --
    // exercise exactly that path.
    if (s.startsWith('SELECT * FROM bets WHERE id = $1')) {
      const row = bets.get(params[0]);
      return Promise.resolve({ rows: row ? [row] : [] });
    }
    if (s.startsWith('SELECT balance FROM users WHERE id = $1')) {
      const row = users.get(params[0]);
      return Promise.resolve({ rows: row ? [{ balance: row.balance }] : [] });
    }
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') {
      return Promise.resolve({ rows: [] });
    }
    if (s.startsWith('UPDATE users SET balance = balance + $1 WHERE id = $2')) {
      const user = users.get(params[1]);
      if (user) user.balance += Number(params[0]);
      return Promise.resolve({ rows: [] });
    }
    if (s.startsWith('DELETE FROM bet_selections WHERE bet_id = $1')) {
      betSelections.delete(params[0]);
      return Promise.resolve({ rows: [] });
    }
    if (s.startsWith('DELETE FROM bets WHERE id = $1')) {
      const bet = bets.get(params[0]);
      if (bet) bet.status = 'CANCELLED';
      bets.delete(params[0]);
      return Promise.resolve({ rows: [] });
    }
    throw new Error('unmocked query: ' + s);
  }

  const client = {
    query: vi.fn((sql, params) => query(sql, params)),
    release: vi.fn(),
  };
  const pool = { query, connect: () => Promise.resolve(client) };
  return { users, bets, betSelections, reset, pool, client };
});

vi.mock('../server/db.js', () => ({ default: mocks.pool, pool: mocks.pool }));

const { JWT_SECRET } = await import('../server/routes/auth.js');
const betsRouter = (await import('../server/routes/bets.js')).default;

beforeEach(() => { mocks.reset(); });

function sign(id) {
  return jwt.sign({ id, username: id, role: 'USER' }, JWT_SECRET, { expiresIn: '7d' });
}

let server;
let baseUrl;

beforeEach(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/bets', betsRouter);
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('bets routes - ownership (IDOR) enforcement', () => {
  it('GET /api/bets only ever returns the authenticated user\'s own bets', async () => {
    const res = await fetch(`${baseUrl}/api/bets`, {
      headers: { authorization: 'Bearer ' + sign('user-a') },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    // user-a has no bets; critically, user-b's bet must never appear here
    // just because it's the only bet in the store.
    expect(body.bets).toEqual([]);
  });

  it('user A cannot cancel user B\'s bet by guessing/passing its id', async () => {
    const res = await fetch(`${baseUrl}/api/bets/bet-b1/cancel`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + sign('user-a') },
    });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toMatch(/not your bet/i);
    // and the bet must be untouched
    expect(mocks.bets.get('bet-b1').status).toBe('PENDING');
  });

  it('the rightful owner CAN cancel their own pending bet', async () => {
    const res = await fetch(`${baseUrl}/api/bets/bet-b1/cancel`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + sign('user-b') },
    });
    expect(res.status).toBe(200);
  });

  it('rejects requests with no auth token at all', async () => {
    const res = await fetch(`${baseUrl}/api/bets`);
    expect(res.status).toBe(401);
  });
});
