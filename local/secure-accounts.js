// Ndërron fjalëkalimet e llogarive të para (admin/admin, root/root, user/user) me ato nga .env.local.
// Prek vetëm llogaritë që ende kanë fjalëkalimin e paracaktuar, pra nuk mbishkruan asgjë që e ke ndryshuar vetë.
import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const url = process.env.DATABASE_URL;
const adminPw = process.env.ADMIN_PASSWORD || '';
const agentPw = process.env.AGENT_PASSWORD || '';
if (!url || !adminPw) { console.error('[secure] mungon DATABASE_URL ose ADMIN_PASSWORD'); process.exit(1); }

const client = new pg.Client({ connectionString: url });
await client.connect();

let rows = [];
for (let i = 0; i < 150; i++) { // pret që aplikacioni të krijojë llogaritë (deri ~5 min)
  try {
    ({ rows } = await client.query(`SELECT id, username, password_hash FROM users WHERE username IN ('admin','root','user')`));
    if (rows.some((r) => r.username === 'admin')) break;
  } catch { /* tabela ende s'është krijuar */ }
  await new Promise((r) => setTimeout(r, 2000));
}
if (!rows.some((r) => r.username === 'admin')) { console.log('[secure] llogaria admin nuk u gjet (mbase është riemërtuar) -- asgjë për të bërë'); await client.end(); process.exit(0); }

const plan = { admin: ['admin', adminPw], root: ['root', agentPw], user: ['user', crypto.randomBytes(24).toString('hex')] };
for (const r of rows) {
  const [defaultPw, newPw] = plan[r.username];
  if (!newPw) { console.log(`[secure] ${r.username}: AGENT_PASSWORD bosh -- mbetet fjalëkalimi i paracaktuar!`); continue; }
  if (!bcrypt.compareSync(defaultPw, r.password_hash)) { console.log(`[secure] ${r.username}: fjalëkalimi është ndryshuar tashmë, nuk e prek`); continue; }
  await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [bcrypt.hashSync(newPw, 10), r.id]);
  console.log(`[secure] ${r.username}: fjalëkalimi i paracaktuar u zëvendësua` + (r.username === 'user' ? ' (llogaria testuese u mbyll)' : ''));
}
await client.end();
