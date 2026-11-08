import { describe, it, expect } from 'vitest';
import { buildAgentLedger, buildUserCredit } from '../server/agentCreditLedger.js';

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
  { id: 5, created_at: D(2026, 10, 30), amount: 41000, currency: 'ALL', type: 'OWNER_CREATE_AGENT_FUND', agent_id: 'a2' },
  { id: 6, created_at: D(2026, 10, 31), amount: 500, currency: 'EUR', type: 'ADMIN_TO_USER', agent_id: 'a2' },
  { id: 7, created_at: D(2026, 11, 1), amount: 200, currency: 'EUR', type: 'USER_TO_ADMIN', agent_id: 'a2' },
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
  it('the credit an agent was CREATED with counts as credit given (it has its own ledger type)', () => {
    const a2 = l.agents.find((a) => a.id === 'a2');
    expect(a2.given.ALL).toBe(41000);
    expect(l.totals.given).toEqual({ ALL: 51000, EUR: 600 });
    expect(l.history.some((h) => h.id === 5 && h.kind === 'GIVEN')).toBe(true);
  });
  it('credit given with the generic credit button (ADMIN_TO_USER, also euro) counts, and USER_TO_ADMIN counts as taken back', () => {
    const a2 = l.agents.find((a) => a.id === 'a2');
    expect(a2.given).toEqual({ ALL: 41000, EUR: 500 });
    expect(a2.takenBack).toEqual({ ALL: 0, EUR: 200 });
    expect(a2.net).toEqual({ ALL: 41000, EUR: 300 });
  });
  it('ignores rows of accounts that are not this admin\'s agents', () => {
    expect(l.history.some((h) => h.agentId === 'gone')).toBe(false);
  });
  it('history is newest first, with date and kind', () => {
    expect(l.history.map((h) => [h.id, h.kind])).toEqual([[3, 'TAKEN'], [2, 'GIVEN'], [7, 'TAKEN'], [1, 'GIVEN'], [6, 'GIVEN'], [5, 'GIVEN']]);
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
    expect(r.totals.given).toEqual({ ALL: 51000, EUR: 600 });
    expect(r.winPayouts.history).toEqual([]);
  });
  it('one agent only', () => {
    expect(buildAgentLedger({ agents, rows, agentId: 'a2' }).history.map((h) => h.id)).toEqual([7, 6, 5]);
  });
  it('works with nothing at all', () => {
    const e = buildAgentLedger({ agents: [], rows: [], payRows: [] });
    expect(e.agents).toEqual([]);
    expect(e.winPayouts.net).toEqual({ ALL: 0, EUR: 0 });
  });
});

describe('buildUserCredit (credit given directly to players)', () => {
  const users = [
    { id: 'u1', name: 'Visi', username: 'visi1', balance: 800, balance_eur: 0, agent_id: null },
    { id: 'u2', name: 'Mbarsi', username: 'mbarsi1', balance: 0, balance_eur: 120, agent_id: 'a1' },
    { id: 'u3', name: 'Asnje', username: 'asnje', balance: 5, balance_eur: 0, agent_id: null },
  ];
  const rows = [
    { id: 1, created_at: D(2026, 11, 1), amount: 1000, currency: 'ALL', type: 'ADMIN_TO_USER', user_id: 'u1' },
    { id: 2, created_at: D(2026, 11, 3), amount: 200, currency: 'ALL', type: 'USER_TO_ADMIN', user_id: 'u1' },
    { id: 3, created_at: D(2026, 11, 4), amount: 100, currency: 'EUR', type: 'ADMIN_TO_USER', user_id: 'u2' },
    { id: 4, created_at: D(2026, 11, 4), amount: 50, currency: 'ALL', type: 'ADMIN_TO_USER', user_id: 'someone-else' },
  ];
  const r = buildUserCredit({ users, rows });
  it('per player: given, taken back, net, what he has; euro apart from lek', () => {
    const u1 = r.list.find((u) => u.id === 'u1');
    expect(u1).toMatchObject({ given: { ALL: 1000, EUR: 0 }, takenBack: { ALL: 200, EUR: 0 }, net: { ALL: 800, EUR: 0 }, remaining: { ALL: 800, EUR: 0 } });
    expect(r.list.find((u) => u.id === 'u2').given).toEqual({ ALL: 0, EUR: 100 });
  });
  it('players who never got credit are not listed, nor are unknown accounts', () => {
    expect(r.list.map((u) => u.id).sort()).toEqual(['u1', 'u2']);
    expect(r.history.map((h) => h.id)).toEqual([3, 2, 1]);
  });
  it('totals and a date range', () => {
    expect(r.totals.given).toEqual({ ALL: 1000, EUR: 100 });
    const only = buildUserCredit({ users, rows, range: { from: D(2026, 11, 3), to: D(2026, 11, 4) + 3600000 } });
    expect(only.history.map((h) => h.id)).toEqual([3, 2]);
    expect(only.totals.given).toEqual({ ALL: 0, EUR: 100 });
  });
});
