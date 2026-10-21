// Raporti i tregjeve: cilat tregje i mbyll sistemi vetë dhe cilat JO (si "Minuta e Golit", ...).
// Nisje:  docker compose --env-file .env.local -f docker-compose.local.yml exec app node local/market-report.mjs
// Dërgoje daljen (ose vetëm pjesën "PA RREGULL") për të shtuar rregullat që mungojnë.
import pg from 'pg';
import { mapEventToMatch } from '../server/oddsUtils.js';
import { describeMarket } from '../server/marketRules.js';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const rows = new Map(); // emri -> { legs, pending, samples:Set, boardMatches }
const row = (name) => {
  if (!rows.has(name)) rows.set(name, { name, legs: 0, pending: 0, boardMatches: 0, samples: new Set(), id: null });
  return rows.get(name);
};

// 1) tregjet e biletave të luajtura
const legs = await client.query(
  `SELECT market_id, market_name, selection_name, status FROM bet_selections`);
for (const l of legs.rows) {
  const r = row(String(l.market_name || '').trim());
  r.id ??= l.market_id; r.legs++;
  if (l.status === 'PENDING') r.pending++;
  if (r.samples.size < 4 && l.selection_name) r.samples.add(String(l.selection_name));
}

// 2) tregjet që shfaqen tani në tabelë (LIVE + së shpejti)
const board = await client.query(
  `SELECT * FROM matches_cache WHERE status IN ('LIVE','UPCOMING') ORDER BY start_time LIMIT 300`);
for (const b of board.rows) {
  let match; try { match = mapEventToMatch(b); } catch { continue; }
  for (const mk of match.markets || []) {
    const r = row(String(mk.name || '').trim());
    r.id ??= mk.id; r.boardMatches++;
    for (const o of mk.options || []) { if (r.samples.size >= 4) break; r.samples.add(String(o.name)); }
  }
}
await client.end();

const list = [...rows.values()].filter((r) => r.name).map((r) => ({ ...r, ...describeMarket(r.id, r.name) }));
const without = list.filter((r) => !r.autoSettles).sort((a, b) => b.pending - a.pending || b.legs - a.legs || a.name.localeCompare(b.name));
const withRule = list.filter((r) => r.autoSettles);
const fmt = (r) => `- ${r.name} | biletat: ${r.legs} (hapur: ${r.pending}) | në tabelë: ${r.boardMatches} ndeshje | opsione p.sh.: ${[...r.samples].join(' ; ')}`;
console.log(`TREGJE GJITHSEJ: ${list.length} | ME RREGULL: ${withRule.length} | PA RREGULL: ${without.length}\n`);
console.log('=== PA RREGULL (këto mbyllen vetëm me dorë ose kthehen pas 24 orësh) ===');
console.log(without.map(fmt).join('\n') || '(asnjë)');
console.log('\n=== ME RREGULL ===');
console.log(withRule.map((r) => `- ${r.name}`).join('\n') || '(asnjë)');
