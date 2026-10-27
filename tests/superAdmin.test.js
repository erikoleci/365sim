import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';

// SUPER_ADMIN: above the admin. Gives credit to admins (an admin never to an admin, not even to
// himself), creates / deletes admins, erases any ticket.

const mocks = vi.hoisted(() => {
  const users = new Map();
  const bets = new Map();
  const calls = { transfers: [], queries: [] };
  function reset() {
    users.clear(); bets.clear(); calls.transfers = []; calls.queries = [];
    users.set('super-1', { id: 'super-1', username: 'boss', role: 'SUPER_ADMIN', is_active: true, balance: 0 });
    users.set('admin-1', { id: 'admin-1', username: 'admin1', role: 'ADMIN', is_active: true, balance: 100 });
    users.set('admin-2', { id: 'admin-2', username: 'admin2', role: 'ADMIN', is_active: true, balance: 100 });
    users.set('agent-1', { id: 'agent-1', username: 'agent1', role: 'AGENT', is_active: true, balance: 50 });
    users.set('user-1', { id: 'user-1', username: 'user1', role: 'USER', is_active: true, balance: 10 });
    bets.set('bet-pending', { id: 'bet-pending', user_id: 'user-1', stake: 10, potential_return: 30, status: 'PENDING' });
    bets.set('bet-won', { id: 'bet-won', user_id: 'user-1', stake: 10, potential_return: 30, status: 'WON' });
    bets.set('bet-void', { id: 'bet-void', user_id: 'user-1', stake: 10, potential_return: 30, status: 'VOID' });
  }
  reset();
  async function query(sql, params = []) {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    calls.queries.push(s);
    if (s.startsWith('SELECT id, role, is_active FROM users WHERE id = $1')) { const r = users.get(params[0]); return { rows: r ? [r] : [] }; }
    if (s.startsWith('SELECT * FROM users WHERE id = $1 AND role = \'ADMIN\'')) { const r = users.get(params[0]); return { rows: r?.role === 'ADMIN' ? [r] : [] }; }
    if (s.startsWith('SELECT * FROM users WHERE id = $1') || s.startsWith('SELECT id, role FROM users WHERE id = $1')) { const r = users.get(params[0]); return { rows: r ? [r] : [] }; }
    if (s.startsWith('SELECT id FROM users WHERE username = $1')) { const r = [...users.values()].find((u) => u.username === params[0]); return { rows: r ? [{ id: r.id }] : [] }; }
    if (s.startsWith('UPDATE users SET balance = balance + $1 WHERE id = $2')) { users.get(params[1]).balance += params[0]; return { rows: [] }; }
    if (s.startsWith('INSERT INTO users')) { users.set(params[0], { id: params[0], name: params[1], username: params[2], role: 'ADMIN', is_active: true, balance: params[4] }); return { rows: [] }; }
    if (s.startsWith('SELECT * FROM bets WHERE id = $1')) { const b = bets.get(params[0]); return { rows: b ? [b] : [] }; }
    if (s.startsWith('DELETE FROM bets WHERE id = $1')) { bets.delete(params[0]); return { rows: [] }; }
    if (s.startsWith('SELECT * FROM users ORDER BY created_at')) return { rows: [...users.values()] };
    if (s.startsWith('SELECT COUNT(*)::int AS count FROM users')) return { rows: [{ count: users.size }] };
    if (s.startsWith('INSERT INTO audit_log') || s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK' || s.startsWith('DELETE FROM bet_selections')) return { rows: [] };
    throw new Error('unmocked query: ' + s);
  }
  const client = { query, release() {} };
  const pool = { query, connect: async () => client };
  return { users, bets, calls, reset, pool };
});

vi.mock('../server/db.js', () => ({ default: mocks.pool, pool: mocks.pool }));
vi.mock('../server/ledger.js', () => ({
  transferBalance: async (args) => { mocks.calls.transfers.push(args); return { sourceAfter: null, targetAfter: 100 + args.amount }; },
}));
vi.mock('../server/userDeletion.js', () => ({
  deleteUserIfUnused: async (id) => { mocks.users.delete(id); return { ok: true }; },
  forceDeleteUser: async (id) => { mocks.users.delete(id); },
  deleteBlockedMessage: () => 'blocked',
}));

const { JWT_SECRET } = await import('../server/routes/auth.js');
const adminRouter = (await import('../server/routes/admin.js')).default;
const { betBalanceReversal } = await import('../server/routes/admin.js');

const sign = (id, role) => jwt.sign({ id, username: id, role }, JWT_SECRET, { expiresIn: '7d' });
let server; let baseUrl;
beforeEach(async () => {
  mocks.reset();
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
});
afterEach(async () => { await new Promise((resolve) => server.close(resolve)); });

const call = (method, path, as, body) => fetch(baseUrl + '/api/admin' + path, {
  method, headers: { authorization: 'Bearer ' + sign(...as), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
const SUPER = ['super-1', 'SUPER_ADMIN'];
const ADMIN = ['admin-1', 'ADMIN'];

describe('access', () => {
  it('the super admin can use every admin route; an agent and a user cannot', async () => {
    expect((await call('GET', '/users', SUPER)).status).toBe(200);
    expect((await call('GET', '/users', ADMIN)).status).toBe(200);
    expect((await call('GET', '/users', ['agent-1', 'AGENT'])).status).toBe(403);
    expect((await call('GET', '/users', ['user-1', 'USER'])).status).toBe(403);
  });
});

describe('credit', () => {
  it('an admin gives credit to a user, but never to an admin or to himself', async () => {
    expect((await call('POST', '/users/user-1/credit', ADMIN, { amount: 25 })).status).toBe(200);
    expect(mocks.calls.transfers).toEqual([expect.objectContaining({ sourceId: 'admin-1', targetId: 'user-1', amount: 25, type: 'ADMIN_TO_USER' })]);
    expect((await call('POST', '/users/admin-1/credit', ADMIN, { amount: 25 })).status).toBe(403); // himself
    expect((await call('POST', '/users/admin-2/credit', ADMIN, { amount: 25 })).status).toBe(403); // another admin
    expect((await call('POST', '/users/super-1/credit', ADMIN, { amount: 25 })).status).toBe(403);
    expect(mocks.users.get('admin-1').balance).toBe(100);
  });
  it('the super admin gives credit to an admin (ledger SUPER_TO_ADMIN), an admin cannot use that route', async () => {
    const ok = await call('POST', '/admins/admin-1/credit', SUPER, { amount: 500 });
    expect(ok.status).toBe(200);
    expect(mocks.calls.transfers).toEqual([expect.objectContaining({ actorId: 'super-1', sourceId: null, targetId: 'admin-1', amount: 500, type: 'SUPER_TO_ADMIN' })]);
    expect((await call('POST', '/admins/admin-1/credit', ADMIN, { amount: 500 })).status).toBe(403);
    expect((await call('POST', '/admins/user-1/credit', SUPER, { amount: 5 })).status).toBe(404); // only admin accounts
    expect((await call('POST', '/admins/admin-1/credit', SUPER, { amount: -5 })).status).toBe(400);
  });
  it('the super admin takes credit back from an admin; an admin cannot', async () => {
    expect((await call('POST', '/admins/admin-1/debit', SUPER, { amount: 40 })).status).toBe(200);
    expect(mocks.calls.transfers).toEqual([expect.objectContaining({ sourceId: 'admin-1', targetId: 'super-1', amount: 40, type: 'ADMIN_TO_SUPER' })]);
    expect((await call('POST', '/admins/admin-1/debit', ADMIN, { amount: 40 })).status).toBe(403);
    expect((await call('POST', '/admins/admin-1/debit', SUPER, { amount: -5 })).status).toBe(400);
  });
  it('the super admin can also use the generic credit on anyone', async () => {
    expect((await call('POST', '/users/admin-1/credit', SUPER, { amount: 10 })).status).toBe(200);
    expect(mocks.users.get('admin-1').balance).toBe(110);
  });
});

describe('admin accounts', () => {
  it('only the super admin creates admins', async () => {
    const body = { name: 'New', username: 'newadmin', password: 'secret1', balance: 0 };
    expect((await call('POST', '/admins', ADMIN, body)).status).toBe(403);
    const res = await call('POST', '/admins', SUPER, body);
    expect(res.status).toBe(201);
    expect((await res.json()).admin.username).toBe('newadmin');
    expect((await call('POST', '/admins', SUPER, body)).status).toBe(409); // username taken
    expect((await call('POST', '/admins', SUPER, { ...body, username: 'x', password: '123' })).status).toBe(400);
  });
  it('only the super admin deletes an admin; nobody deletes a super admin or himself', async () => {
    expect((await call('DELETE', '/users/admin-2', ADMIN)).status).toBe(400);
    expect((await call('DELETE', '/users/admin-2/force', ADMIN)).status).toBe(400);
    expect((await call('DELETE', '/users/admin-1', SUPER)).status).toBe(200);
    expect((await call('DELETE', '/users/super-1', SUPER)).status).toBe(400);
    expect((await call('DELETE', '/users/user-1', ['admin-2', 'ADMIN'])).status).toBe(200); // normal users: unchanged
  });
  it('an admin cannot reset another admin\'s password', async () => {
    expect((await call('POST', '/users/admin-2/reset-password', ADMIN, { password: 'newpass1' })).status).toBe(403);
  });
});

describe('erasing tickets', () => {
  it('betBalanceReversal puts the money back as if the ticket had never existed', () => {
    expect(betBalanceReversal({ status: 'PENDING', stake: 10, potential_return: 30 })).toBe(10);
    expect(betBalanceReversal({ status: 'LOST', stake: 10, potential_return: 30 })).toBe(10);
    expect(betBalanceReversal({ status: 'WON', stake: 10, potential_return: 30 })).toBe(-20);
    expect(betBalanceReversal({ status: 'VOID', stake: 10, potential_return: 30 })).toBe(0);
  });
  it('only the super admin erases a ticket (any status), adjusting the balance by default', async () => {
    expect((await call('DELETE', '/bets/bet-pending', ADMIN)).status).toBe(403);
    const res = await call('DELETE', '/bets/bet-pending', SUPER);
    expect(res.status).toBe(200);
    expect((await res.json()).balanceChange).toBe(10);
    expect(mocks.bets.has('bet-pending')).toBe(false);
    expect(mocks.users.get('user-1').balance).toBe(20);
    expect((await call('DELETE', '/bets/bet-won', SUPER)).status).toBe(200);
    expect(mocks.users.get('user-1').balance).toBe(0); // -20 winnings taken back
    expect((await call('DELETE', '/bets/bet-void', SUPER)).status).toBe(200);
    expect((await call('DELETE', '/bets/nope', SUPER)).status).toBe(404);
  });
  it('?adjust=0 erases the ticket and leaves the balances alone', async () => {
    const res = await call('DELETE', '/bets/bet-pending?adjust=0', SUPER);
    expect((await res.json()).balanceChange).toBe(0);
    expect(mocks.users.get('user-1').balance).toBe(10);
    expect(mocks.bets.has('bet-pending')).toBe(false);
  });
});

describe('creating the super admin (env / command line)', () => {
  it('creates it when missing, leaves an existing one alone on boot, and promotes + resets on the command line', async () => {
    const { ensureSuperAdmin } = await import('../server/superAdmin.js');
    const rows = [];
    const fake = { query: async (sql, p) => {
      if (sql.startsWith('SELECT id, role FROM users WHERE username')) return { rows: rows.filter((r) => r.username === p[0]).map((r) => ({ id: r.id, role: r.role })) };
      if (sql.startsWith('INSERT INTO users')) { rows.push({ id: p[0], username: p[2], hash: p[3], role: p[4] }); return { rows: [] }; }
      if (sql.startsWith('UPDATE users SET role')) { const r = rows.find((x) => x.id === p[2]); r.role = p[0]; r.hash = p[1]; return { rows: [] }; }
      throw new Error('unmocked ' + sql);
    } };
    expect(await ensureSuperAdmin(fake, {})).toEqual({ status: 'skipped' });
    await expect(ensureSuperAdmin(fake, { username: 'boss', password: '123' })).rejects.toThrow(/at least 6/);
    expect((await ensureSuperAdmin(fake, { username: 'boss', password: 'secret1' })).status).toBe('created');
    expect(rows[0].role).toBe('SUPER_ADMIN');
    const firstHash = rows[0].hash;
    expect((await ensureSuperAdmin(fake, { username: 'boss', password: 'other-pass' })).status).toBe('exists');
    expect(rows[0].hash).toBe(firstHash); // not overwritten on boot
    rows.push({ id: 'a', username: 'old-admin', hash: 'x', role: 'ADMIN' });
    expect((await ensureSuperAdmin(fake, { username: 'old-admin', password: 'secret1' })).status).toBe('username-taken');
    expect((await ensureSuperAdmin(fake, { username: 'old-admin', password: 'secret1', onlyIfMissing: false })).status).toBe('updated');
    expect(rows[1].role).toBe('SUPER_ADMIN');
  });
});
