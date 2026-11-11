import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';

// Only the super admin can read or change the maths of the casino; every change (and reset) is written to the audit log.
const mocks = vi.hoisted(() => {
  const users = new Map(); const kv = new Map(); const calls = { audit: [], deletes: [] };
  const reset = () => {
    users.clear(); kv.clear(); calls.audit = []; calls.deletes = [];
    users.set('super-1', { id: 'super-1', username: 'boss', role: 'SUPER_ADMIN', is_active: true });
    users.set('admin-1', { id: 'admin-1', username: 'admin1', role: 'ADMIN', is_active: true });
    users.set('agent-1', { id: 'agent-1', username: 'agent1', role: 'AGENT', is_active: true });
    users.set('user-1', { id: 'user-1', username: 'user1', role: 'USER', is_active: true });
  };
  reset();
  async function query(sql, params = []) {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT * FROM users WHERE id = $1') || s.startsWith('SELECT id, role') ) { const r = users.get(params[0]); return { rows: r ? [r] : [] }; }
    if (s.startsWith('SELECT value FROM kv_store WHERE key = $1')) return { rows: kv.has(params[0]) ? [{ value: kv.get(params[0]) }] : [] };
    if (s.startsWith('INSERT INTO kv_store')) { kv.set(params[0], params[1]); return { rows: [] }; }
    if (s.startsWith('INSERT INTO audit_log')) { calls.audit.push({ actor: params[1], action: params[2], target: params[3], details: JSON.parse(params[4] || '{}') }); return { rows: [] }; }
    if (s.startsWith('SELECT actor_username, action, target, details, created_at FROM audit_log')) return { rows: calls.audit.map((a) => ({ actor_username: a.actor, action: a.action, target: a.target, details: JSON.stringify(a.details), created_at: 1 })) };
    if (s.includes('FROM casino_rounds WHERE status')) return { rows: ['wheel', 'sugar-cascade', 'hot-fruits', 'slots:fruit'].map((game) => ({ game, rounds: 10, hits: 2, net: 1, x5: 0, x20: 0, x100: 0, staked: '10', paid: '3' })) };
    if (s.startsWith('DELETE FROM casino_rounds WHERE user_id = $1')) { calls.deletes.push(params[0]); return { rows: [], rowCount: 4 }; }
    throw new Error('unmocked query: ' + s);
  }
  const pool = { query, connect: async () => ({ query, release() {} }) };
  return { users, kv, calls, reset, pool };
});
vi.mock('../server/db.js', () => ({ default: mocks.pool, pool: mocks.pool }));

const { JWT_SECRET } = await import('../server/routes/auth.js');
const adminRouter = (await import('../server/routes/admin.js')).default;
const { clearProfileCache } = await import('../server/casinoProfiles.js');
const sign = (id, role) => jwt.sign({ id, username: id, role }, JWT_SECRET, { expiresIn: '1h' });
let server; let baseUrl;
beforeEach(async () => {
  mocks.reset(); clearProfileCache();
  const app = express(); app.use(express.json()); app.use('/api/admin', adminRouter);
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
});
afterEach(async () => { await new Promise((resolve) => server.close(resolve)); });
const call = (method, path, as, body) => fetch(`${baseUrl}/api/admin${path}`, {
  method, headers: { ...(as ? { authorization: `Bearer ${sign(...as)}` } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
const SUPER = ['super-1', 'SUPER_ADMIN']; const ADMIN = ['admin-1', 'ADMIN']; const AGENT = ['agent-1', 'AGENT']; const USER = ['user-1', 'USER'];
const ENDPOINTS = [
  ['GET', '/casino/profiles'], ['PUT', '/casino/profiles/wheel', { hitFrequency: 0.5 }], ['POST', '/casino/profiles/wheel/reset'],
  ['GET', '/casino/profiles-audit'], ['POST', '/casino/reset-test-stats'],
];

describe('who can touch the casino maths', () => {
  it('nobody without a token, no player, no agent and no normal admin', async () => {
    for (const [m, path, body] of ENDPOINTS) {
      expect((await call(m, path, null, body)).status, `${m} ${path} anonymous`).toBe(401);
      for (const who of [USER, AGENT, ADMIN]) expect((await call(m, path, who, body)).status, `${m} ${path} ${who[1]}`).toBe(403);
    }
    expect(mocks.kv.size).toBe(0); expect(mocks.calls.audit).toHaveLength(0); expect(mocks.calls.deletes).toHaveLength(0);
  });
  it('the super admin reads all games (26 + 30 slots) with settings, preview, rules and measured results', async () => {
    const body = await (await call('GET', '/casino/profiles', SUPER)).json();
    expect(body.profiles).toHaveLength(56);
    expect(body.profiles.every((p) => p.values && p.defaults && p.kind)).toBe(true);
    const wheel = body.profiles.find((p) => p.key === 'wheel');
    expect(wheel.preview.rtp).toBeCloseTo(0.3, 6); expect(wheel.measured.rounds).toBe(10);
    for (const k of ['tumble', 'slot:hot-fruits', 'slots']) expect(body.profiles.find((p) => p.key === k).measured.rounds, `measured ${k}`).toBe(10);
    const roulette = body.profiles.find((p) => p.key === 'roulette');
    expect(roulette.kind).toBe('bets'); expect(roulette.rules).toMatch(/fixed by the rules/i); expect(roulette.preview).toBeNull();
  });
});

describe('every change is audited and validated', () => {
  it('a change is saved, audited with before/after, and a reset is audited too', async () => {
    const r = await call('PUT', '/casino/profiles/wheel', SUPER, { hitFrequency: 0.4, rtp: 0.5, volatility: 2 });
    expect(r.status).toBe(200);
    expect(JSON.parse(mocks.kv.get('casino_profiles')).wheel).toMatchObject({ hitFrequency: 0.4, rtp: 0.5, volatility: 2 });
    expect(mocks.calls.audit).toHaveLength(1);
    expect(mocks.calls.audit[0]).toMatchObject({ actor: 'super-1', action: 'CASINO_PROFILE', target: 'wheel' });
    expect(mocks.calls.audit[0].details.before.hitFrequency).toBe(0.15); expect(mocks.calls.audit[0].details.after.hitFrequency).toBe(0.4);
    expect((await call('POST', '/casino/profiles/wheel/reset', SUPER)).status).toBe(200);
    expect(mocks.calls.audit.map((a) => a.action)).toEqual(['CASINO_PROFILE', 'CASINO_PROFILE_RESET']);
    const log = await (await call('GET', '/casino/profiles-audit', SUPER)).json();
    expect(log.entries).toHaveLength(2);
  });
  it('bad input is refused and nothing is saved or audited', async () => {
    for (const body of [{ hitFrequency: 2 }, { rtp: 0 }, { volatility: 9 }, { hack: 1 }, { rtp: '0.5' }, { minBet: 100, maxBet: 10 }, { hitFrequency: 0.9, rtp: 0.05 }, { rtp: 0.9, maxWinMultiplier: 2 }, []]) {
      expect((await call('PUT', '/casino/profiles/wheel', SUPER, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await call('PUT', '/casino/profiles/nope', SUPER, { rtp: 0.5 })).status).toBe(404);
    expect((await call('PUT', '/casino/profiles/roulette', SUPER, { rtp: 0.5 })).status).toBe(400); // rules fix roulette: no rtp setting
    expect(mocks.kv.size).toBe(0); expect(mocks.calls.audit).toHaveLength(0);
  });
  it('reset-test-stats only deletes the super admin\'s own rounds, and is audited', async () => {
    const r = await call('POST', '/casino/reset-test-stats', SUPER);
    expect(r.status).toBe(200); expect(mocks.calls.deletes).toEqual(['super-1']);
    expect(mocks.calls.audit.map((a) => a.action)).toContain('CASINO_RESET_TEST_STATS');
  });
});
