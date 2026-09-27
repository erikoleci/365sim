import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';

// Commission model: an agent's commissionRate (%) applies to their users'
// net gaming result (house win = losses - wins, i.e. GGR) for the month.
// Informational -- it never moves balance automatically. These tests cover
// (1) the Owner-only endpoint that sets an agent's rate, with validation,
// and (2) the monthly report's commissionOwed calculation for both a
// winning-for-the-house month and a losing-for-the-house month.

const mocks = vi.hoisted(function () {
  const users = new Map();

  function reset() {
    users.clear();
    users.set('owner-1', { id: 'owner-1', username: 'owner', role: 'ADMIN', is_active: true, commission_rate: 0 });
    users.set('agent-1', { id: 'agent-1', username: 'agent1', role: 'AGENT', is_active: true, commission_rate: 10 });
    users.set('user-1', { id: 'user-1', username: 'user1', role: 'USER', is_active: true, agent_id: 'agent-1', commission_rate: 0 });
  }
  reset();

  function query(sql, params = []) {
    const s = String(sql);
    if (s.startsWith('SELECT id, role, is_active FROM users WHERE id = $1')) {
      const row = users.get(params[0]);
      return Promise.resolve({ rows: row ? [row] : [] });
    }
    if (s.startsWith(`SELECT id FROM users WHERE id = $1 AND role = 'AGENT'`)) {
      const row = users.get(params[0]);
      return Promise.resolve({ rows: row?.role === 'AGENT' ? [{ id: row.id }] : [] });
    }
    if (s.startsWith('UPDATE users SET commission_rate = $1 WHERE id = $2')) {
      const row = users.get(params[1]);
      if (row) row.commission_rate = params[0];
      return Promise.resolve({ rows: [], rowCount: row ? 1 : 0 });
    }
    if (s.startsWith('INSERT INTO audit_log')) {
      return Promise.resolve({ rows: [] });
    }
    // Monthly-report totals query -- shape controlled per-test via
    // mocks.monthlyTotals so we can exercise both a house-won and a
    // house-lost month without needing real bet rows.
    if (s.includes('FROM users u') && s.includes('LEFT JOIN bets b') && s.includes('total_users')) {
      return Promise.resolve({ rows: [mocks.monthlyTotals] });
    }
    if (s.includes('GROUP BY u.id')) {
      return Promise.resolve({ rows: [] });
    }
    if (s.startsWith('SELECT * FROM users WHERE id = $1')) {
      const row = users.get(params[0]);
      return Promise.resolve({ rows: row ? [row] : [] });
    }
    throw new Error('unmocked query: ' + s);
  }

  const pool = { query };
  return {
    users, reset, pool,
    monthlyTotals: { total_users: 1, total_tickets: 10, turnover: 1000, wins: 200, losses: 500, pending: 0 },
  };
});

vi.mock('../server/db.js', () => ({ default: mocks.pool, pool: mocks.pool }));

const { JWT_SECRET } = await import('../server/routes/auth.js');
const adminRouter = (await import('../server/routes/admin.js')).default;
const agentRouter = (await import('../server/routes/agent.js')).default;

beforeEach(() => {
  mocks.reset();
  mocks.monthlyTotals = { total_users: 1, total_tickets: 10, turnover: 1000, wins: 200, losses: 500, pending: 0 };
});

function sign(id, role) {
  return jwt.sign({ id, username: id, role }, JWT_SECRET, { expiresIn: '7d' });
}

let server;
let baseUrl;

beforeEach(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  app.use('/api/agent', agentRouter);
  await new Promise((resolve) => {
    server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
});

afterEach(async () => { await new Promise((resolve) => server.close(resolve)); });

describe('PATCH /api/admin/agents/:id/commission', () => {
  it('lets the Owner set a valid commission rate', async () => {
    const res = await fetch(`${baseUrl}/api/admin/agents/agent-1/commission`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer ' + sign('owner-1', 'ADMIN'), 'content-type': 'application/json' },
      body: JSON.stringify({ commissionRate: 15 }),
    });
    expect(res.status).toBe(200);
    expect(mocks.users.get('agent-1').commission_rate).toBe(15);
  });

  it('rejects an out-of-range rate', async () => {
    const res = await fetch(`${baseUrl}/api/admin/agents/agent-1/commission`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer ' + sign('owner-1', 'ADMIN'), 'content-type': 'application/json' },
      body: JSON.stringify({ commissionRate: 150 }),
    });
    expect(res.status).toBe(400);
    expect(mocks.users.get('agent-1').commission_rate).toBe(10); // unchanged
  });

  it('404s for a non-agent id', async () => {
    const res = await fetch(`${baseUrl}/api/admin/agents/user-1/commission`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer ' + sign('owner-1', 'ADMIN'), 'content-type': 'application/json' },
      body: JSON.stringify({ commissionRate: 5 }),
    });
    expect(res.status).toBe(404);
  });

  it('a non-admin cannot set commission rates', async () => {
    const res = await fetch(`${baseUrl}/api/admin/agents/agent-1/commission`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer ' + sign('agent-1', 'AGENT'), 'content-type': 'application/json' },
      body: JSON.stringify({ commissionRate: 50 }),
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/agent/reports/monthly - commissionOwed', () => {
  it('accrues commission when the house won overall this month (losses > wins)', async () => {
    mocks.monthlyTotals = { total_users: 1, total_tickets: 10, turnover: 1000, wins: 200, losses: 500, pending: 0 };
    const res = await fetch(`${baseUrl}/api/agent/reports/monthly`, {
      headers: { authorization: 'Bearer ' + sign('agent-1', 'AGENT') },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.totals.netResult).toBe(300); // 500 - 200
    expect(body.commissionRate).toBe(10);
    expect(body.commissionOwed).toBe(30); // 300 * 10%
  });

  it('accrues NO commission when the house lost overall this month (wins > losses)', async () => {
    mocks.monthlyTotals = { total_users: 1, total_tickets: 10, turnover: 1000, wins: 900, losses: 100, pending: 0 };
    const res = await fetch(`${baseUrl}/api/agent/reports/monthly`, {
      headers: { authorization: 'Bearer ' + sign('agent-1', 'AGENT') },
    });
    const body = await res.json();
    expect(body.totals.netResult).toBe(-800);
    expect(body.commissionOwed).toBe(0);
  });
});
