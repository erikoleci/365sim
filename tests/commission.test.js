import { describe, it, expect } from 'vitest';
import { finishMetrics, buildCommissionReport, emptyMetrics, COMMISSION_SINGLE_PCT, COMMISSION_MULTI_PCT } from '../server/commission.js';

const m = (o) => ({ ...emptyMetrics(), ...o });

describe('agent commission report', () => {
  it('defaults to 4% (live / single result) and 8% (two or more results)', () => {
    expect(COMMISSION_SINGLE_PCT).toBe(4);
    expect(COMMISSION_MULTI_PCT).toBe(8);
  });
  it('uses the owner sheet convention: kompania = diferenca + commission, % agjentit shown negative', () => {
    // 2,500 staked, nothing won, 8% commission = 200  ->  -2,500 / -200 / -2,300
    const r = finishMetrics(m({ xhiro: 2500, tickets: 3, commission: 200 }));
    expect(r).toMatchObject({ xhiro: 2500, fitim: 0, diferenca: -2500, percAgjentit: -200, kompania: -2300, tickets: 3 });
  });
  it('open tickets stay out of diferenca (they are in "në pritje")', () => {
    const r = finishMetrics(m({ xhiro: 1000, pending: 400, activeTickets: 2, tickets: 5, commission: 24 }));
    expect(r.diferenca).toBe(-600);
    expect(r.pending).toBe(400);
    expect(r.activeTickets).toBe(2);
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
    expect(agent.currencies.ALL.percAgjentit).toBe(-60);     // 40 + 20, only lek
    expect(agent.currencies.EUR.percAgjentit).toBe(-4);      // euro kept apart
    expect(agent.players.map((p) => [p.name, p.currencies.ALL.percAgjentit])).toEqual([['Ana', -40], ['Beni', -20]]);
    expect(g.rows[1].direct).toBe(true);
    expect(g.rows[1].currencies.ALL.percAgjentit).toBe(-12);
    expect(g.totals.ALL.percAgjentit).toBe(-72);
    expect(r.totals.EUR.xhiro).toBe(50);
  });
});
