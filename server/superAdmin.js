// Creating the super admin. No password is hard-coded in the repo: it comes from the environment
// (SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD, created on server start when missing) or from the
// command line:  npm run super-admin -- <username> <password> [name]
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { ROLE_SUPER_ADMIN } from './roles.js';

// create = true  -> create when missing, leave an existing account untouched (used on every boot)
// create = false -> create or promote + set the password (the explicit command line)
export async function ensureSuperAdmin(pool, { username, password, name, onlyIfMissing = true }) {
  if (!username || !password) return { status: 'skipped' };
  if (String(password).length < 6) throw new Error('super admin password must be at least 6 characters');
  const { rows } = await pool.query('SELECT id, role FROM users WHERE username = $1', [username]);
  const hash = await bcrypt.hash(password, 10);
  if (!rows[0]) {
    await pool.query(
      `INSERT INTO users (id, name, username, password_hash, balance, role, avatar, created_at)
       VALUES ($1,$2,$3,$4,0,$5,'',$6)`,
      [randomUUID(), name || 'Super Admin', username, hash, ROLE_SUPER_ADMIN, Date.now()],
    );
    return { status: 'created' };
  }
  if (onlyIfMissing) return { status: rows[0].role === ROLE_SUPER_ADMIN ? 'exists' : 'username-taken' };
  await pool.query('UPDATE users SET role = $1, password_hash = $2, is_active = TRUE WHERE id = $3', [ROLE_SUPER_ADMIN, hash, rows[0].id]);
  return { status: 'updated' };
}
