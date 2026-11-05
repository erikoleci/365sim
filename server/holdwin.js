// HOLD & WIN: a 5x3 board. Coins land with prices; 3 respins (reset every time a new coin lands) fill the board.
// Everything is drawn on the server in one go, the browser only plays it back. Needs 6+ starting coins, otherwise no bonus.
export const COLS = 5;
export const ROWS = 3;
export const CELLS = COLS * ROWS;
export const START_COIN_P = 0.2;
export const RESPIN_COIN_P = 0.11;
export const START_LIVES = 3;
export const MIN_TRIGGER = 6;
export const FULL_BOARD_BONUS = 50;
export const MAX_WIN_MULTIPLIER = 2000;
// coin value (x stake) weights
export const COIN_TABLE = [
  { v: 0.2, w: 38 }, { v: 0.5, w: 28 }, { v: 1, w: 16 }, { v: 2, w: 9 }, { v: 3, w: 5 }, { v: 5, w: 2.4 }, { v: 10, w: 1.1 }, { v: 25, w: 0.5 },
];
const TOTAL_W = COIN_TABLE.reduce((a, c) => a + c.w, 0);

export function drawCoinValue(randInt) {
  let r = randInt(1_000_000) / 1_000_000 * TOTAL_W;
  for (const c of COIN_TABLE) { if ((r -= c.w) < 0) return c.v; }
  return COIN_TABLE[0].v;
}
const chance = (randInt, p) => randInt(1_000_000) < p * 1_000_000;

export function playRound(randInt) {
  const board = Array(CELLS).fill(0);
  const start = [];
  for (let i = 0; i < CELLS; i += 1) if (chance(randInt, START_COIN_P)) { board[i] = drawCoinValue(randInt); start.push({ cell: i, value: board[i] }); }
  if (start.length < MIN_TRIGGER) return { bonus: false, start, respins: [], full: false, multiplier: 0 };
  const respins = [];
  let lives = START_LIVES;
  while (lives > 0 && board.some((v) => v === 0)) {
    const landed = [];
    for (let i = 0; i < CELLS; i += 1) if (board[i] === 0 && chance(randInt, RESPIN_COIN_P)) { board[i] = drawCoinValue(randInt); landed.push({ cell: i, value: board[i] }); }
    lives = landed.length ? START_LIVES : lives - 1;
    respins.push({ landed, lives });
  }
  const full = board.every((v) => v > 0);
  const sum = board.reduce((a, b) => a + b, 0);
  const multiplier = Math.min(MAX_WIN_MULTIPLIER, Math.round((sum + (full ? FULL_BOARD_BONUS : 0)) * 100) / 100);
  return { bonus: true, start, respins, full, multiplier };
}

export function simulateRtp(rounds, randInt) {
  let paid = 0, bonus = 0;
  for (let i = 0; i < rounds; i += 1) { const r = playRound(randInt); paid += r.multiplier; if (r.bonus) bonus += 1; }
  return { rtp: paid / rounds, bonusRate: bonus / rounds };
}
