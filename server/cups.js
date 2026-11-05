// THREE CUPS: a ball hides under one of three cups, the cups are shuffled, the player has already picked a cup.
// The shuffle is drawn on the server (a list of swaps), the ball's final cup follows from it, so it is uniform.
export const CUPS_PAYOUT = 2.85; // 95% RTP at 1/3
export const SWAPS = 9;

export function drawShuffle(randInt) {
  const start = randInt(3);
  let ball = start;
  const swaps = [];
  for (let i = 0; i < SWAPS; i += 1) {
    const a = randInt(3); let b = randInt(2); if (b >= a) b += 1;
    swaps.push([a, b]);
    if (ball === a) ball = b; else if (ball === b) ball = a;
  }
  return { start, swaps, final: ball };
}
