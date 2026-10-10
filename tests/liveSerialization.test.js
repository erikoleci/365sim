import { describe, it, expect } from 'vitest';
import { mapEventToMatch } from '../server/oddsUtils.js';

// API serialization of live fields (matches_cache row -> /api/matches item).
const raw = JSON.stringify({ id: 'l365-5200421', home_team: 'Chelsea', away_team: 'Bournemouth', commence_time: '2026-10-10T14:00:00.000Z', bookmakers: [] });
const row = (o = {}) => ({
  id: 'l365-5200421', league: 'l365_england__premier_league', league_id: '222545', country_id: '64',
  home_team: 'Chelsea', away_team: 'Bournemouth', start_time: new Date(Date.now() - 80 * 60000).toISOString(),
  status: 'LIVE', raw_json: raw, live_home_score: null, live_away_score: null, live_minute: null, live_status: null, live_minute_updated_at: null, ...o,
});

describe('mapEventToMatch - live fields', () => {
  it('serialises the provider score, minute, stamp and status code as sent (the 5-1 / 75:39 sample)', () => {
    const m = mapEventToMatch(row({ live_home_score: 5, live_away_score: 1, live_minute: '75:39', live_status: '3', live_minute_updated_at: '1791646491714' }));
    expect(m).toMatchObject({ id: 'l365-5200421', leagueId: '222545', countryId: '64', liveHomeScore: 5, liveAwayScore: 1, currentMinute: '75:39', currentMinuteUpdatedAt: 1791646491714, liveStatus: '3', homeTeam: 'Chelsea', awayTeam: 'Bournemouth' });
    expect(m.currentMinuteEstimated).toBeUndefined();
  });
  it('an explicit provider 0-0 stays 0-0 (not turned into "missing")', () => {
    const m = mapEventToMatch(row({ live_home_score: 0, live_away_score: 0, live_minute: '12:05' }));
    expect(m.liveHomeScore).toBe(0);
    expect(m.liveAwayScore).toBe(0);
  });
  it('a missing score stays missing (undefined), never 0-0', () => {
    const m = mapEventToMatch(row());
    expect(m.liveHomeScore).toBeUndefined();
    expect(m.liveAwayScore).toBeUndefined();
  });
  it('the estimated minute carries no server timestamp, so nothing can pretend it is a provider clock', () => {
    const m = mapEventToMatch(row({ start_time: new Date(Date.now() - 20 * 60000).toISOString() }));
    expect(m.currentMinuteEstimated).toBe(true);
    expect(m.currentMinuteUpdatedAt).toBeUndefined();
  });
});
