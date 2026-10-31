import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { riskPolicy } from '../server/liveRisk.js';

// Guards for what must never be weakened by a speed change: live data is the priority, and a ticket is always checked
// against the CURRENT database state (never a cached list), with the longer waits for flagged users kept.
describe('live integrity', () => {
  it('placing a ticket reads the database, never the in-memory match list', () => {
    const src = readFileSync(new URL('../server/routes/bets.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/routes\/matches|matchesResponseCache|getMatchesResponseCache/);
    expect(src).toMatch(/FROM matches_cache WHERE id = \$1/);
  });
  it('a live ticket is checked again after the delay (second verification)', () => {
    const src = readFileSync(new URL('../server/routes/bets.js', import.meta.url), 'utf8');
    expect(src).toMatch(/verified = await verifySelections\(LIVE_REPRICE_TOLERANCE\)/);
  });
  it('flagged users wait longer than normal users, and have a lower live stake', () => {
    const normal = riskPolicy('NORMAL', 5000);
    const watch = riskPolicy('WATCH', 5000);
    const restricted = riskPolicy('RESTRICTED', 5000);
    expect(normal.delayMs).toBe(5000);
    expect(watch.delayMs).toBeGreaterThanOrEqual(10000);
    expect(restricted.delayMs).toBeGreaterThanOrEqual(15000);
    expect(watch.stakeFactor).toBeLessThan(1);
    expect(restricted.stakeFactor).toBeLessThan(watch.stakeFactor);
  });
  it('the list served from memory is never what decides a bet or a live minute', () => {
    const feed = readFileSync(new URL('../hooks/useMatchesFeed.ts', import.meta.url), 'utf8');
    expect(feed).toMatch(/loadLiveRef\.current\(\)/); // live rows are overlaid after every list
  });
});
