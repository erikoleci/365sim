// `npm run audit:markets` -- READ-ONLY: every market the feed offers right now (live + prematch) and every market
// used by a placed bet, and whether the system settles it by itself. Prints the report and saves it to
// market-coverage.txt in the project folder, so it can be sent as it is. Nothing is changed in the database.
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { pool } from './db.js';
import { computeMarketCoverage } from './marketCoverageScan.js';

try {
  const r = await computeMarketCoverage(pool, { budgetMs: 10 * 60 * 1000 });
  const head = `Ndeshje të skanuara: ${r.boardMatchesScanned} (live ${r.liveMatchesScanned}, prematch ${r.prematchMatchesScanned}) në ${Math.round(r.scanMs / 1000)}s | rregulli i detyrueshëm për bast: ${r.requireSettlementRule ? 'PO' : 'JO'}`;
  const out = head + '\n' + r.text + '\n';
  console.log(out);
  writeFileSync('market-coverage.txt', out, 'utf8');
  console.log('(Teksti u ruajt edhe te market-coverage.txt)');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error('[audit:markets] dështoi:', err.message);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
}
