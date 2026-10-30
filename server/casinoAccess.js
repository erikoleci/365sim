import pool from './db.js';
import { isSuperAdmin } from './roles.js';

// Who may open the casino: 'super' (only the super admin, to review it), 'all' (every player) or 'off' (nobody).
// Kept in kv_store like the other switches; unreadable -> 'super', so a database hiccup never opens the casino to players.
const KEY = 'casino_access';
export const CASINO_MODES = ['off', 'super', 'all'];

export async function getCasinoAccess() {
  try {
    const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [KEY]);
    return CASINO_MODES.includes(rows[0]?.value) ? rows[0].value : 'super';
  } catch {
    return 'super';
  }
}

export async function setCasinoAccess(mode) {
  if (!CASINO_MODES.includes(mode)) throw new Error('invalid mode');
  await pool.query('INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [KEY, mode]);
  return mode;
}

export const canOpenCasino = (mode, role) => mode === 'all' || (mode === 'super' && isSuperAdmin(role));
