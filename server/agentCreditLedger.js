// The admin's book of the credit he gave to his AGENTS (and took back), and of the winnings he paid to players
// (ADMIN_PAYS_WIN, see matchSettlement.js). Pure (no database), so it can be tested alone. Lek and euro are never added.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const zero = () => ({ ALL: 0, EUR: 0 });
const cur = (c) => (c === 'EUR' ? 'EUR' : 'ALL');
const bound = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const fix = (d) => ({ ALL: round2(d.ALL), EUR: round2(d.EUR) });

/**
 * agents:  [{ id, name, username, balance, balance_eur }]
 * rows:    [{ id, created_at, amount, currency, type: 'OWNER_TO_AGENT' | 'OWNER_CREATE_AGENT_FUND' (the credit an agent was created with) | 'AGENT_TO_OWNER', agent_id }]
 * payRows: [{ id, created_at, amount, currency, type: 'ADMIN_PAYS_WIN' | 'ADMIN_WIN_REVERSAL', reference, ticket_no, username }]
 *          ADMIN_PAYS_WIN rows carry a NEGATIVE amount (taken off the admin), ADMIN_WIN_REVERSAL a positive one.
 */
export function buildAgentLedger({ agents, rows, payRows = [], agentId = null, limit = 300, range = null }) {
  const from = range ? bound(range.from) : null;
  const to = range ? bound(range.to) : null;
  const inRange = (at) => (from == null || at >= from) && (to == null || at <= to);
  const ranged = from != null || to != null;
  const newPeriod = () => ({ given: zero(), takenBack: zero(), credits: 0 });
  const per = new Map();
  for (const a of agents) {
    per.set(a.id, {
      id: a.id, name: a.name, username: a.username,
      remaining: { ALL: round2(a.balance), EUR: round2(a.balance_eur) },
      given: zero(), takenBack: zero(), credits: 0, lastCreditAt: null, period: newPeriod(),
    });
  }
  const history = [];
  for (const r of rows || []) {
    const a = per.get(r.agent_id);
    if (!a) continue; // not one of this admin's agents (any more)
    const c = cur(r.currency);
    const amount = Number(r.amount) || 0;
    const at = Number(r.created_at) || 0;
    const given = r.type === 'OWNER_TO_AGENT' || r.type === 'OWNER_CREATE_AGENT_FUND';
    if (given) { a.given[c] += amount; a.credits += 1; if (a.lastCreditAt == null || at > a.lastCreditAt) a.lastCreditAt = at; }
    else a.takenBack[c] += amount;
    if (inRange(at)) {
      if (given) { a.period.given[c] += amount; a.period.credits += 1; } else a.period.takenBack[c] += amount;
    }
    if (inRange(at) && (!agentId || r.agent_id === agentId)) {
      history.push({ id: r.id, at, agentId: r.agent_id, agentName: a.name, agentUsername: a.username, currency: c, amount: round2(amount), kind: given ? 'GIVEN' : 'TAKEN' });
    }
  }
  const totals = { given: zero(), takenBack: zero(), net: zero(), remaining: zero() };
  const periodTotals = newPeriod();
  const list = [...per.values()].map((a) => {
    const net = { ALL: a.given.ALL - a.takenBack.ALL, EUR: a.given.EUR - a.takenBack.EUR };
    for (const c of ['ALL', 'EUR']) {
      totals.given[c] += a.given[c]; totals.takenBack[c] += a.takenBack[c]; totals.net[c] += net[c]; totals.remaining[c] += a.remaining[c];
      periodTotals.given[c] += a.period.given[c]; periodTotals.takenBack[c] += a.period.takenBack[c];
    }
    periodTotals.credits += a.period.credits;
    return { ...a, net: fix(net), given: fix(a.given), takenBack: fix(a.takenBack), period: { ...a.period, given: fix(a.period.given), takenBack: fix(a.period.takenBack) } };
  }).sort((x, y) => (y.lastCreditAt || 0) - (x.lastCreditAt || 0) || String(x.name).localeCompare(String(y.name)));

  // Winnings the admin paid to players: `paid` is what was taken off him, `reversed` what came back (a win taken back).
  const pay = { paid: zero(), reversed: zero(), net: zero(), period: { paid: zero(), reversed: zero() }, history: [] };
  for (const r of payRows || []) {
    const c = cur(r.currency);
    const amount = Number(r.amount) || 0; // signed
    const at = Number(r.created_at) || 0;
    const paid = r.type === 'ADMIN_PAYS_WIN';
    (paid ? pay.paid : pay.reversed)[c] += Math.abs(amount);
    if (inRange(at)) {
      (paid ? pay.period.paid : pay.period.reversed)[c] += Math.abs(amount);
      pay.history.push({ id: r.id, at, currency: c, amount: round2(Math.abs(amount)), kind: paid ? 'PAID' : 'REVERSED', ticketNo: r.ticket_no == null ? null : Number(r.ticket_no), username: r.username || null });
    }
  }
  for (const c of ['ALL', 'EUR']) pay.net[c] = pay.paid[c] - pay.reversed[c];
  const byTime = (x, y) => y.at - x.at || Number(y.id) - Number(x.id);
  history.sort(byTime);
  pay.history.sort(byTime);
  return {
    agents: list,
    totals: { given: fix(totals.given), takenBack: fix(totals.takenBack), net: fix(totals.net), remaining: fix(totals.remaining) },
    periodTotals: ranged ? { ...periodTotals, given: fix(periodTotals.given), takenBack: fix(periodTotals.takenBack) } : undefined,
    history: history.slice(0, limit),
    winPayouts: {
      paid: fix(pay.paid), reversed: fix(pay.reversed), net: fix(pay.net),
      period: ranged ? { paid: fix(pay.period.paid), reversed: fix(pay.period.reversed) } : undefined,
      history: pay.history.slice(0, limit),
    },
  };
}
