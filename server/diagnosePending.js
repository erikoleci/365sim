// `npm run diagnose:pending` -- READ-ONLY report of every ticket that is still open: for each open leg the state of its
// match and exactly why it has not closed. Nothing is changed in the database. The text is printed AND saved to
// diagnose-pending.txt in the project folder, so it can be sent as it is.
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { pool } from './db.js';
import { explainSettleBlock, wouldSettleNow } from './matchSettlement.js';
import { describeOpenLeg, refineOpenLeg } from './legWhy.js';

const out = [];
const say = (s = '') => { out.push(s); console.log(s); };
const fmt = (ms) => { const d = new Date(Number(ms)); return Number.isFinite(d.getTime()) ? d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '?'; };

async function main() {
  const now = Date.now();
  const { rows: bets } = await pool.query(
    `SELECT b.id, b.created_at, b.stake, b.currency, b.potential_return, b.type, u.username
       FROM bets b JOIN users u ON u.id = b.user_id
      WHERE b.status = 'PENDING' ORDER BY b.created_at`
  );
  say(`RAPORT ${fmt(now)} -- bileta të hapura: ${bets.length}`);
  if (!bets.length) { say('Asnjë biletë e hapur.'); return; }

  const { rows: legs } = await pool.query(
    `SELECT bs.* FROM bet_selections bs WHERE bs.status = 'PENDING' AND bs.bet_id = ANY($1::text[]) ORDER BY bs.bet_id, bs.id`,
    [bets.map((b) => b.id)]
  );
  const matchIds = [...new Set(legs.map((l) => l.match_id))];
  const { rows: matches } = matchIds.length
    ? await pool.query('SELECT * FROM matches_cache WHERE id = ANY($1::text[])', [matchIds])
    : { rows: [] };
  const byId = new Map(matches.map((m) => [m.id, m]));
  const legsByBet = new Map();
  for (const l of legs) { if (!legsByBet.has(l.bet_id)) legsByBet.set(l.bet_id, []); legsByBet.get(l.bet_id).push(l); }

  const byCode = {};
  const noRule = {};
  for (const b of bets) {
    say('');
    say(`#${String(b.id).slice(0, 8)}  ${b.username}  ${b.type || ''}  stake ${b.stake} ${b.currency || 'ALL'}  -> ${b.potential_return}  (vendosur ${fmt(b.created_at)})`);
    for (const l of legsByBet.get(b.id) || []) {
      const m = byId.get(l.match_id);
      const d = refineOpenLeg(describeOpenLeg({ leg: l, match: m, now, blockReason: m && m.status === 'FINISHED' && m.result_home == null ? explainSettleBlock(m, now) : '' }), { leg: l, match: m, decide: wouldSettleNow });
      const code = d.code;
      const text = d.text;
      if (code === 'NO_RULE') noRule[`${l.market_name} | ${l.selection_name}`] = (noRule[`${l.market_name} | ${l.selection_name}`] || 0) + 1;
      byCode[code] = (byCode[code] || 0) + 1;
      say(`   - ${d.match} | ${l.market_name} | ${l.selection_name}`);
      say(`       [${code}] ${m ? `status=${m.status} fillimi=${m.start_time} rezultati=${m.result_home ?? '-'}-${m.result_away ?? '-'} i ruajtur live=${m.live_home_score ?? '-'}-${m.live_away_score ?? '-'} minuta=${m.live_minute ?? '-'}` : 'ndeshja mungon'}`);
      say(`       ${text}`);
    }
  }
  say('');
  say('PËRMBLEDHJE sipas arsyes (zgjedhje të hapura):');
  for (const [c, n] of Object.entries(byCode).sort((x, y) => y[1] - x[1])) say(`   ${c}: ${n}`);
  const nr = Object.entries(noRule);
  if (nr.length) {
    say('');
    say('TREGJE PA RREGULL AUTOMATIK (ndeshja ka rezultat, tregu jo):');
    for (const [k, n] of nr.sort((x, y) => y[1] - x[1])) say(`   ${n} x  ${k}`);
  }
}

try {
  await main();
  writeFileSync('diagnose-pending.txt', out.join('\n') + '\n', 'utf8');
  console.log('\n(Teksti u ruajt edhe te diagnose-pending.txt)');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error('[diagnose:pending] dështoi:', err.message);
  if (err.code) console.error('kodi:', err.code);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
}
