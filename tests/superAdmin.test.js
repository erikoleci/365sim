import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';

// SUPER_ADMIN: above the admin. Gives credit to admins (an admin never to an admin, not even to
// himself), creates / deletes admins, erases any ticket.

const mocks = vi.hoisted(() => {
  const users = new Map();
  const bets = new Map();
  const calls = { transfers: [], queries: [], audit: [] };
  const kv = new Map();
  function reset() {
    users.clear(); bets.clear(); kv.clear(); calls.transfers = []; calls.queries = []; calls.audit = [];
    users.set('super-1', { id: 'super-1', username: 'boss', role: 'SUPER_ADMIN', is_active: true, balance: 0 });
    users.set('admin-1', { id: 'admin-1', username: 'admin1', role: 'ADMIN', is_active: true, balance: 100 });
    users.set('admin-2', { id: 'admin-2', username: 'admin2', role: 'ADMIN', is_active: true, balance: 100 });
    users.set('agent-1', { id: 'agent-1', username: 'agent1', role: 'AGENT', is_active: true, balance: 50, admin_id: 'admin-1' });
    users.set('user-1', { id: 'user-1', username: 'user1', role: 'USER', is_active: true, balance: 10, agent_id: 'agent-1', admin_id: 'admin-1' });
    users.set('agent-2', { id: 'agent-2', username: 'agent2', role: 'AGENT', is_active: true, balance: 50, admin_id: 'admin-2' });
    users.set('user-2', { id: 'user-2', username: 'user2', role: 'USER', is_active: true, balance: 10, agent_id: 'agent-2', admin_id: 'admin-2' });
    bets.set('bet-pending', { id: 'bet-pending', user_id: 'user-1', stake: 10, potential_return: 30, status: 'PENDING' });
    bets.set('bet-won', { id: 'bet-won', user_id: 'user-1', stake: 10, potential_return: 30, status: 'WON' });
    bets.set('bet-void', { id: 'bet-void', user_id: 'user-1', stake: 10, potential_return: 30, status: 'VOID' });
  }
  reset();
  async function query(sql, params = []) {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    calls.queries.push(s);
    // --- ownership (users.admin_id): who may see / manage which row ---
    if (s.startsWith('SELECT * FROM users WHERE ($3::text IS NULL OR admin_id = $3 OR id = $3)')) return { rows: [...users.values()].filter((u) => params[2] == null || u.admin_id === params[2] || u.id === params[2]) };
    if (s.startsWith('SELECT COUNT(*)::int AS count FROM users WHERE ($1::text IS NULL OR admin_id = $1 OR id = $1)')) return { rows: [{ count: [...users.values()].filter((u) => params[0] == null || u.admin_id === params[0] || u.id === params[0]).length }] };
    if (s.startsWith("SELECT id, admin_id FROM users WHERE id = $1 AND role = 'AGENT'")) { const r = users.get(params[0]); return { rows: r?.role === 'AGENT' ? [{ id: r.id, admin_id: r.admin_id ?? null }] : [] }; }
    if (s.startsWith("SELECT id, username FROM users WHERE id = $1 AND role = 'AGENT'")) { const r = users.get(params[0]); return { rows: r?.role === 'AGENT' ? [{ id: r.id, username: r.username }] : [] }; }
    if (s.startsWith("SELECT id FROM users WHERE id = $1 AND role = 'ADMIN'")) { const r = users.get(params[0]); return { rows: r?.role === 'ADMIN' ? [{ id: r.id }] : [] }; }
    if (s.startsWith('SELECT id, role, admin_id FROM users WHERE id = $1')) { const r = users.get(params[0]); return { rows: r ? [{ id: r.id, role: r.role, admin_id: r.admin_id ?? null }] : [] }; }
    if (s.startsWith('SELECT admin_id FROM users WHERE id = $1')) { const r = users.get(params[0]); return { rows: r ? [{ admin_id: r.admin_id ?? null }] : [] }; }
    if (s.startsWith('UPDATE users SET admin_id = NULL WHERE admin_id = $1')) { for (const u of users.values()) if (u.admin_id === params[0]) u.admin_id = null; return { rows: [] }; }
    if (s.startsWith('UPDATE users SET admin_id = $1 WHERE id = $2 OR agent_id = $2')) { let n = 0; for (const u of users.values()) if (u.id === params[1] || u.agent_id === params[1]) { u.admin_id = params[0]; n++; } return { rows: [], rowCount: n }; }
    if (s.startsWith('SELECT id, role, is_active FROM users WHERE id = $1')) { const r = users.get(params[0]); return { rows: r ? [r] : [] }; }
    if (s.startsWith('SELECT * FROM users WHERE id = $1 AND role = \'ADMIN\'')) { const r = users.get(params[0]); return { rows: r?.role === 'ADMIN' ? [r] : [] }; }
    if (s.startsWith('SELECT * FROM users WHERE id = $1') || s.startsWith('SELECT id, role FROM users WHERE id = $1')) { const r = users.get(params[0]); return { rows: r ? [r] : [] }; }
    if (s.startsWith('SELECT id FROM users WHERE username = $1')) { const r = [...users.values()].find((u) => u.username === params[0]); return { rows: r ? [{ id: r.id }] : [] }; }
    if (s.startsWith('UPDATE users SET balance = balance + $1 WHERE id = $2')) { users.get(params[1]).balance += params[0]; return { rows: [] }; }
    if (s.startsWith('INSERT INTO users')) { users.set(params[0], { id: params[0], name: params[1], username: params[2], role: 'ADMIN', is_active: true, balance: params[4] }); return { rows: [] }; }
    if (s.startsWith('SELECT value FROM kv_store WHERE key = $1')) return { rows: kv.has(params[0]) ? [{ value: kv.get(params[0]) }] : [] };
    if (s.startsWith('INSERT INTO kv_store')) { kv.set(params[0], params[1]); return { rows: [] }; }
    if (s.startsWith("SELECT COALESCE(SUM(CASE WHEN status = 'LOST'")) return { rows: [{ profit: '100', loss: '30', tickets_open: 2, tickets_won: 3, tickets_lost: 4 }] };
    if (s.startsWith('SELECT COALESCE(SUM(stake),0) AS turnover, COALESCE(SUM(potential_return),0) AS liability')) return { rows: [{ turnover: '50', liability: '200', open_bets: 2 }] };
    if (s.startsWith("SELECT COALESCE(SUM(stake),0) AS turnover, COALESCE(SUM(CASE WHEN status = 'WON' THEN potential_return")) return { rows: [{ turnover: '500', paid_out: '350' }] };
    if (s.startsWith('SELECT COUNT(*)::int AS c FROM users')) return { rows: [{ c: users.size }] };
    if (s.startsWith('SELECT * FROM bets WHERE id = $1')) { const b = bets.get(params[0]); return { rows: b ? [b] : [] }; }
    if (s.startsWith('DELETE FROM bets WHERE id = $1')) { bets.delete(params[0]); return { rows: [] }; }
    if (s.startsWith('SELECT * FROM users ORDER BY created_at')) return { rows: [...users.values()] };
    if (s.startsWith('SELECT COUNT(*)::int AS count FROM users')) return { rows: [{ count: users.size }] };
    if (s.startsWith('INSERT INTO audit_log')) { calls.audit.push({ actor_id: params[0], action: params[2] }); return { rows: [] }; }
    if (s.startsWith('SELECT * FROM audit_log ORDER BY')) return { rows: calls.audit };
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK' || s.startsWith('DELETE FROM bet_selections')) return { rows: [] };
    throw new Error('unmocked query: ' + s);
  }
  const client = { query, release() {} };
  const pool = { query, connect: async () => client };
  return { users, bets, kv, calls, reset, pool };
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

describe('visibility', () => {
  it('a normal admin never sees the super admin account; the super admin sees everyone', async () => {
    const asAdmin = (await (await call('GET', '/users', ADMIN)).json()).users.map((u) => u.id);
    expect(asAdmin).not.toContain('super-1');
    expect(asAdmin).toContain('admin-1');
    const asSuper = (await (await call('GET', '/users', SUPER)).json()).users.map((u) => u.id);
    expect(asSuper).toContain('super-1');
  });
});

describe('every admin owns his own agents and users', () => {
  it('a normal admin sees himself, his agents and their users, nobody else; the super admin sees everyone', async () => {
    const ids = async (as) => (await (await call('GET', '/users', as)).json()).users.map((u) => u.id).sort();
    expect(await ids(ADMIN)).toEqual(['admin-1', 'agent-1', 'user-1']);
    expect(await ids(['admin-2', 'ADMIN'])).toEqual(['admin-2', 'agent-2', 'user-2']);
    const all = await ids(SUPER);
    for (const id of ['super-1', 'admin-1', 'admin-2', 'agent-1', 'agent-2', 'user-1', 'user-2']) expect(all).toContain(id);
  });
  it('an admin cannot touch another admin\'s agent, user or ticket (404), but can touch his own', async () => {
    expect((await call('POST', '/agents/agent-2/credit', ADMIN, { amount: 5 })).status).toBe(404);
    expect((await call('POST', '/agents/agent-2/debit', ADMIN, { amount: 5 })).status).toBe(404);
    expect((await call('PATCH', '/agents/agent-2/commission', ADMIN, { commissionRate: 5 })).status).toBe(404);
    expect((await call('GET', '/agents/agent-2/performance', ADMIN)).status).toBe(404);
    expect((await call('POST', '/users/user-2/credit', ADMIN, { amount: 5 })).status).toBe(404);
    expect((await call('POST', '/users/user-2/reset-password', ADMIN, { password: 'newpass1' })).status).toBe(404);
    expect((await call('DELETE', '/users/user-2', ADMIN)).status).toBe(404);
    mocks.bets.set('bet-other', { id: 'bet-other', user_id: 'user-2', stake: 5, potential_return: 10, status: 'PENDING' });
    expect((await call('POST', '/bets/bet-other/cancel', ADMIN)).status).toBe(404);
    expect(mocks.bets.has('bet-other')).toBe(true);
    expect((await call('POST', '/users/user-1/credit', ADMIN, { amount: 5 })).status).toBe(200); // his own
  });
  it('only the super admin hands an agent (with his users) over to another admin', async () => {
    expect((await call('PATCH', '/agents/agent-1/admin', ADMIN, { adminId: 'admin-2' })).status).toBe(403);
    expect((await call('PATCH', '/agents/agent-1/admin', SUPER, { adminId: 'user-1' })).status).toBe(400); // not an admin
    expect((await call('PATCH', '/agents/agent-1/admin', SUPER, { adminId: 'admin-2' })).status).toBe(200);
    const ids = async (as) => (await (await call('GET', '/users', as)).json()).users.map((u) => u.id).sort();
    expect(await ids(['admin-2', 'ADMIN'])).toEqual(['admin-2', 'agent-1', 'agent-2', 'user-1', 'user-2']);
    expect(await ids(ADMIN)).toEqual(['admin-1']);
    expect((await call('PATCH', '/agents/agent-1/admin', SUPER, { adminId: null })).status).toBe(200); // unowned again
    expect(await ids(['admin-2', 'ADMIN'])).toEqual(['admin-2', 'agent-2', 'user-2']);
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
    expect((await call('DELETE', '/users/admin-2', ADMIN)).status).toBe(404); // another admin's account is not even visible to him
    expect((await call('DELETE', '/users/admin-2/force', ADMIN)).status).toBe(404);
    expect((await call('DELETE', '/users/admin-1', ADMIN)).status).toBe(404); // himself: not one of "his" rows, and an admin is never deleted by an admin
    expect((await call('DELETE', '/users/admin-1', SUPER)).status).toBe(200);
    expect((await call('DELETE', '/users/super-1', SUPER)).status).toBe(400);
    expect((await call('DELETE', '/users/user-1', ['admin-2', 'ADMIN'])).status).toBe(404); // another admin's user
    expect((await call('DELETE', '/users/user-2', ['admin-2', 'ADMIN'])).status).toBe(200); // his own user
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


describe('markets and settlement tools are the super admin\'s', () => {
  const PATHS = [
    ['GET', '/market-coverage'], ['GET', '/pending-legs'], ['POST', '/legs/settle'], ['PATCH', '/bet-selections/1'],
    ['POST', '/matches/m1/settle'], ['GET', '/risk/exposure'], ['GET', '/london365/status'], ['POST', '/london365/import'],
    ['GET', '/unmapped-vc'], ['GET', '/corner-diagnose'], ['GET', '/recent-errors'], ['GET', '/vc-codes'],
    ['GET', '/provider-labels'], ['GET', '/feed-keys'], ['GET', '/settle-diagnose'], ['POST', '/bets/settle-stuck'],
  ];
  it('a normal admin gets 403 on every one of them, an agent and a user too', async () => {
    for (const [m, path] of PATHS) {
      const body = m === 'GET' ? undefined : {};
      expect((await call(m, path, ADMIN, body)).status, m + ' ' + path).toBe(403);
      expect((await call(m, path, ['agent-1', 'AGENT'], body)).status, m + ' ' + path).toBe(403);
    }
  });
  it('what a normal admin keeps still works', async () => {
    expect((await call('GET', '/users', ADMIN)).status).toBe(200);
    expect((await call('GET', '/dashboard/kpi', ADMIN)).status).toBe(200);
    expect((await call('GET', '/settings', ADMIN)).status).toBe(200);
  });
});

describe('dashboard figures', () => {
  it('a normal admin only gets profit, loss, net and the ticket counts', async () => {
    const k = await (await call('GET', '/dashboard/kpi', ADMIN)).json();
    expect(k).toEqual({ profit: 100, loss: 30, net: 70, ticketsOpen: 2, ticketsWon: 3, ticketsLost: 4 });
  });
  it('the super admin gets those plus the full picture', async () => {
    const k = await (await call('GET', '/dashboard/kpi', SUPER)).json();
    expect(k).toMatchObject({ profit: 100, loss: 30, net: 70, ticketsOpen: 2, ticketsWon: 3, ticketsLost: 4, turnover: 550, openLiability: 200, openBets: 2, ggr: 150 });
    expect(k.totalUsers).toBeGreaterThan(0);
  });
});

describe('ticket deletion switch', () => {
  it('on by default: an admin deletes a ticket (stake back), everybody reads the switch', async () => {
    expect((await (await call('GET', '/settings', ADMIN)).json()).ticketDeletionAllowed).toBe(true);
    const res = await call('POST', '/bets/bet-pending/cancel', ADMIN);
    expect(res.status).toBe(200);
    expect(mocks.bets.has('bet-pending')).toBe(false);
    expect(mocks.users.get('user-1').balance).toBe(20);        // stake of 10 back
  });
  it('only the super admin flips it, and then admins can no longer delete', async () => {
    expect((await call('PUT', '/settings/ticket-deletion', ADMIN, { allowed: false })).status).toBe(403);
    expect((await call('PUT', '/settings/ticket-deletion', SUPER, { allowed: 'no' })).status).toBe(400);
    const off = await call('PUT', '/settings/ticket-deletion', SUPER, { allowed: false });
    expect(off.status).toBe(200);
    expect((await off.json()).ticketDeletionAllowed).toBe(false);
    expect((await (await call('GET', '/settings', ADMIN)).json()).ticketDeletionAllowed).toBe(false);
    const blocked = await call('POST', '/bets/bet-pending/cancel', ADMIN);
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).code).toBe('TICKET_DELETE_DISABLED');
    expect(mocks.bets.has('bet-pending')).toBe(true);
    expect(mocks.users.get('user-1').balance).toBe(10);        // nothing moved
    // the super admin always can (his own delete route, and the admin route too)
    expect((await call('DELETE', '/bets/bet-pending', SUPER)).status).toBe(200);
    // and turning it back on gives the admins their button again
    await call('PUT', '/settings/ticket-deletion', SUPER, { allowed: true });
    expect((await call('POST', '/bets/bet-won/cancel', ADMIN)).status).toBe(200);
  });
  it('the switch is logged; the log itself is the super admin\'s alone (an admin gets 403)', async () => {
    await call('PUT', '/settings/ticket-deletion', SUPER, { allowed: false });
    expect(mocks.calls.audit.some((a) => a.action === 'SETTING_TICKET_DELETION' && a.actor_id === 'super-1')).toBe(true);
    expect((await call('GET', '/audit-log', ADMIN)).status).toBe(403);
    const forSuper = (await (await call('GET', '/audit-log', SUPER)).json()).entries;
    expect(forSuper.some((e) => e.action === 'SETTING_TICKET_DELETION')).toBe(true);
  });
  it('an admin deleting a ticket takes back winnings, and a refunded (VOID) ticket does not refund twice', async () => {
    expect((await call('POST', '/bets/bet-won/cancel', ADMIN)).status).toBe(200);
    expect(mocks.users.get('user-1').balance).toBe(-10);       // 10 - (30 - 10) winnings taken back
    mocks.users.get('user-1').balance = 10;
    expect((await call('POST', '/bets/bet-void/cancel', ADMIN)).status).toBe(200);
    expect(mocks.users.get('user-1').balance).toBe(10);        // it was refunded already: nothing added again
    expect((await call('POST', '/bets/nope/cancel', ADMIN)).status).toBe(404);
  });
});
