import { describe, it, expect, vi } from 'vitest';

// LONDON365_DOMESTIC_TOP_FLIGHT_ONLY=0: back to top flight + second tier
// (the behaviour from the previous change), still with cups dropped.
vi.hoisted(() => { process.env.LONDON365_DOMESTIC_TOP_FLIGHT_ONLY = '0'; return true; });
vi.mock('../server/db.js', () => ({ default: { query: vi.fn() }, getKV: vi.fn(), setKV: vi.fn() }));
vi.mock('../server/ws.js', () => ({ pushOddsChanged: vi.fn(), pushGoal: vi.fn(), pushGoalDisallowed: vi.fn(), pushMatchEnded: vi.fn() }));
vi.mock('../server/matchSettlement.js', () => ({ settleMatch: vi.fn() }));
const l365 = await import('../server/london365.js');

describe('LONDON365_DOMESTIC_TOP_FLIGHT_ONLY=0', () => {
  it('reports it off and keeps the second tier alongside the top flight, cups still dropped', () => {
    expect(l365.getLondon365FilterConfig().domesticTopFlightOnly).toBe(false);
    for (const [n, c] of [['Serie A', 'Italy'], ['Serie B', 'Italy'], ['Championship', 'England'], ['2. Bundesliga', 'Germany'], ['LaLiga2', 'Spain'], ['Ligue 2', 'France']]) {
      expect(l365.leagueRejectionReason(n, c), n).toBeNull();
    }
    expect(l365.leagueRejectionReason('Coppa Italia', 'Italy')).toBe('not-top-flight');
  });
});
