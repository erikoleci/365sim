// The market-coverage scan, shared by the admin route (GET /api/admin/market-coverage) and the command line
// (npm run audit:markets): every market the feed offers now + every market used by a placed bet, and whether the
// system settles it by itself. Keyset paging and a time budget keep it from timing out behind the tunnel.
import { buildCoverageReport, formatCoverageText } from './marketCoverage.js';
import { settlementRuleRequired } from './marketRules.js';
import { mapEventToMatch } from './oddsUtils.js';

export async function computeMarketCoverage(pool, { budgetMs = 40000, onProgress = null } = {}) {
  const started = Date.now();
  let truncated = false;
  const { rows: legRows } = await pool.query(
    `SELECT market_id, market_name, COUNT(*)::int AS legs, COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
            (array_agg(DISTINCT selection_name))[1:4] AS samples
       FROM bet_selections GROUP BY market_id, market_name`
  );
  // LIVE first, then UPCOMING (soonest first); each status is paged by (start_time, id), never by OFFSET.
  const scanRows = async (status) => {
    const out = [];
    let lastStart = ''; let lastId = '';
    for (;;) {
      if (Date.now() - started > budgetMs) { truncated = true; break; }
      const { rows } = await pool.query(
        'SELECT * FROM matches_cache WHERE status = $1 AND (start_time, id) > ($2, $3) ORDER BY start_time, id LIMIT 100', [status, lastStart, lastId]
      );
      out.push(...rows);
      if (onProgress) onProgress({ phase: 'read', status, rows: out.length });
      if (rows.length < 100) break;
      lastStart = rows[rows.length - 1].start_time; lastId = rows[rows.length - 1].id;
      await new Promise((r) => setImmediate(r)); // let other requests through between batches
    }
    return out;
  };
  const liveRows = await scanRows('LIVE');
  const upcomingRows = await scanRows('UPCOMING');
  const boardRows = [...liveRows, ...upcomingRows];
  const board = new Map();
  const scanned = { live: 0, prematch: 0 };
  let mapped = 0;
  for (const row of boardRows) {
    if (onProgress && ++mapped % 500 === 0) onProgress({ phase: 'map', rows: mapped, total: boardRows.length });
    let match;
    try { match = mapEventToMatch(row); } catch { continue; }
    const isLive = row.status === 'LIVE';
    if (isLive) scanned.live += 1; else scanned.prematch += 1;
    for (const mk of match.markets || []) {
      const cur = board.get(mk.name) || { name: mk.name, id: mk.id, matches: 0, live: 0, liveOpen: 0, prematch: 0, prematchOpen: 0, samples: [] };
      cur.matches += 1;
      const open = (mk.options || []).some((o) => !o.suspended && o.odds > 0);
      if (isLive) {
        cur.live += 1;
        if (open) cur.liveOpen += 1;
      } else {
        cur.prematch += 1;
        if (open) cur.prematchOpen += 1;
      }
      for (const o of mk.options || []) { if (cur.samples.length < 4 && o && o.name != null && !cur.samples.includes(String(o.name))) cur.samples.push(String(o.name)); }
      board.set(mk.name, cur);
    }
  }
  const report = buildCoverageReport([
    ...legRows.map((r) => ({ name: r.market_name, id: r.market_id, legs: r.legs, pending: r.pending, samples: r.samples || [] })),
    ...board.values(),
  ]);
  return {
    boardMatchesScanned: boardRows.length, liveMatchesScanned: scanned.live, prematchMatchesScanned: scanned.prematch,
    truncated, scanMs: Date.now() - started, requireSettlementRule: settlementRuleRequired(), ...report,
    text: (truncated ? `(SKANIM I PJESSHËM: u lexuan ${boardRows.length} ndeshje, ato më të afërtat; tregjet e ndeshjeve më të largëta mund të mungojnë)\n` : '') + formatCoverageText(report),
  };
}

