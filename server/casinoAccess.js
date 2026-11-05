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

// Per-game switches: the super admin can close single games (e.g. 'plinko') to players, whatever the casino mode is.
// The super admin can still open a closed game, to test it.
export const CASINO_GAME_KEYS = ['slots', 'roulette', 'baccarat', 'blackjack', 'videopoker', 'dice', 'plinko', 'mines', 'dragontiger', 'wheel'];
const GAMES_KEY = 'casino_games_disabled';

export async function getDisabledGames() {
  try {
    const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [GAMES_KEY]);
    const list = JSON.parse(rows[0]?.value || '[]');
    return Array.isArray(list) ? list.filter((g) => CASINO_GAME_KEYS.includes(g)) : [];
  } catch {
    return [];
  }
}

export async function setDisabledGames(list) {
  const clean = [...new Set((Array.isArray(list) ? list : []).filter((g) => CASINO_GAME_KEYS.includes(g)))];
  await pool.query('INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [GAMES_KEY, JSON.stringify(clean)]);
  return clean;
}

// Route prefix -> game key
export const gameKeyForPath = (path) => {
  const seg = String(path).split('/')[1] || '';
  if (seg === 'slot-games' || seg === 'slots') return 'slots';
  if (seg === 'dragon-tiger') return 'dragontiger';
  return CASINO_GAME_KEYS.includes(seg) ? seg : null;
};
