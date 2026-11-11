// Pure math of the extra casino games (fair: the house edge is only in these payout tables).

// ---- Plinko ---------------------------------------------------------------------------------
// The ball makes `rows` left/right choices (50/50, crypto RNG on the server) and lands in bucket k = number of
// rights, which has probability C(rows,k)/2^rows. m_k = floor + s * d^p (d = distance from the centre, 0..1);
// s is solved so that the return to player is exactly the game's rtp (PLINKO_RTP by default, the admin profile otherwise).
export const PLINKO_RTP = 0.97;
export const PLINKO_ROWS = [8, 12, 16];
const RISK = { LOW: { floor: 0.5, p: 2 }, MEDIUM: { floor: 0.2, p: 3 }, HIGH: { floor: 0.1, p: 4 } };
export const PLINKO_RISKS = Object.keys(RISK);

const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i; return r; };

export function plinkoProbabilities(rows) {
  return Array.from({ length: rows + 1 }, (_, k) => binom(rows, k) / 2 ** rows);
}

export function plinkoMultipliers(rows, risk, rtp = PLINKO_RTP) {
  const cfg = RISK[risk];
  if (!cfg || !PLINKO_ROWS.includes(rows)) throw new Error('invalid plinko config');
  const probs = plinkoProbabilities(rows);
  const d = (k) => Math.abs(k - rows / 2) / (rows / 2);
  const expectedD = probs.reduce((a, pr, k) => a + pr * d(k) ** cfg.p, 0);
  const floor = Math.min(cfg.floor, rtp * 0.5); // a low return needs a lower floor too
  const s = (rtp - floor) / expectedD;
  return probs.map((_, k) => Number((floor + s * d(k) ** cfg.p).toFixed(2)));
}

export const plinkoRtp = (rows, risk) => {
  const probs = plinkoProbabilities(rows);
  return plinkoMultipliers(rows, risk).reduce((a, m, k) => a + m * probs[k], 0);
};

// ---- Mines (5x5 board) ----------------------------------------------------------------------
// After k safe reveals with m mines: fair multiplier = C(25,k) / C(25-m,k); the player gets MINES_RTP of it.
export const MINES_RTP = 0.97;
export const MINES_TILES = 25;
export function minesMultiplier(mines, safeRevealed) {
  if (safeRevealed <= 0) return 1;
  let fair = 1;
  for (let i = 0; i < safeRevealed; i += 1) fair *= (MINES_TILES - i) / (MINES_TILES - mines - i);
  return Math.floor(fair * MINES_RTP * 100) / 100;
}

// ---- Dragon Tiger ---------------------------------------------------------------------------
// One card each from a single 52-card deck (Ace low, King high). Higher card wins; on a tie Dragon/Tiger bets lose half.
export const DT_PAYOUT = { DRAGON: 2, TIGER: 2, TIE: 16 };
export const DT_TIE_RETURN = 0.5;
export function dragonTigerPayout(bet, dragonRank, tigerRank, stake) {
  const result = dragonRank > tigerRank ? 'DRAGON' : tigerRank > dragonRank ? 'TIGER' : 'TIE';
  let payout = 0;
  if (result === bet) payout = stake * DT_PAYOUT[bet];
  else if (result === 'TIE') payout = stake * DT_TIE_RETURN; // Dragon/Tiger bet, tie: half back
  return { result, payout: Number(payout.toFixed(2)) };
}
