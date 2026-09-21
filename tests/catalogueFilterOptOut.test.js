import { describe, it, expect, vi } from 'vitest';

// '*' is the explicit, visible opt-out of the whitelist (worldwide import).
vi.hoisted(function () { process.env.LONDON365_ONLY_COUNTRIES = '*'; return true; });
vi.mock('../server/db.js', () => ({ default: { query: vi.fn() }, getKV: vi.fn(), setKV: vi.fn() }));
vi.mock('../server/ws.js', () => ({ pushOddsChanged: vi.fn(), pushGoal: vi.fn(), pushGoalDisallowed: vi.fn(), pushMatchEnded: vi.fn() }));
vi.mock('../server/matchSettlement.js', () => ({ settleMatch: vi.fn() }));
const l365 = await import('../server/london365.js');

describe("LONDON365_ONLY_COUNTRIES='*'", () => {
  it('disables the whitelist explicitly (and reports it)', () => {
    expect(l365.getLondon365FilterConfig().whitelistActive).toBe(false);
    expect(l365.leagueRejectionReason('Super League', 'Zambia')).toBeNull();
    expect(l365.isAllowedByCountryFilter({ league: 'anything' }, null)).toBe(true);
  });
  it('MAJOR_ONLY still applies without a whitelist', () => {
    expect(l365.leagueRejectionReason('U20 League', 'China')).toBe('minor-league');
  });
});
