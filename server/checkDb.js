// `npm run db:check` -- verifies the PostgreSQL connection end to end, without
// starting the server:
//   1. SELECT 1
//   2. whether the session really is TLS-encrypted (pg_stat_ssl)
//   3. initDb()  (CREATE TABLE IF NOT EXISTS ... must finish without error)
//   4. runMigrations()
// Exit code 0 = all good, 1 = something failed (the error code is printed with a hint).
import 'dotenv/config';
import { pool, initDb } from './db.js';
import { runMigrations } from './migrate.js';

function hintFor(err) {
  const code = err && err.code;
  if (code === 'SELF_SIGNED_CERT_IN_CHAIN' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
    return 'The server certificate is signed by a CA this machine does not trust. For Aiven: download "CA certificate" ' +
      'from the service page and set DATABASE_CA_CERT_FILE=<path to ca.pem> (or DATABASE_CA_CERT=<PEM text>). ' +
      'Do NOT use NODE_TLS_REJECT_UNAUTHORIZED=0.';
  }
  if (code === 'ENOTFOUND') return 'The host name in DATABASE_URL does not resolve.';
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT') return 'The database host/port is not reachable (firewall, IP allow-list, wrong port?).';
  if (code === '28P01') return 'Wrong user or password in DATABASE_URL.';
  if (code === '53300') return 'Too many connections (Aiven free plan allows 20 in total, shared by every client).';
  return null;
}

async function main() {
  try {
    const u = new URL(process.env.DATABASE_URL);
    console.log('[db:check] host=' + u.hostname + ' port=' + (u.port || '5432') + ' database=' + u.pathname.replace(/^\//, ''));
  } catch {
    console.log('[db:check] DATABASE_URL could not be parsed as a URL');
  }

  await pool.query('SELECT 1');
  console.log('[db:check] SELECT 1 ok');

  try {
    const { rows } = await pool.query('SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
    if (rows[0]) console.log('[db:check] session encrypted=' + rows[0].ssl + (rows[0].ssl ? ' (' + rows[0].version + ', ' + rows[0].cipher + ')' : ''));
  } catch (err) {
    console.log('[db:check] pg_stat_ssl not readable (' + err.message + ') -- skipped');
  }

  await initDb();
  console.log('[db:check] initDb() finished without error');

  const result = await runMigrations(pool);
  console.log('[db:check] migrations: ' + (result.applied.length ? 'applied ' + result.applied.join(', ') : 'up to date'));
}

main()
  .then(async () => {
    console.log('[db:check] OK');
    await pool.end().catch(() => {});
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[db:check] FAILED: ' + (err && err.code ? '[' + err.code + '] ' : '') + (err && err.message ? err.message : err));
    const hint = hintFor(err);
    if (hint) console.error('[db:check] hint: ' + hint);
    await pool.end().catch(() => {});
    process.exit(1);
  });
