// `npm run credit:record -- --admin <username> --lek 100000 [--eur 500] [--fee 0.10] [--yes]`
// Writes credit you ALREADY gave an admin (outside the app) into the "Kredia" book, WITHOUT touching his balance:
// a SUPER_TO_ADMIN row is added, so "Dhënë" goes up and "Përdorur" = Dhënë - Mbetur is computed from it.
// Without --yes it only shows what would be written (dry run). Without --admin it lists the admins.
import 'dotenv/config';
import { pool } from './db.js';
import { buildCreditLedger, feeRateFromEnv } from './creditLedger.js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const yes = args.includes('--yes');
const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

async function ledgerOf(adminId) {
  const [{ rows: admins }, { rows }] = await Promise.all([
    pool.query(`SELECT id, name, username, balance, balance_eur FROM users WHERE role = 'ADMIN'`),
    pool.query(`SELECT id, created_at, amount, currency, type, fee_rate,
                       CASE WHEN type = 'SUPER_TO_ADMIN' THEN target_id ELSE source_id END AS admin_id
                  FROM transactions WHERE type IN ('SUPER_TO_ADMIN', 'ADMIN_TO_SUPER')`),
  ]);
  const feeRate = feeRateFromEnv(process.env.OWNER_CREDIT_FEE_RATE);
  const led = buildCreditLedger({ admins, rows, feeRate, adminId });
  return { admins, led, feeRate };
}
const line = (a) => `${a.name} (${a.username}) | Dhënë ${fmt(a.given.ALL)} L / €${fmt(a.given.EUR)} | Mbetur ${fmt(a.remaining.ALL)} L / €${fmt(a.remaining.EUR)} | Përdorur ${fmt(a.used.ALL)} L / €${fmt(a.used.EUR)}`;

try {
  const username = opt('admin');
  const { admins, led, feeRate: envRate } = await ledgerOf(null);
  if (!username) {
    console.log('Adminët dhe kredia e tyre tani:');
    for (const a of led.admins) console.log('  ' + line(a));
    console.log('\nPër të regjistruar kredi: npm run credit:record -- --admin <username> --lek 100000   (shto --yes që ta shkruajë)');
    process.exit(0);
  }
  const admin = admins.find((a) => String(a.username).toLowerCase() === username.toLowerCase());
  if (!admin) { console.error(`Nuk gjeta admin me username "${username}".`); process.exit(1); }
  const parts = [];
  const lek = Number(opt('lek') || 0); const eur = Number(opt('eur') || 0);
  if (lek > 0) parts.push({ currency: 'ALL', amount: lek });
  if (eur > 0) parts.push({ currency: 'EUR', amount: eur });
  if (!parts.length) { console.error('Jep shumën: --lek 100000 dhe/ose --eur 500'); process.exit(1); }
  const feeOpt = opt('fee');
  const feeRate = feeOpt !== undefined ? Number(feeOpt) : envRate;
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 1) { console.error('--fee duhet të jetë mes 0 dhe 1 (p.sh. 0.10 = 10%).'); process.exit(1); }

  const before = led.admins.find((a) => a.id === admin.id);
  console.log('PARA:     ' + line(before));
  // What the book would say after the entry.
  const fake = parts.map((p, i) => ({ id: 'x' + i, created_at: Date.now(), amount: p.amount, currency: p.currency, type: 'SUPER_TO_ADMIN', fee_rate: feeRate, admin_id: admin.id }));
  const { rows: existing } = await pool.query(`SELECT id, created_at, amount, currency, type, fee_rate, CASE WHEN type = 'SUPER_TO_ADMIN' THEN target_id ELSE source_id END AS admin_id FROM transactions WHERE type IN ('SUPER_TO_ADMIN', 'ADMIN_TO_SUPER')`);
  const preview = buildCreditLedger({ admins, rows: [...existing, ...fake], feeRate: envRate, adminId: null }).admins.find((a) => a.id === admin.id);
  console.log('PAS:      ' + line(preview));
  console.log(`Do shtohet: ${parts.map((p) => (p.currency === 'EUR' ? '€' : '') + fmt(p.amount) + (p.currency === 'EUR' ? '' : ' L')).join(' + ')} te "Dhënë" (cash që mban ti: ${Math.round(feeRate * 100)}%). Balanca e adminit NUK ndryshon.`);
  if (!yes) { console.log('\n(Provë, nuk u shkrua asgjë. Shto --yes që ta shkruajë.)'); process.exit(0); }

  const { rows: sup } = await pool.query(`SELECT id FROM users WHERE role = 'SUPER_ADMIN' ORDER BY created_at LIMIT 1`);
  if (!sup[0]) { console.error('Nuk gjeta super admin.'); process.exit(1); }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of parts) {
      const col = p.currency === 'EUR' ? 'balance_eur' : 'balance';
      const { rows: w } = await client.query(`SELECT ${col} AS bal FROM users WHERE id = $1 FOR UPDATE`, [admin.id]);
      const bal = Number(w[0].bal); // unchanged: the credit was handed over before, the balance already reflects it
      await client.query(
        `INSERT INTO transactions (actor_id, source_id, target_id, amount, type, reference, source_balance_before, source_balance_after,
                                   target_balance_before, target_balance_after, created_at, currency, fee_rate)
         VALUES ($1, NULL, $2, $3, 'SUPER_TO_ADMIN', $4, NULL, NULL, $5, $5, $6, $7, $8)`,
        [sup[0].id, admin.id, p.amount, `${admin.username} (regjistruar, pa ndryshuar balancën)`, bal, Date.now(), p.currency, feeRate]
      );
    }
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  const { led: after } = await ledgerOf(null);
  console.log('\nU SHKRUA. Tani: ' + line(after.admins.find((a) => a.id === admin.id)));
  process.exit(0);
} catch (err) {
  console.error('[credit:record] dështoi:', err.message);
  process.exit(1);
} finally {
  try { await pool.end(); } catch { /* ignore */ }
}
