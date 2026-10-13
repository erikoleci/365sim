import { describe, it, expect, vi } from 'vitest';

// LONDON365_ALL_MATCHES=1 is the single master switch for "every match".
vi.hoisted(function () { process.env.LONDON365_ALL_MATCHES = '1'; return true; });
vi.mock('../server/db.js', () => ({ default: { query: vi.fn() }, getKV: vi.fn(), setKV: vi.fn() }));
vi.mock('../server/ws.js', () => ({ pushOddsChanged: vi.fn(), pushGoal: vi.fn(), pushGoalDisallowed: vi.fn(), pushMatchEnded: vi.fn() }));
vi.mock('../server/matchSettlement.js', () => ({ settleMatch: vi.fn() }));
const l365 = await import('../server/london365.js');

describe('LONDON365_ALL_MATCHES=1', () => {
  it('turns every catalogue restriction off and reports it', () => {
    const c = l365.getLondon365FilterConfig();
    expect(c.allMatches).toBe(true);
    expect(c.whitelistActive).toBe(false);
    expect(c.majorOnly).toBe(false);
    expect(c.excludeSecondTier).toBe(false);
    expect(c.excludeCountries).toEqual([]);
  });
  it('lets through leagues the default catalogue rejects (any country, lower divisions)', () => {
    expect(l365.leagueRejectionReason('Super League', 'Zambia')).toBeNull();
    expect(l365.leagueRejectionReason('Championship', 'England')).toBeNull();
    expect(l365.leagueRejectionReason('Serie A', 'Brazil')).toBeNull();
    expect(l365.isAllowedByCountryFilter({ league: 'anything' }, null)).toBe(true);
  });
});
