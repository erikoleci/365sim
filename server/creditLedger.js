// The super admin's book of the credit he gave to the admins (and took back): per admin how much was given, how much
// came back, what is left, and the cash he keeps for every credit (OWNER_CREDIT_FEE_RATE, default 10%).
// Pure (no database), so it can be tested on its own. Lek and euro are never added together.
export const DEFAULT_FEE_RATE = 0.10;

export function feeRateFromEnv(raw) {
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_FEE_RATE;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const zero = () => ({ ALL: 0, EUR: 0 });
const cur = (c) => (c === 'EUR' ? 'EUR' : 'ALL');

/**
 * admins: [{ id, name, username, balance, balance_eur }]
 * rows:   [{ id, created_at, amount, currency, type: 'SUPER_TO_ADMIN' | 'ADMIN_TO_SUPER', admin_id }]
 */
export function buildCreditLedger({ admins, rows, feeRate = DEFAULT_FEE_RATE, adminId = null, limit = 300 }) {
  const per = new Map();
  for (const a of admins) {
    per.set(a.id, {
      id: a.id, name: a.name, username: a.username,
      remaining: { ALL: round2(a.balance), EUR: round2(a.balance_eur) },
      given: zero(), takenBack: zero(), credits: 0, lastCreditAt: null,
    });
  }
  const history = [];
  for (const r of rows) {
    const row = per.get(r.admin_id);
    if (!row) continue; // an account that is no longer an admin
    const c = cur(r.currency);
    const amount = Number(r.amount) || 0;
    const at = Number(r.created_at) || 0;
    const credit = r.type === 'SUPER_TO_ADMIN';
    if (credit) {
      row.given[c] += amount;
      row.credits += 1;
      if (row.lastCreditAt == null || at > row.lastCreditAt) row.lastCreditAt = at;
    } else {
      row.takenBack[c] += amount;
    }
    if (!adminId || r.admin_id === adminId) {
      history.push({
        id: r.id, at, adminId: r.admin_id, adminName: row.name, adminUsername: row.username,
        kind: credit ? 'CREDIT' : 'TAKE_BACK', currency: c, amount: round2(amount),
        cash: credit ? round2(amount * feeRate) : 0, // what the super admin keeps in cash for this credit
      });
    }
  }
  history.sort((a, b) => b.at - a.at || String(b.id).localeCompare(String(a.id)));

  const totals = { given: zero(), takenBack: zero(), net: zero(), cash: zero(), remaining: zero() };
  const list = [...per.values()].map((a) => {
    const out = { ...a, net: zero(), cash: zero(), used: zero(), leftPct: { ALL: null, EUR: null } };
    for (const c of ['ALL', 'EUR']) {
      out.given[c] = round2(a.given[c]);
      out.takenBack[c] = round2(a.takenBack[c]);
      out.net[c] = round2(a.given[c] - a.takenBack[c]);
      out.cash[c] = round2(a.given[c] * feeRate);
      out.used[c] = round2(out.net[c] - a.remaining[c]);
      out.leftPct[c] = out.net[c] > 0 ? Math.max(0, Math.round((a.remaining[c] / out.net[c]) * 100)) : null;
      totals.given[c] += out.given[c];
      totals.takenBack[c] += out.takenBack[c];
      totals.net[c] += out.net[c];
      totals.cash[c] += out.cash[c];
      totals.remaining[c] += a.remaining[c];
    }
    return out;
  }).sort((a, b) => (b.lastCreditAt || 0) - (a.lastCreditAt || 0) || String(a.name).localeCompare(String(b.name)));
  for (const k of Object.keys(totals)) for (const c of ['ALL', 'EUR']) totals[k][c] = round2(totals[k][c]);

  return { feeRate, admins: list, totals, history: history.slice(0, limit) };
}
