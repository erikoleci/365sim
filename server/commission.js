// Agent commission.
//   - tickets with a single result (live or not; a 45/90 pick counts as two results) ............ COMMISSION_SINGLE_PCT  (default 4%)
//   - tickets with two or more results (a live leg included) . COMMISSION_MULTI_PCT   (default 8%)
// It is counted on the stake the moment the ticket is placed (open, won or lost), so the agent sees what he earns from
// every bet straight away. Cancelled and refunded (void) tickets earn nothing. Lek and euro are kept apart
// (currency 'ALL' = lek, 'EUR' = euro).
const pct = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
};
export const COMMISSION_SINGLE_PCT = pct(process.env.COMMISSION_SINGLE_PCT, 4);
export const COMMISSION_MULTI_PCT = pct(process.env.COMMISSION_MULTI_PCT, 8);

// "Results" of a selection: a half-time/full-time pick ("45/90", "1/2") is TWO results (the half-time and the full-time
// one), and so is a combined market ("Rezultat Final & Numri i Golave", "Rezultat Final/Gol-Gol", "Rezultat Final me Kartona",
// "Rezultati Final Gola 3+": a 1/X/2 together with a goals or cards condition). Everything else is one result: 1, X, 2,
// 2+ / 3+ / 4+, GG, JG, over/under, double chance. A ticket with
// two or more results in total earns the higher rate -- also a single "Bast i Thjeshte" on 45/90.
export const MULTI_RESULT_MARKET_RE = '(&|^\\s*(45\\s*/\\s*90|ht\\s*/?\\s*ft|pushimi?\\s*/?\\s*fund|pjesa e par[eë]\\s*/\\s*(finale|fund)|rezultati (i )?(pjesa|pjeses|ne)\\s.*pushim?.*/|rezultati pjesa e par[eë]\\s*/|rezultat final\\s*/\\s*gol|rezultat (final|i p[12]) me kartona|rezultati final gola))';
export const resultsInSelection = (marketName) => (new RegExp(MULTI_RESULT_MARKET_RE, 'i').test(String(marketName || '')) ? 2 : 1);

// Ticket statuses that earn commission.
export const COMMISSION_STATUSES = ['PENDING', 'WON', 'LOST'];

export const emptyMetrics = () => ({ xhiro: 0, fitim: 0, pending: 0, activeTickets: 0, tickets: 0, commission: 0 });

// One row per (user, currency) with everything the report needs, for tickets created in [rangeStart, rangeEnd).
export async function userMetrics(pool, { rangeStart, rangeEnd, adminId = null, agentId = null }) {
  const { rows } = await pool.query(
    `WITH t AS (
       SELECT b.user_id, b.currency, b.stake, b.potential_return, b.status,
              CASE WHEN (SELECT COALESCE(SUM(CASE WHEN s.market_name ~* $8 THEN 2 ELSE 1 END), 0) FROM bet_selections s WHERE s.bet_id = b.id) >= 2
                   THEN $4::numeric ELSE $3::numeric END AS rate
       FROM bets b
       JOIN users u ON u.id = b.user_id
       WHERE b.created_at >= $1 AND b.created_at < $2 AND b.status NOT IN ('CANCELLED', 'VOID')
         AND ($5::text IS NULL OR COALESCE(u.admin_id, (SELECT x.admin_id FROM users x WHERE x.id = u.agent_id)) = $5)
         AND ($6::text IS NULL OR u.agent_id = $6)
     )
     SELECT user_id, currency,
            COUNT(*)::int AS tickets,
            COALESCE(SUM(stake), 0) AS xhiro,
            COALESCE(SUM(potential_return) FILTER (WHERE status = 'WON'), 0) AS fitim,
            COALESCE(SUM(stake) FILTER (WHERE status = 'PENDING'), 0) AS pending,
            COUNT(*) FILTER (WHERE status = 'PENDING')::int AS active_tickets,
            COALESCE(SUM(stake * rate / 100) FILTER (WHERE status = ANY($7::text[])), 0) AS commission
     FROM t GROUP BY user_id, currency`,
    [rangeStart, rangeEnd, COMMISSION_SINGLE_PCT, COMMISSION_MULTI_PCT, adminId, agentId, COMMISSION_STATUSES, MULTI_RESULT_MARKET_RE]
  );
  return rows.map((r) => ({
    userId: r.user_id, currency: r.currency === 'EUR' ? 'EUR' : 'ALL',
    xhiro: Number(r.xhiro), fitim: Number(r.fitim), pending: Number(r.pending),
    activeTickets: r.active_tickets, tickets: r.tickets, commission: Number(r.commission),
  }));
}

export const addMetrics = (a, b) => ({
  xhiro: a.xhiro + b.xhiro, fitim: a.fitim + b.fitim, pending: a.pending + b.pending,
  activeTickets: a.activeTickets + b.activeTickets, tickets: a.tickets + b.tickets, commission: a.commission + b.commission,
});

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// The columns of the report (every figure from the company's side, open tickets included):
//   xhiro      = every stake placed (not cancelled / refunded)
//   fitim      = what the winning tickets pay out
//   diferenca  = xhiro - fitim - commission     (a new ticket adds to it, a win takes its payout out of it)
//   percAgjentit = commission                   (what the agent keeps: 4% / 8% of every stake)
//   kompania   = diferenca   (the commission is already out of diferenca: it must NOT be taken a second time)
// e.g. 2 open tickets of 20 and 10 at 8%: diferenca 30 - 2.40 = 27.60, % agjentit 2.40, kompania 27.60.
export function finishMetrics(m) {
  const diferenca = m.xhiro - m.fitim - m.commission;
  return {
    xhiro: round2(m.xhiro), fitim: round2(m.fitim), pending: round2(m.pending),
    activeTickets: m.activeTickets, tickets: m.tickets,
    diferenca: round2(diferenca),
    percAgjentit: round2(m.commission),
    kompania: round2(diferenca),
  };
}

// Builds the report tree: admin group -> agent rows (each with its players) + a "direct" row for users that
// have no agent. Every figure exists once for lek (ALL) and once for euro (EUR), never added together.
// admins/agents/users are plain users rows (id, name, username, is_active, admin_id, agent_id).
export function buildCommissionReport({ admins, agents, users, metrics }) {
  const byUser = new Map();
  for (const m of metrics) {
    const e = byUser.get(m.userId) || { ALL: emptyMetrics(), EUR: emptyMetrics() };
    e[m.currency] = addMetrics(e[m.currency], m);
    byUser.set(m.userId, e);
  }
  const sumOf = (list) => {
    const t = { ALL: emptyMetrics(), EUR: emptyMetrics() };
    for (const u of list) {
      const e = byUser.get(u.id);
      if (e) { t.ALL = addMetrics(t.ALL, e.ALL); t.EUR = addMetrics(t.EUR, e.EUR); }
    }
    return { ALL: finishMetrics(t.ALL), EUR: finishMetrics(t.EUR) };
  };
  const player = (u) => ({ id: u.id, name: u.name, username: u.username, isActive: u.is_active, currencies: sumOf([u]) });
  const owner = (x) => x.admin_id ?? null;
  const groupFor = (admin) => {
    const myAgents = agents.filter((a) => owner(a) === admin.id);
    const rows = myAgents.map((a) => {
      const mine = users.filter((u) => u.agent_id === a.id);
      return { id: a.id, name: a.name, username: a.username, isActive: a.is_active, direct: false, currencies: sumOf(mine), players: mine.map(player) };
    });
    const direct = users.filter((u) => !u.agent_id && owner(u) === admin.id);
    if (direct.length) rows.push({ id: null, name: '', username: '', isActive: true, direct: true, currencies: sumOf(direct), players: direct.map(player) });
    const everyone = users.filter((u) => owner(u) === admin.id);
    return { admin: { id: admin.id, name: admin.name, username: admin.username }, rows, totals: sumOf(everyone) };
  };
  const list = [...admins];
  const hasUnowned = [...agents, ...users].some((x) => owner(x) === null);
  if (hasUnowned && !list.some((a) => a.id === null)) list.push({ id: null, name: '', username: '' });
  const groups = list.map(groupFor).filter((g) => g.rows.length > 0 || g.admin.id !== null);
  return { rates: { single: COMMISSION_SINGLE_PCT, multi: COMMISSION_MULTI_PCT }, groups, totals: sumOf(users) };
}

// 'YYYY-MM' (one month) or 'all' (everything) -> the [rangeStart, rangeEnd) window and its label.
export function periodRange(param, monthRange) {
  if (param === 'all') return { rangeStart: 0, rangeEnd: Date.UTC(2100, 0, 1), label: 'all' };
  const { rangeStart, rangeEnd, label } = monthRange(param);
  return { rangeStart, rangeEnd, label };
}
