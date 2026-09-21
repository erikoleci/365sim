import { describe, it, expect } from 'vitest';
import { withBalance } from '../utils/withBalance.ts';

// Regression: AgentUsersPanel -> onBalanceChanged -> setCurrentUser with a NEW
// object every time re-rendered App, which recreated the callback, which re-ran
// the panel's load() ... forever (agent/me + agent/performance + every effect
// keyed on currentUser), until the API rate limit answered 429 to everything.
describe('withBalance', () => {
  it('returns the SAME object when the balance did not change (React bails out, loop ends)', () => {
    const u = { id: 'a', balance: 100 };
    expect(withBalance(u, 100)).toBe(u);
  });
  it('returns a new object only when the balance actually changed', () => {
    const u = { id: 'a', balance: 100 };
    const next = withBalance(u, 150);
    expect(next).not.toBe(u);
    expect(next).toEqual({ id: 'a', balance: 150 });
    expect(u.balance).toBe(100); // no mutation
  });
  it('passes null through', () => { expect(withBalance(null, 5)).toBeNull(); });
});
