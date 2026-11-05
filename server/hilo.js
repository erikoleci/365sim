// HI-LO: a card chain. Guess whether the next card is higher or lower (Ace low, King high). Equal cards lose.
// Each correct guess pays 97% fair odds, compounding; cash out any time after the first win.
export const HILO_RTP = 0.97;
export const HILO_MAX = 1000;
export const RANKS = 13;

export const winCount = (rank, guess) => (guess === 'higher' ? RANKS - rank : guess === 'lower' ? rank - 1 : 0);
export const stepMultiplier = (rank, guess) => {
  const k = winCount(rank, guess);
  return k > 0 ? (HILO_RTP * RANKS) / k : 0;
};
export const drawRank = (randInt) => randInt(RANKS) + 1;
export const roundMult = (m) => Math.floor(m * 100) / 100;

// pure one-step resolver so the route and the tests share the logic
export function playStep({ rank, guess, total }, randInt) {
  if (winCount(rank, guess) === 0) return { error: 'IMPOSSIBLE' };
  const next = drawRank(randInt);
  const won = guess === 'higher' ? next > rank : next < rank;
  if (!won) return { won: false, next, total: 0 };
  const nt = Math.min(HILO_MAX, roundMult(total * stepMultiplier(rank, guess)));
  return { won: true, next, total: nt, capped: nt >= HILO_MAX };
}
