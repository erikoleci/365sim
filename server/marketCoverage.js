import { describeMarket } from './marketRules.js';

// Admin report: for every market name seen, what the system does with it. The classification
// itself lives in marketRules.js (describeMarket), shared with the bet guards.

// entries: [{ name, id?, matches?, legs?, pending? }] -> one row per market name, those with
// no settlement rule first (markets with open tickets first), then the rest.
export function buildCoverageReport(entries) {
  const byName = new Map();
  for (const e of entries) {
    const name = String(e.name || '').trim();
    if (!name) continue;
    const cur = byName.get(name) || { name, id: e.id || null, matches: 0, legs: 0, pending: 0, samples: [] };
    for (const smp of e.samples || []) {
      if (cur.samples.length < 4 && smp != null && !cur.samples.includes(String(smp))) cur.samples.push(String(smp));
    }
    cur.matches += Number(e.matches || 0);
    cur.legs += Number(e.legs || 0);
    cur.pending += Number(e.pending || 0);
    byName.set(name, cur);
  }
  const rows = Array.from(byName.values()).map((r) => ({ ...r, ...describeMarket(r.id, r.name) }));
  rows.sort((a, b) =>
    // Without a rule first; among those, markets with OPEN tickets first (the ones that matter
    // for stuck bets), then most-bet, then most widely offered.
    Number(a.autoSettles) - Number(b.autoSettles) || b.pending - a.pending || b.legs - a.legs || b.matches - a.matches || a.name.localeCompare(b.name));
  const without = rows.filter((r) => !r.autoSettles);
  return {
    summary: {
      markets: rows.length,
      autoSettled: rows.length - without.length,
      withoutRule: without.length,
      betLegsWithoutRule: without.reduce((n, r) => n + r.legs, 0),
      pendingLegsWithoutRule: without.reduce((n, r) => n + r.pending, 0),
    },
    markets: rows,
  };
}

// The same report as plain text (what the admin "Tregjet" tab shows and copies): markets WITHOUT a
// settlement rule first, with how many tickets are open on them and a few example options.
export function formatCoverageText(report) {
  const fmt = (r) => `- ${r.name} | bileta: ${r.legs} (hapur: ${r.pending}) | ndeshje në tabelë: ${r.matches} | opsione p.sh.: ${(r.samples || []).join(' ; ')}`;
  const without = report.markets.filter((r) => !r.autoSettles);
  const withRule = report.markets.filter((r) => r.autoSettles);
  return [
    `TREGJE GJITHSEJ: ${report.summary.markets} | ME RREGULL: ${report.summary.autoSettled} | PA RREGULL: ${report.summary.withoutRule}`,
    '',
    '=== PA RREGULL (mbyllen vetëm me dorë ose kthehen pas 24 orësh) ===',
    without.map(fmt).join('\n') || '(asnjë)',
    '',
    '=== ME RREGULL ===',
    withRule.map((r) => `- ${r.name}${(r.samples || []).length ? ' | ' + r.samples.join(' ; ') : ''}`).join('\n') || '(asnjë)',
  ].join('\n');
}
