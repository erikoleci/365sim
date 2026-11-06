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
export function buildCreditLedger({ admins, rows, settlements = [], feeRate = DEFAULT_FEE_RATE, adminId = null, limit = 300, range = null }) {
  // range { from, to } (ms, either may be missing): "from this date to that date, how much credit". The balances above stay as they
  // are (all time); `period` per admin and `periodTotals` count only what happened inside the range, and the history is cut to it.
  const bound = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)); // null must stay "no limit" (Number(null) is 0)
  const from = range ? bound(range.from) : null;
  const to = range ? bound(range.to) : null;
  const ranged = from != null || to != null;
  const inRange = (at) => (from == null || at >= from) && (to == null || at <= to);
  const newPeriod = () => ({ given: zero(), real: zero(), test: zero(), takenBack: zero(), cash: zero(), settled: zero(), credits: 0 });
  const per = new Map();
  for (const a of admins) {
    per.set(a.id, {
      id: a.id, name: a.name, username: a.username,
      remaining: { ALL: round2(a.balance), EUR: round2(a.balance_eur) },
      given: zero(), takenBack: zero(), cash: zero(), testGiven: zero(), settled: zero(), credits: 0, lastCreditAt: null,
      period: newPeriod(),
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
    const isTest = credit && (r.is_test === true || r.is_test === 't');
    // Test / free credit never earns cash; otherwise the rate frozen when it was given (or today's for old rows).
    const rate = isTest ? 0 : r.fee_rate != null && Number.isFinite(Number(r.fee_rate)) ? Number(r.fee_rate) : feeRate;
    if (credit) {
      row.given[c] += amount;
      if (isTest) row.testGiven[c] += amount;
      row.cash[c] += amount * rate;
      row.credits += 1;
      if (row.lastCreditAt == null || at > row.lastCreditAt) row.lastCreditAt = at;
    } else {
      row.takenBack[c] += amount;
    }
    if (inRange(at)) {
      const pd = row.period;
      if (credit) {
        pd.given[c] += amount; (isTest ? pd.test : pd.real)[c] += amount; pd.cash[c] += amount * rate; pd.credits += 1;
      } else pd.takenBack[c] += amount;
    }
    if ((!adminId || r.admin_id === adminId) && (!ranged || inRange(at))) {
      history.push({
        id: r.id, at, adminId: r.admin_id, adminName: row.name, adminUsername: row.username,
        kind: credit ? 'CREDIT' : 'TAKE_BACK', currency: c, amount: round2(amount),
        cash: credit ? round2(amount * rate) : 0, // what the super admin keeps in cash for this credit
        feeRate: credit ? rate : null, isTest,
      });
    }
  }
  for (const st of settlements) {
    const row = per.get(st.admin_id);
    if (!row) continue;
    const c = cur(st.currency);
    const amount = Number(st.amount) || 0;
    row.settled[c] += amount;
    if (inRange(Number(st.created_at) || 0)) row.period.settled[c] += amount;
    if ((!adminId || st.admin_id === adminId) && (!ranged || inRange(Number(st.created_at) || 0))) {
      history.push({
        id: 's' + st.id, settlementId: Number(st.id), at: Number(st.created_at) || 0, adminId: st.admin_id, adminName: row.name,
        adminUsername: row.username, kind: 'SETTLEMENT', currency: c, amount: round2(amount), cash: 0, feeRate: null, isTest: false, note: st.note || null,
      });
    }
  }
  history.sort((a, b) => b.at - a.at || String(b.id).localeCompare(String(a.id)));

  const totals = { given: zero(), takenBack: zero(), net: zero(), cash: zero(), remaining: zero(), settled: zero(), owed: zero(), testGiven: zero() };
  const periodTotals = { given: zero(), real: zero(), test: zero(), takenBack: zero(), cash: zero(), settled: zero() };
  const list = [...per.values()].map((a) => {
    const out = { ...a, period: { ...a.period, given: zero(), real: zero(), test: zero(), takenBack: zero(), cash: zero(), settled: zero() }, net: zero(), cash: zero(), used: zero(), settled: zero(), owed: zero(), testGiven: zero(), leftPct: { ALL: null, EUR: null } };
    for (const c of ['ALL', 'EUR']) {
      out.given[c] = round2(a.given[c]);
      out.takenBack[c] = round2(a.takenBack[c]);
      out.net[c] = round2(a.given[c] - a.takenBack[c]);
      out.cash[c] = round2(a.cash[c]);
      out.testGiven[c] = round2(a.testGiven[c]);
      out.settled[c] = round2(a.settled[c]);
      out.owed[c] = round2(a.cash[c] - a.settled[c]); // what the admin still owes the super admin (negative = paid too much)
      out.used[c] = round2(out.net[c] - a.remaining[c]);
      out.leftPct[c] = out.net[c] > 0 ? Math.max(0, Math.round((a.remaining[c] / out.net[c]) * 100)) : null;
      totals.given[c] += out.given[c];
      totals.takenBack[c] += out.takenBack[c];
      totals.net[c] += out.net[c];
      totals.cash[c] += out.cash[c];
      totals.remaining[c] += a.remaining[c];
      totals.settled[c] += out.settled[c];
      totals.owed[c] += out.owed[c];
      totals.testGiven[c] += out.testGiven[c];
      for (const k of ['given', 'real', 'test', 'takenBack', 'cash', 'settled']) {
        out.period[k][c] = round2(a.period[k][c]);
        periodTotals[k][c] += out.period[k][c];
      }
    }
    return out;
  }).sort((a, b) => (b.lastCreditAt || 0) - (a.lastCreditAt || 0) || String(a.name).localeCompare(String(b.name)));
  for (const k of Object.keys(totals)) for (const c of ['ALL', 'EUR']) totals[k][c] = round2(totals[k][c]);
  for (const k of Object.keys(periodTotals)) for (const c of ['ALL', 'EUR']) periodTotals[k][c] = round2(periodTotals[k][c]);

  return { feeRate, admins: list, totals, periodTotals, range: ranged ? { from, to } : null, history: history.slice(0, limit) };
}
