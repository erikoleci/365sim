import { describe, it, expect } from 'vitest';
import { finishMetrics, buildCommissionReport, emptyMetrics, COMMISSION_SINGLE_PCT, COMMISSION_MULTI_PCT, COMMISSION_STATUSES, userMetrics } from '../server/commission.js';

const m = (o) => ({ ...emptyMetrics(), ...o });

describe('agent commission report', () => {
  it('defaults to 4% (live / single result) and 8% (two or more results)', () => {
    expect(COMMISSION_SINGLE_PCT).toBe(4);
    expect(COMMISSION_MULTI_PCT).toBe(8);
  });
  it('earns commission from the moment a ticket is placed, never on cancelled or refunded ones', () => {
    expect(COMMISSION_STATUSES).toEqual(['PENDING', 'WON', 'LOST']);
  });
  it('passes those statuses to the query (20 stake, single result = 0.80 while the ticket is still open)', async () => {
    let args;
    const pool = { query: async (_sql, a) => { args = a; return { rows: [{ user_id: 'u1', currency: 'EUR', tickets: 1, xhiro: '20', fitim: '0', pending: '20', active_tickets: 1, commission: '0.8' }] }; } };
    const rows = await userMetrics(pool, { rangeStart: 0, rangeEnd: 1 });
    expect(args[6]).toEqual(['PENDING', 'WON', 'LOST']);
    const r = finishMetrics(rows[0]);
    expect(r).toMatchObject({ xhiro: 20, pending: 20, diferenca: 19.2, percAgjentit: 0.8, kompania: 18.4 });
  });
  it('two open tickets of 20 and 10 at 8%: xhiro 30, pending 30, diferenca 27.60, % agjentit 2.40, kompania 25.20', () => {
    const r = finishMetrics(m({ xhiro: 30, pending: 30, activeTickets: 2, tickets: 2, commission: 2.4 }));
    expect(r).toMatchObject({ xhiro: 30, fitim: 0, pending: 30, activeTickets: 2, tickets: 2, diferenca: 27.6, percAgjentit: 2.4, kompania: 25.2 });
  });
  it('a win takes its payout out of diferenca and kompania; a loss changes nothing (the stake was already counted)', () => {
    const open = finishMetrics(m({ xhiro: 30, pending: 30, tickets: 2, commission: 2.4 }));
    const lost = finishMetrics(m({ xhiro: 30, pending: 20, tickets: 2, commission: 2.4 }));
    const won = finishMetrics(m({ xhiro: 30, fitim: 50, pending: 20, tickets: 2, commission: 2.4 }));
    expect(lost.diferenca).toBe(open.diferenca);
    expect(won.diferenca).toBe(-22.4);
    expect(won.kompania).toBe(-24.8);
  });
  it('groups by admin, agent and player and keeps lek and euro apart', () => {
    const admins = [{ id: 'a1', name: 'Admin', username: 'admin' }];
    const agents = [{ id: 'g1', name: 'Agent', username: 'agent', is_active: true, admin_id: 'a1' }];
    const users = [
      { id: 'u1', name: 'Ana', username: 'ana', is_active: true, admin_id: 'a1', agent_id: 'g1' },
      { id: 'u2', name: 'Beni', username: 'beni', is_active: true, admin_id: 'a1', agent_id: 'g1' },
      { id: 'u3', name: 'Dir', username: 'dir', is_active: true, admin_id: 'a1', agent_id: null },
    ];
    const metrics = [
      { userId: 'u1', currency: 'ALL', ...m({ xhiro: 1000, tickets: 1, commission: 40 }) },
      { userId: 'u2', currency: 'ALL', ...m({ xhiro: 500, tickets: 1, commission: 20 }) },
      { userId: 'u1', currency: 'EUR', ...m({ xhiro: 50, tickets: 1, commission: 4 }) },
      { userId: 'u3', currency: 'ALL', ...m({ xhiro: 300, tickets: 1, commission: 12 }) },
    ];
    const r = buildCommissionReport({ admins, agents, users, metrics });
    const [g] = r.groups;
    const agent = g.rows[0];
    expect(agent.currencies.ALL.percAgjentit).toBe(60);     // 40 + 20, only lek
    expect(agent.currencies.EUR.percAgjentit).toBe(4);      // euro kept apart
    expect(agent.players.map((p) => [p.name, p.currencies.ALL.percAgjentit])).toEqual([['Ana', 40], ['Beni', 20]]);
    expect(g.rows[1].direct).toBe(true);
    expect(g.rows[1].currencies.ALL.percAgjentit).toBe(12);
    expect(g.totals.ALL.percAgjentit).toBe(72);
    expect(r.totals.EUR.xhiro).toBe(50);
  });
});
