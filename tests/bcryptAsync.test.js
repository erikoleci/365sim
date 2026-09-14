import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';

// Locks in correctness for the sync -> async bcrypt migration across
// auth.js/admin.js/agent.js (login, register, admin/agent user creation,
// password reset): bcryptjs's *Sync functions run the whole hash
// computation in one go, fully blocking Node's single event loop thread
// for ~50-150ms each -- during which EVERY other request (other logins,
// live match polling, WebSocket ticks) stalls. The async hash()/compare()
// do the same work in chunks yielded back to the event loop, so the app
// stays responsive while a login is being checked. This only tests
// behavioral correctness of that migration, not the timing benefit itself
// (timing is inherently flaky in CI).
describe('bcrypt async hash/compare (replacing hashSync/compareSync)', () => {
  it('a password hashed with the async API verifies correctly with the async compare', async () => {
    const hash = await bcrypt.hash('correct-horse-battery-staple', 10);
    expect(await bcrypt.compare('correct-horse-battery-staple', hash)).toBe(true);
  });

  it('rejects the wrong password against an async-produced hash', async () => {
    const hash = await bcrypt.hash('correct-horse-battery-staple', 10);
    expect(await bcrypt.compare('wrong-password', hash)).toBe(false);
  });

  it('async compare still verifies a hash produced with the old sync API (no format change, safe migration)', async () => {
    const hash = bcrypt.hashSync('legacy-password-123', 10);
    expect(await bcrypt.compare('legacy-password-123', hash)).toBe(true);
    expect(await bcrypt.compare('wrong', hash)).toBe(false);
  });

  it('handles several concurrent hash+compare pairs correctly (no cross-talk between overlapping async calls)', async () => {
    const passwords = ['alpha1', 'bravo2', 'charlie3', 'delta4'];
    const hashes = await Promise.all(passwords.map((p) => bcrypt.hash(p, 10)));
    const results = await Promise.all(passwords.map((p, i) => bcrypt.compare(p, hashes[i])));
    expect(results).toEqual([true, true, true, true]);
    expect(await bcrypt.compare(passwords[0], hashes[1])).toBe(false);
  });
});
