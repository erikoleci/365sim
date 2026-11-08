import { describe, it, expect } from 'vitest';
import { buildAgentLedger } from '../server/agentCreditLedger.js';

const D = (y, m, d) => Date.UTC(y, m - 1, d, 10);
const agents = [
  { id: 'a1', name: 'Agjenti 1', username: 'ag1', balance: 3000, balance_eur: 10 },
  { id: 'a2', name: 'Agjenti 2', username: 'ag2', balance: 0, balance_eur: 0 },
];
const rows = [
  { id: 1, created_at: D(2026, 11, 1), amount: 10000, currency: 'ALL', type: 'OWNER_TO_AGENT', agent_id: 'a1' },
  { id: 2, created_at: D(2026, 11, 5), amount: 100, currency: 'EUR', type: 'OWNER_TO_AGENT', agent_id: 'a1' },
  { id: 3, created_at: D(2026, 11, 6), amount: 2000, currency: 'ALL', type: 'AGENT_TO_OWNER', agent_id: 'a1' },
  { id: 4, created_at: D(2026, 11, 7), amount: 500, currency: 'ALL', type: 'OWNER_TO_AGENT', agent_id: 'gone' },
];
const pay = [
  { id: 10, created_at: D(2026, 11, 7), amount: -500, currency: 'EUR', type: 'ADMIN_PAYS_WIN', reference: 'b1', ticket_no: 120, username: 'Mbarsi1' },
  { id: 11, created_at: D(2026, 11, 8), amount: 500, currency: 'EUR', type: 'ADMIN_WIN_REVERSAL', reference: 'b1', ticket_no: 120, username: 'Mbarsi1' },
  { id: 12, created_at: D(2026, 11, 8), amount: -2000, currency: 'ALL', type: 'ADMIN_PAYS_WIN', reference: 'b2', ticket_no: 121, username: 'Visi1' },
];

describe('buildAgentLedger', () => {
  const l = buildAgentLedger({ agents, rows, payRows: pay });
  it('per agent: given, taken back, net, what is left; lek and euro apart', () => {
    const a1 = l.agents.find((a) => a.id === 'a1');
    expect(a1.given).toEqual({ ALL: 10000, EUR: 100 });
    expect(a1.takenBack).toEqual({ ALL: 2000, EUR: 0 });
    expect(a1.net).toEqual({ ALL: 8000, EUR: 100 });
    expect(a1.remaining).toEqual({ ALL: 3000, EUR: 10 });
    expect(a1.credits).toBe(2);
    expect(a1.lastCreditAt).toBe(D(2026, 11, 5));
  });
  it('ignores rows of accounts that are not this admin\'s agents', () => {
    expect(l.totals.given).toEqual({ ALL: 10000, EUR: 100 });
    expect(l.history.every((h) => h.agentId === 'a1')).toBe(true);
  });
  it('history is newest first, with date and kind', () => {
    expect(l.history.map((h) => [h.id, h.kind])).toEqual([[3, 'TAKEN'], [2, 'GIVEN'], [1, 'GIVEN']]);
  });
  it('winnings paid: paid, reversed and the net', () => {
    expect(l.winPayouts.paid).toEqual({ ALL: 2000, EUR: 500 });
    expect(l.winPayouts.reversed).toEqual({ ALL: 0, EUR: 500 });
    expect(l.winPayouts.net).toEqual({ ALL: 2000, EUR: 0 });
    expect(l.winPayouts.history[0]).toMatchObject({ kind: expect.any(String), ticketNo: expect.any(Number) });
  });
  it('a date range limits history and the period figures, not the all-time ones', () => {
    const r = buildAgentLedger({ agents, rows, payRows: pay, range: { from: D(2026, 11, 5), to: D(2026, 11, 6) + 3600000 } });
    expect(r.history.map((h) => h.id)).toEqual([3, 2]);
    expect(r.periodTotals.given).toEqual({ ALL: 0, EUR: 100 });
    expect(r.totals.given).toEqual({ ALL: 10000, EUR: 100 });
    expect(r.winPayouts.history).toEqual([]);
  });
  it('one agent only', () => {
    expect(buildAgentLedger({ agents, rows, agentId: 'a2' }).history).toEqual([]);
  });
  it('works with nothing at all', () => {
    const e = buildAgentLedger({ agents: [], rows: [], payRows: [] });
    expect(e.agents).toEqual([]);
    expect(e.winPayouts.net).toEqual({ ALL: 0, EUR: 0 });
  });
});
