import { describe, it, expect } from 'vitest';
import { isStaleLive, MAX_LIVE_AGE_MS, mapEventToMatch } from '../server/oddsUtils.js';
import { hasRealLiveResult } from '../server/london365.js';

const HOUR = 60 * 60 * 1000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

describe('isStaleLive', () => {
  it('a match 5 minutes or 2 hours into play is not stale', () => {
    expect(isStaleLive(iso(5 * 60 * 1000), 'LIVE')).toBe(false);
    expect(isStaleLive(iso(2 * HOUR), 'LIVE')).toBe(false);
  });
  it('a never-finished match days after kickoff is stale (UPCOMING or LIVE in the DB)', () => {
    expect(isStaleLive(iso(48 * HOUR), 'LIVE')).toBe(true);
    expect(isStaleLive(iso(30 * HOUR), 'UPCOMING')).toBe(true);
  });
  it('FINISHED rows and future kickoffs are never "stale live"', () => {
    expect(isStaleLive(iso(48 * HOUR), 'FINISHED')).toBe(false);
    expect(isStaleLive(new Date(Date.now() + 3 * HOUR).toISOString(), 'UPCOMING')).toBe(false);
  });
  it('the limit is 4 hours by default', () => {
    expect(MAX_LIVE_AGE_MS).toBe(4 * HOUR);
  });
});

describe('mapEventToMatch drops abandoned matches out of LIVE', () => {
  const row = (start, status) => ({
    id: 'l365-1', league: 'l365_x__y', home_team: 'Kosovo', away_team: 'Austria',
    start_time: start, status, live_home_score: null, live_away_score: null, live_minute: null,
    raw_json: JSON.stringify({ home_team: 'Kosovo', away_team: 'Austria', bookmakers: [] }),
  });
  it('a 2-day-old unfinished row is FINISHED, not LIVE', () => {
    expect(mapEventToMatch(row(iso(48 * HOUR), 'UPCOMING')).status).toBe('FINISHED');
    expect(mapEventToMatch(row(iso(48 * HOUR), 'LIVE')).status).toBe('FINISHED');
  });
  it('a match that kicked off 30 minutes ago is still LIVE', () => {
    expect(mapEventToMatch(row(iso(30 * 60 * 1000), 'LIVE')).status).toBe('LIVE');
  });
});

describe('hasRealLiveResult (auto-settle guard)', () => {
  it('needs both a stored score and a provider clock', () => {
    expect(hasRealLiveResult({ live_home_score: 2, live_away_score: 1, live_minute: '90:12' })).toBe(true);
    expect(hasRealLiveResult({ live_home_score: 0, live_away_score: 0, live_minute: '77:03' })).toBe(true);
  });
  it('a row that never had live data must NOT be settled as 0-0', () => {
    expect(hasRealLiveResult({ live_home_score: null, live_away_score: null, live_minute: null })).toBe(false);
    expect(hasRealLiveResult({ live_home_score: 0, live_away_score: 0, live_minute: null })).toBe(false);
    expect(hasRealLiveResult({ live_home_score: null, live_away_score: null, live_minute: '12' })).toBe(false);
    expect(hasRealLiveResult(undefined)).toBe(false);
  });
});
