import { describe, it, expect, vi } from 'vitest';

// Final brief: cups/super cups of the five countries are WATCHED and must be
// kept. Only the professional second tier (nobody watches it) is excluded by
// name. Top flight and cups both pass; youth/reserve/regional/women's are
// still rejected as minor-league (unchanged, checked first).
vi.mock('../server/db.js', () => ({ default: { query: vi.fn() }, getKV: vi.fn(), setKV: vi.fn() }));
vi.mock('../server/ws.js', () => ({ pushOddsChanged: vi.fn(), pushGoal: vi.fn(), pushGoalDisallowed: vi.fn(), pushMatchEnded: vi.fn() }));
vi.mock('../server/matchSettlement.js', () => ({ settleMatch: vi.fn() }));
const l365 = await import('../server/london365.js');

describe('second-tier exclusion (default: on), cups KEPT', () => {
  it('config reports it on by default', () => {
    expect(l365.getLondon365FilterConfig().excludeSecondTier).toBe(true);
  });

  it('keeps the top flight for each of the five countries', () => {
    for (const [n, c] of [['Premier League', 'England'], ['Ligue 1', 'France'], ['La Liga', 'Spain'], ['Serie A', 'Italy'], ['Bundesliga', 'Germany']]) {
      expect(l365.leagueRejectionReason(n, c), n).toBeNull();
    }
  });

  it('KEEPS domestic cups and super cups (they are watched)', () => {
    const kept = [
      ['FA Cup', 'England'], ['EFL Cup', 'England'], ['Community Shield', 'England'],
      ['Coupe de France', 'France'], ['Trophee des Champions', 'France'],
      ['Copa del Rey', 'Spain'], ['Supercopa de Espana', 'Spain'],
      ['Coppa Italia', 'Italy'], ['Supercoppa Italiana', 'Italy'],
      ['DFB-Pokal', 'Germany'], ['DFL-Supercup', 'Germany'],
    ];
    for (const [name, country] of kept) expect(l365.leagueRejectionReason(name, country), name).toBeNull();
  });

  it('drops the professional second tier by name only', () => {
    const dropped = [
      ['Championship', 'England'], ['Ligue 2', 'France'],
      ['LaLiga2', 'Spain'], ['Segunda Division', 'Spain'],
      ['Serie B', 'Italy'], ['2. Bundesliga', 'Germany'],
    ];
    for (const [name, country] of dropped) expect(l365.leagueRejectionReason(name, country), name).toBe('second-tier-excluded');
  });

  it('does not affect the International bucket', () => {
    expect(l365.leagueRejectionReason('UEFA Champions League', 'International')).toBeNull();
    expect(l365.leagueRejectionReason('UEFA Europa League', 'International')).toBeNull();
    expect(l365.leagueRejectionReason('UEFA Nations League', 'International')).toBeNull();
    expect(l365.leagueRejectionReason('Copa Libertadores', 'International')).toBe('international-not-major');
  });

  it('youth/reserve/lower-tier is still rejected as minor-league', () => {
    expect(l365.leagueRejectionReason('England U23 Premier League 2', 'England')).toBe('minor-league');
    expect(l365.leagueRejectionReason('Germany Regionalliga West', 'Germany')).toBe('minor-league');
  });

  it('isAllowedByCountryFilter (live entry points) applies the same rule: cups pass, second tier does not', () => {
    expect(l365.isAllowedByCountryFilter({ league: 'Italy Serie A' }, null)).toBe(true);
    expect(l365.isAllowedByCountryFilter({ league: 'Italy Coppa Italia' }, null)).toBe(true);
    expect(l365.isAllowedByCountryFilter({ league: 'Italy Serie B' }, null)).toBe(false);
    expect(l365.isAllowedByCountryFilter({ league: 'England FA Cup' }, null)).toBe(true);
    expect(l365.isAllowedByCountryFilter({ league: 'England Championship' }, null)).toBe(false);
  });
});
