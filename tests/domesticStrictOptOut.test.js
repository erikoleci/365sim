import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => { process.env.LONDON365_DOMESTIC_STRICT = '0'; return true; });
vi.mock('../server/db.js', () => ({ default: { query: vi.fn() }, getKV: vi.fn(), setKV: vi.fn() }));
vi.mock('../server/ws.js', () => ({ pushOddsChanged: vi.fn(), pushGoal: vi.fn(), pushGoalDisallowed: vi.fn(), pushMatchEnded: vi.fn() }));
vi.mock('../server/matchSettlement.js', () => ({ settleMatch: vi.fn() }));
const l365 = await import('../server/london365.js');

describe('LONDON365_DOMESTIC_STRICT=0 (opt-out)', () => {
  it('falls back to "anything not minor" for the five countries (cups included)', () => {
    expect(l365.getLondon365FilterConfig().domesticStrict).toBe(false);
    expect(l365.leagueRejectionReason('Coppa Italia', 'Italy')).toBeNull();
    expect(l365.leagueRejectionReason('FA Cup', 'England')).toBeNull();
    expect(l365.leagueRejectionReason('Serie A', 'Italy')).toBeNull();
  });
});
