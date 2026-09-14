import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

// Same in-memory fake-pool style as tests/agent.test.js.
const mocks = vi.hoisted(function () {
  const users = new Map();
  function reset() {
    users.clear();
    users.set('user-1', { id: 'user-1', role: 'USER', is_active: true });
    users.set('disabled-1', { id: 'disabled-1', role: 'USER', is_active: false });
  }
  reset();
  function query(sql, params = []) {
    const s = String(sql);
    if (s.startsWith('SELECT id, role, is_active FROM users WHERE id = $1')) {
      const row = users.get(params[0]);
      return Promise.resolve({ rows: row ? [row] : [] });
    }
    throw new Error('unmocked query: ' + s);
  }
  const pool = { query, connect: () => Promise.resolve({ query, release: vi.fn() }) };
  return { users, reset, pool };
});

vi.mock('../server/db.js', () => ({ default: mocks.pool, pool: mocks.pool }));

const { requireAuth, JWT_SECRET } = await import('../server/routes/auth.js');

beforeEach(() => { mocks.reset(); });

function sign(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function fakeReqRes(token) {
  const req = { headers: token ? { authorization: 'Bearer ' + token } : {} };
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('requireAuth - re-validates against the DB on every request', () => {
  it('allows a valid token for a still-active account', async () => {
    const token = sign({ id: 'user-1', username: 'alice', role: 'USER' });
    const { req, res, next } = fakeReqRes(token);
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toEqual({ id: 'user-1', username: 'alice', role: 'USER' });
  });

  it('rejects a token for an account that has since been disabled (does not wait for token expiry)', async () => {
    const token = sign({ id: 'disabled-1', username: 'bob', role: 'USER' });
    const { req, res, next } = fakeReqRes(token);
    await requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('picks up a role change made after the token was issued (does not trust the stale JWT payload role)', async () => {
    const token = sign({ id: 'user-1', username: 'alice', role: 'USER' });
    mocks.users.set('user-1', { id: 'user-1', role: 'AGENT', is_active: true });
    const { req, res, next } = fakeReqRes(token);
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.user.role).toBe('AGENT');
  });

  it('rejects a token for an account that no longer exists (deleted)', async () => {
    const token = sign({ id: 'ghost', username: 'nobody', role: 'USER' });
    const { req, res, next } = fakeReqRes(token);
    await requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects a missing token', async () => {
    const { req, res, next } = fakeReqRes(null);
    await requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects a malformed/invalid-signature token', async () => {
    const { req, res, next } = fakeReqRes('not-a-real-token');
    await requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
