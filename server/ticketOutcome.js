// What a ticket is worth once its legs are decided. Leg statuses: PENDING, WON, LOST, VOID (refund,
// the leg drops out) and, for Asian quarter lines, HALF_WON / HALF_LOST (half the stake of that leg
// wins / is lost, half is refunded). Per leg the stake is multiplied by a factor:
//   WON odds | HALF_WON 1+(odds-1)/2 | VOID 1 | HALF_LOST 0.5 | LOST 0
// Returns { status, payout, totalOdds }: payout/totalOdds are null when the ticket's stored
// potential return is to be used as is (no void / half legs involved).
export function ticketOutcome(stake, legs) {
  const st = (l) => l.status;
  if (legs.some((l) => st(l) === 'LOST')) return { status: 'LOST', payout: 0, totalOdds: null };
  if (legs.some((l) => st(l) === 'PENDING')) return { status: 'PENDING', payout: null, totalOdds: null };
  const hasHalf = legs.some((l) => st(l) === 'HALF_WON' || st(l) === 'HALF_LOST');
  const active = legs.filter((l) => st(l) !== 'VOID');
  if (active.length === 0) return { status: 'VOID', payout: Number(stake), totalOdds: 1 };
  if (!hasHalf) {
    if (active.length === legs.length) return { status: 'WON', payout: null, totalOdds: null };
    const totalOdds = active.reduce((acc, l) => acc * Number(l.odds), 1);
    return { status: 'WON', payout: Number((Number(stake) * totalOdds).toFixed(2)), totalOdds };
  }
  const factor = (l) => {
    const o = Number(l.odds);
    if (st(l) === 'WON') return o;
    if (st(l) === 'HALF_WON') return 1 + (o - 1) / 2;
    if (st(l) === 'HALF_LOST') return 0.5;
    return 1; // VOID
  };
  const totalOdds = legs.reduce((acc, l) => acc * factor(l), 1);
  const payout = Number((Number(stake) * totalOdds).toFixed(2));
  // Kept as WON even when the payout is below the stake (a half loss): the admin reports sum
  // potential_return - stake over WON tickets, so the books stay right.
  return { status: 'WON', payout, totalOdds };
}
