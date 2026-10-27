// npm run super-admin -- <username> <password> [name]
import 'dotenv/config';
import { pool } from './db.js';
import { ensureSuperAdmin } from './superAdmin.js';

const [username, password, name] = process.argv.slice(2);
if (!username || !password) {
  console.error('usage: npm run super-admin -- <username> <password> [name]');
  process.exit(1);
}
ensureSuperAdmin(pool, { username, password, name, onlyIfMissing: false })
  .then((r) => { console.log('[super-admin] ' + r.status + ': ' + username); process.exit(0); })
  .catch((err) => { console.error('[super-admin] failed:', err.message); process.exit(1); });
