// `npm run credit:classify` — one-off tidy of the "Kredia" book. Dry run unless --yes.
//  1. Every credit already given to an admin OTHER than --keep (default "london") becomes TEST (0%, never counted).
//  2. For the --keep admin the credits listed below are matched to his existing credits (same currency + amount)
//     and get the exact date / test flag; one that does not exist yet is written into the book WITHOUT touching his
//     balance (it was handed over before). Any other credit of his stays real (10%) and is counted by itself.
import 'dotenv/config';
import { pool } from './db.js';
import { feeRateFromEnv } from './creditLedger.js';

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const keepName = (args.includes('--keep') ? args[args.indexOf('--keep') + 1] : 'london').toLowerCase();
const at = (iso) => Date.parse(iso);
// Albanian local time (UTC+1 in the winter, as on these dates).
const KEEP = [
  { currency: 'ALL', amount: 100000, at: at('2026-10-29T21:43:00+01:00'), test: false },
  { currency: 'EUR', amount: 1000, at: at('2026-10-29T21:43:00+01:00'), test: false },
  { currency: 'EUR', amount: 2000, at: at('2026-11-03T19:49:00+01:00'), test: false },
  { currency: 'EUR', amount: 1000, at: at('2026-11-03T11:38:00+01:00'), test: true },
  { currency: 'ALL', amount: 100000, at: at('2026-11-03T11:38:00+01:00'), test: true },
];
const fmt = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const money = (c, n) => (c === 'EUR' ? '€' : '') + Number(n).toLocaleString('en-US') + (c === 'EUR' ? '' : ' L');

try {
  const rate = feeRateFromEnv(process.env.OWNER_CREDIT_FEE_RATE);
  const { rows: admins } = await pool.query(`SELECT id, name, username FROM users WHERE role = 'ADMIN'`);
  const keep = admins.find((a) => String(a.username).toLowerCase() === keepName || String(a.name).toLowerCase() === keepName);
  if (!keep) { console.error(`Nuk gjeta admin "${keepName}". Adminët: ${admins.map((a) => a.username).join(', ')}`); process.exit(1); }
  const { rows: credits } = await pool.query(`SELECT id, target_id, amount, currency, created_at, fee_rate, is_test FROM transactions WHERE type = 'SUPER_TO_ADMIN' ORDER BY created_at, id`);
  const others = credits.filter((c) => c.target_id !== keep.id && c.is_test !== true);
  console.log(`Adminë të tjerë: ${others.length} kredi do bëhen TEST (0%).`);
  const mine = credits.filter((c) => c.target_id === keep.id);
  const used = new Set(); const plan = [];
  for (const k of KEEP) {
    const m = mine.filter((c) => !used.has(c.id) && (c.currency === 'EUR' ? 'EUR' : 'ALL') === k.currency && Number(c.amount) === k.amount)
      .sort((a, b) => Math.abs(Number(a.created_at) - k.at) - Math.abs(Number(b.created_at) - k.at))[0];
    if (m) { used.add(m.id); plan.push({ ...k, id: m.id }); } else plan.push({ ...k, id: null });
    console.log(`  ${keep.username}: ${money(k.currency, k.amount)} ${k.test ? 'TEST' : 'real'} @ ${fmt(k.at)} -> ${m ? `përditëson kredinë #${m.id} (ishte ${fmt(Number(m.created_at))})` : 'nuk ekziston, do shtohet në libër (balanca pa ndryshim)'}`);
  }
  const rest = mine.filter((c) => !used.has(c.id));
  if (rest.length) console.log(`  ${keep.username}: ${rest.length} kredi të tjera mbeten reale (${rest.map((c) => money(c.currency === 'EUR' ? 'EUR' : 'ALL', Number(c.amount))).join(', ')}).`);
  if (!yes) { console.log('\n(Provë, nuk u shkrua asgjë. Shto --yes që ta shkruajë.)'); process.exit(0); }

  const { rows: sup } = await pool.query(`SELECT id FROM users WHERE role = 'SUPER_ADMIN' ORDER BY created_at LIMIT 1`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE transactions SET is_test = true, fee_rate = 0 WHERE type = 'SUPER_TO_ADMIN' AND target_id <> $1`, [keep.id]);
    for (const p of plan) {
      if (p.id) {
        await client.query('UPDATE transactions SET created_at = $1, is_test = $2, fee_rate = $3 WHERE id = $4', [p.at, p.test, p.test ? 0 : rate, p.id]);
      } else {
        const col = p.currency === 'EUR' ? 'balance_eur' : 'balance';
        const { rows: w } = await client.query(`SELECT ${col} AS bal FROM users WHERE id = $1 FOR UPDATE`, [keep.id]);
        const bal = Number(w[0].bal);
        await client.query(
          `INSERT INTO transactions (actor_id, source_id, target_id, amount, type, reference, source_balance_before, source_balance_after,
                                     target_balance_before, target_balance_after, created_at, currency, fee_rate, is_test)
           VALUES ($1, NULL, $2, $3, 'SUPER_TO_ADMIN', $4, NULL, NULL, $5, $5, $6, $7, $8, $9)`,
          [sup[0]?.id || keep.id, keep.id, p.amount, `${keep.username} (regjistruar, pa ndryshuar balancën)`, bal, p.at, p.currency, p.test ? 0 : rate, p.test],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  console.log('\nU SHKRUA. Shiko tab-in Kredia.');
  process.exit(0);
} catch (err) {
  console.error('[credit:classify] dështoi:', err.message);
  process.exit(1);
} finally {
  try { await pool.end(); } catch { /* ignore */ }
}
