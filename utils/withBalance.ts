// Returns the SAME object when the balance is unchanged, so React's setState
// bails out and does not re-render.
//
// Why this exists: AgentUsersPanel reports the agent's balance to App after
// every load. App used to answer with `{ ...user, balance }` unconditionally,
// i.e. a NEW currentUser object even when nothing changed. Eight effects in
// App depend on the currentUser object identity, and the panel's own load()
// depended on an inline callback recreated on every App render, so each
// response triggered the next round of requests (agent/me, agent/performance,
// favorites, matches, bets, users...) -- an endless loop that blew through the
// API rate limit (120/min) and made every call answer 429.
export function withBalance<T extends { balance: number; balanceEur?: number }>(user: T | null, balance: number, balanceEur?: number): T | null {
  if (!user) return user;
  const eurSame = balanceEur === undefined || (user.balanceEur ?? 0) === balanceEur;
  if (user.balance === balance && eurSame) return user;
  return balanceEur === undefined ? { ...user, balance } : { ...user, balance, balanceEur };
}
