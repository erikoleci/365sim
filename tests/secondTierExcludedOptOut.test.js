import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => { process.env.LONDON365_EXCLUDE_SECOND_TIER = '0'; return true; });
vi.mock('../server/db.js', () => ({ default: { query: vi.fn() }, getKV: vi.fn(), setKV: vi.fn() }));
vi.mock('../server/ws.js', () => ({ pushOddsChanged: vi.fn(), pushGoal: vi.fn(), pushGoalDisallowed: vi.fn(), pushMatchEnded: vi.fn() }));
vi.mock('../server/matchSettlement.js', () => ({ settleMatch: vi.fn() }));
const l365 = await import('../server/london365.js');

describe('LONDON365_EXCLUDE_SECOND_TIER=0', () => {
  it('keeps the second tier too (cups always were kept)', () => {
    expect(l365.getLondon365FilterConfig().excludeSecondTier).toBe(false);
    for (const [n, c] of [['Serie B', 'Italy'], ['Championship', 'England'], ['2. Bundesliga', 'Germany']]) {
      expect(l365.leagueRejectionReason(n, c), n).toBeNull();
    }
  });
});
