import { describe, it, expect, vi } from 'vitest';

// Default behaviour: for the five whitelisted countries, keep ONLY the top
// flight + professional second tier (e.g. Serie A + Serie B). Cups, super
// cups and anything else with that country's name are dropped. International
// (UCL/UEL/Nations League) is unaffected by this.
vi.mock('../server/db.js', () => ({ default: { query: vi.fn() }, getKV: vi.fn(), setKV: vi.fn() }));
vi.mock('../server/ws.js', () => ({ pushOddsChanged: vi.fn(), pushGoal: vi.fn(), pushGoalDisallowed: vi.fn(), pushMatchEnded: vi.fn() }));
vi.mock('../server/matchSettlement.js', () => ({ settleMatch: vi.fn() }));
const l365 = await import('../server/london365.js');

describe('domestic strict allowlist (default: on)', () => {
  it('config reports it on by default', () => {
    expect(l365.getLondon365FilterConfig().domesticStrict).toBe(true);
  });

  it('keeps ONLY the top flight for each of the five countries (default: top-flight-only)', () => {
    const kept = [
      ['Premier League', 'England'], ['Ligue 1', 'France'],
      ['La Liga', 'Spain'], ['Primera Division', 'Spain'],
      ['Serie A', 'Italy'], ['Bundesliga', 'Germany'],
    ];
    for (const [name, country] of kept) expect(l365.leagueRejectionReason(name, country), name).toBeNull();
  });

  it('drops the professional second tier by default (nobody watches it, per the brief)', () => {
    const dropped = [
      ['Championship', 'England'], ['Ligue 2', 'France'],
      ['LaLiga2', 'Spain'], ['Segunda Division', 'Spain'],
      ['Serie B', 'Italy'], ['2. Bundesliga', 'Germany'],
    ];
    for (const [name, country] of dropped) expect(l365.leagueRejectionReason(name, country), name).toBe('not-top-flight');
  });

  it('drops cups, super cups and other domestic competitions of the five countries', () => {
    const dropped = [
      ['FA Cup', 'England'], ['EFL Cup', 'England'], ['Community Shield', 'England'],
      ['Coupe de France', 'France'], ['Trophee des Champions', 'France'],
      ['Copa del Rey', 'Spain'], ['Supercopa de Espana', 'Spain'],
      ['Coppa Italia', 'Italy'], ['Supercoppa Italiana', 'Italy'],
      ['DFB-Pokal', 'Germany'], ['DFL-Supercup', 'Germany'],
    ];
    for (const [name, country] of dropped) expect(l365.leagueRejectionReason(name, country), name).toBe('not-top-flight');
  });

  it('does not affect the International bucket (UCL/UEL/Nations League still kept, others still rejected)', () => {
    expect(l365.leagueRejectionReason('UEFA Champions League', 'International')).toBeNull();
    expect(l365.leagueRejectionReason('UEFA Europa League', 'International')).toBeNull();
    expect(l365.leagueRejectionReason('UEFA Nations League', 'International')).toBeNull();
    expect(l365.leagueRejectionReason('Copa Libertadores', 'International')).toBe('international-not-major');
  });

  it('youth/reserve/lower-tier is still rejected as minor-league, not shadowed by the strict check', () => {
    expect(l365.leagueRejectionReason('England U23 Premier League 2', 'England')).toBe('minor-league');
    expect(l365.leagueRejectionReason('Germany Regionalliga West', 'Germany')).toBe('minor-league');
  });

  it('isAllowedByCountryFilter (live entry points) applies the same rule for an unresolved league', () => {
    expect(l365.isAllowedByCountryFilter({ league: 'Italy Serie A' }, null)).toBe(true);
    expect(l365.isAllowedByCountryFilter({ league: 'Italy Serie B' }, null)).toBe(false);
    expect(l365.isAllowedByCountryFilter({ league: 'Italy Coppa Italia' }, null)).toBe(false);
    expect(l365.isAllowedByCountryFilter({ league: 'England FA Cup' }, null)).toBe(false);
  });
});
