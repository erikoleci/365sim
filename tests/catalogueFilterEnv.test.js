import { describe, it, expect, vi } from 'vitest';

// Env format the project is deployed with: mixed case, spaces, MAJOR_ONLY=1,
// LONDON365_FULL=1 -- plus the explicit opt-in for extra International names.
vi.hoisted(function () {
  process.env.LONDON365_ONLY_COUNTRIES = 'England, France,Spain , Italy,GERMANY';
  process.env.LONDON365_MAJOR_ONLY = '1';
  process.env.LONDON365_FULL = '1';
  process.env.LONDON365_INTERNATIONAL_EXTRA = 'fifa|world cup';
  return true;
});
vi.mock('../server/db.js', () => ({ default: { query: vi.fn() }, getKV: vi.fn(), setKV: vi.fn() }));
vi.mock('../server/ws.js', () => ({ pushOddsChanged: vi.fn(), pushGoal: vi.fn(), pushGoalDisallowed: vi.fn(), pushMatchEnded: vi.fn() }));
vi.mock('../server/matchSettlement.js', () => ({ settleMatch: vi.fn() }));
const l365 = await import('../server/london365.js');

describe('LONDON365_ONLY_COUNTRIES=England, France,Spain , Italy,GERMANY + MAJOR_ONLY=1 + FULL=1', () => {
  it('parses case/space-insensitively and adds International', () => {
    const c = l365.getLondon365FilterConfig();
    expect(c.onlyCountries.sort()).toEqual(['england', 'france', 'germany', 'international', 'italy', 'spain']);
    expect(c.fullDetail).toBe(true);
  });
  it('leagueRejectionReason is the same with FULL=1: country + competition decide, never FULL', () => {
    expect(l365.leagueRejectionReason('Premier League', 'England')).toBeNull();
    expect(l365.leagueRejectionReason('La Liga', 'Spain')).toBeNull();
    expect(l365.leagueRejectionReason('UEFA Champions League', 'International')).toBeNull();
    expect(l365.leagueRejectionReason('UEFA Europa League', 'International')).toBeNull();
    expect(l365.leagueRejectionReason('UEFA Nations League', 'International')).toBeNull();
    expect(l365.leagueRejectionReason('Super League', 'Zambia')).toBe('country-not-allowed');
    expect(l365.leagueRejectionReason('Primera', 'Paraguay')).toBe('country-not-allowed');
    expect(l365.leagueRejectionReason('Copa Libertadores', 'International')).toBe('international-not-major');
    expect(l365.leagueRejectionReason('UEFA Youth League', 'International')).toBe('international-not-major');
    expect(l365.leagueRejectionReason('U23 Premier League 2', 'England')).toBe('minor-league');
    expect(l365.leagueRejectionReason('Regionalliga West', 'Germany')).toBe('minor-league');
  });
  it('LONDON365_INTERNATIONAL_EXTRA is an explicit opt-in (FIFA / World Cup), still never youth or women\'s', () => {
    expect(l365.leagueRejectionReason('FIFA World Cup', 'International')).toBeNull();
    expect(l365.leagueRejectionReason('World Cup Qualification', 'International')).toBeNull();
    expect(l365.leagueRejectionReason('FIFA U20 World Cup', 'International')).toBe('international-not-major');
    expect(l365.leagueRejectionReason("FIFA Women's World Cup", 'International')).toBe('international-not-major');
  });
});

import { normalizeLiveMinute } from '../server/london365.js';

// Production bug (screenshot): matches_cache.live_minute held "300924" for a
// France vs Belgium match, which the old code turned into "5015:24" and the
// frontend then labeled "Penallti" (minute >= 105). 300924 is not a sane
// clock under either reading (not a plausible minute, and /60 is still way
// past 130), so it must now be treated as "no minute available".
describe('normalizeLiveMinute - rejects nonsense sentinel values', () => {
  it('discards a bare integer that is still over 130 minutes once read as seconds', () => {
    expect(normalizeLiveMinute('300924')).toBeNull(); // the exact production value (was "5015:24")
    expect(normalizeLiveMinute('999999')).toBeNull();
  });
  it('still converts a real seconds-based clock normally', () => {
    expect(normalizeLiveMinute('1776')).toBe('29:36'); // 29 min 36 sec, a normal in-play value
    expect(normalizeLiveMinute('7800')).toBe('130:00'); // boundary: exactly 130 minutes, still sane
  });
  it('leaves a plain minute value (<=130, or already mm:ss) untouched', () => {
    expect(normalizeLiveMinute('72')).toBe('72');
    expect(normalizeLiveMinute('62:14')).toBe('62:14');
  });
  it('passes through null/empty unchanged', () => {
    expect(normalizeLiveMinute(null)).toBeNull();
    expect(normalizeLiveMinute('')).toBe('');
  });
});
