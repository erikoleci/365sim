import pool from './db.js';
import { getCasinoAccess } from './casinoAccess.js';

// Demo difficulty. While the casino is open only to the super admin ('super'), a round that would win is kept with
// chance `gate` percent and otherwise replaced by a genuinely drawn losing round, so wins are rare. The round that is
// shown (reels, wheel, grid) is the one that is paid: when a win does come, the full amount is paid. The moment the
// casino is opened to players ('all') the gate is 100 = off, so players never play a gated game.
const KEY = 'casino_win_gate';
export const DEFAULT_GATE = 30;

export async function getWinGate() {
  try {
    if ((await getCasinoAccess()) === 'all') return 100;
    const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [KEY]);
    const n = rows[0] ? Number(rows[0].value) : DEFAULT_GATE;
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : DEFAULT_GATE;
  } catch {
    return 100; // unreadable -> no gate
  }
}

/** drawOnce() -> round, isWin(round) -> bool. Redraws a winning round (with chance 1 - gate/100) until a losing one comes. */
export function gatedDraw(drawOnce, isWin, gate, randInt, maxTries = 400) {
  let r = drawOnce();
  if (gate >= 100 || !isWin(r) || randInt(100) < gate) return r;
  for (let i = 0; i < maxTries; i += 1) {
    r = drawOnce();
    if (!isWin(r)) return r;
  }
  return r;
}
