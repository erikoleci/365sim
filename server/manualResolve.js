// The super admin can close ANY ticket by hand as won or lost. This decides, without touching the database, what has to
// change for that: which legs get a new status and how much money must be taken back from the player (a ticket that was
// WON and is now LOST gives the winnings back). The route applies the plan inside one transaction and lets the normal
// settlement code (recomputeBetStatus) pay out a win, exactly once, like any other ticket.
export const RESOLVABLE_STATUSES = ['PENDING', 'WON', 'LOST'];

export function planManualResolve(bet, legs, outcome) {
  if (outcome !== 'WON' && outcome !== 'LOST') return { error: { code: 'BAD_OUTCOME', message: "outcome must be 'WON' or 'LOST'" } };
  if (!RESOLVABLE_STATUSES.includes(bet.status)) {
    return { error: { code: 'BET_NOT_RESOLVABLE', message: 'Vetëm biletat e hapura, fituese ose humbëse mund të ndryshohen (jo të anuluara ose të kthyera)' } };
  }
  if (bet.status === outcome) return { noop: true, legUpdates: [], takeBack: 0 };
  const active = legs.filter((l) => l.status !== 'VOID');
  if (active.length === 0) return { error: { code: 'NO_ACTIVE_LEGS', message: 'Bileta nuk ka zgjedhje aktive për t\'u vendosur' } };

  if (outcome === 'WON') {
    return {
      legUpdates: active.filter((l) => l.status !== 'WON').map((l) => ({ id: l.id, status: 'WON' })),
      takeBack: 0,
    };
  }

  // LOST: every open leg is closed as lost; a ticket that was WON has no open leg, so one leg is turned to lost
  // (a lost ticket needs a lost leg). The winnings that were paid are taken back.
  const updates = active.filter((l) => l.status === 'PENDING').map((l) => ({ id: l.id, status: 'LOST' }));
  const willBeLost = updates.length > 0 || active.some((l) => l.status === 'LOST');
  if (!willBeLost) updates.push({ id: active[0].id, status: 'LOST' });
  return { legUpdates: updates, takeBack: bet.status === 'WON' ? Math.max(0, Number(bet.potential_return) || 0) : 0 };
}
