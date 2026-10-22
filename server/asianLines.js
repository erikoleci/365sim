// Asian lines. A whole line (0, 1, -1) can push (stake refunded), a half line (0.5, -1.5) cannot,
// a QUARTER line (0.25, 0.75, -0.25, 1.25 ...) splits the stake into two equal halves placed on the
// two neighbouring lines: -0.25 = half on 0 and half on -0.5, +0.75 = half on +0.5 and half on +1.
// Per part: win / push / lose. Both win = WON, win + push = HALF_WON, both push = VOID,
// lose + push = HALF_LOST, both lose = LOST.

/** The line(s) a stake is really placed on: [line] for whole/half lines, two lines for a quarter line. */
export function lineParts(line) {
  const q = Math.round(line * 4);
  if (!Number.isFinite(q) || Math.abs(line * 4 - q) > 1e-9) return null; // not a multiple of 0.25
  if (q % 2 === 0) return [q / 4];
  return [(q - 1) / 4, (q + 1) / 4];
}

export function combineParts(parts) {
  if (parts.length === 1) return parts[0];
  const w = parts.filter((p) => p === 'WON').length;
  const l = parts.filter((p) => p === 'LOST').length;
  const v = parts.filter((p) => p === 'VOID').length;
  if (w === 2) return 'WON';
  if (l === 2) return 'LOST';
  if (v === 2) return 'VOID';
  if (w === 1 && v === 1) return 'HALF_WON';
  if (l === 1 && v === 1) return 'HALF_LOST';
  return null; // win + lose on adjacent lines cannot happen
}

/** Asian handicap: `own` goals of the chosen side + its line against the opponent's goals. */
export function asianHandicapOutcome(own, opp, line) {
  const lines = lineParts(line);
  if (!lines || !Number.isFinite(own) || !Number.isFinite(opp)) return null;
  return combineParts(lines.map((l) => { const d = own + l - opp; return d > 0 ? 'WON' : d < 0 ? 'LOST' : 'VOID'; }));
}

/** Asian over / under on a total (goals, in a half, ...). */
export function asianTotalOutcome(over, line, total) {
  const lines = lineParts(line);
  if (!lines || !Number.isFinite(total)) return null;
  return combineParts(lines.map((l) => (total === l ? 'VOID' : (over ? total > l : total < l) ? 'WON' : 'LOST')));
}
