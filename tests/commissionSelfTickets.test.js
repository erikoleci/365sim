import { describe, it, expect } from 'vitest';
import { buildCommissionReport } from '../server/commission.js';
const m = (userId, xhiro) => ({ userId, currency: 'ALL', xhiro, fitim: 0, pending: 0, activeTickets: 0, tickets: 1, commission: xhiro * 0.08 });
describe('commission report counts the agent\'s and admin\'s own tickets', () => {
  const admin = { id: 'ad', name: 'LONDON', username: 'london', admin_id: null };
  const agent = { id: 'ag', name: 'Kucova', username: 'kucova', is_active: true, admin_id: 'ad' };
  const user = { id: 'u1', name: 'Tulla', username: 'tulla', is_active: true, admin_id: 'ad', agent_id: 'ag' };
  it('lists the agent as his own first player row and counts him in the agent row, the admin group and the grand total', () => {
    const r = buildCommissionReport({ admins: [admin], agents: [agent], users: [user], metrics: [m('ag', 2100), m('u1', 500), m('ad', 300)] });
    const g = r.groups[0];
    const row = g.rows.find((x) => x.id === 'ag');
    expect(row.players.map((p) => [p.username, p.self])).toEqual([['kucova', true], ['tulla', false]]);
    expect(row.currencies.ALL.xhiro).toBe(2600);
    expect(g.rows.find((x) => x.direct).currencies.ALL.xhiro).toBe(300);
    expect(g.totals.ALL.xhiro).toBe(2900);
    expect(r.totals.ALL.xhiro).toBe(2900);
  });
  it('an agent without tickets of his own adds no row', () => {
    const r = buildCommissionReport({ admins: [admin], agents: [agent], users: [user], metrics: [m('u1', 500)] });
    expect(r.groups[0].rows[0].players.map((p) => p.username)).toEqual(['tulla']);
  });
});
