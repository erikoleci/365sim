import { describe, it, expect, vi, beforeEach } from 'vitest';

const q = vi.fn();
vi.mock('../server/db.js', () => ({ default: { query: (...a) => q(...a) }, pool: { query: (...a) => q(...a) } }));
const { noteFeedGame, feedVerdictFor, runFeedWatch } = await import('../server/london365/liveSync.js');

const NOW = Date.parse('2026-11-18T18:10:00Z');
beforeEach(() => { q.mockReset(); });

describe('feed watch (log only)', () => {
  it('says what the provider list had for a game', () => {
    noteFeedGame('l365-1', { home_team: 'A', away_team: 'B', league: 'X' }, 'DROPPED_BY_FILTER');
    expect(feedVerdictFor('l365-1', Date.now()).verdict).toBe('DROPPED_BY_FILTER');
    expect(feedVerdictFor('l365-2', Date.now()).verdict).toBe('NOT_IN_PROVIDER_LIVE_LIST');
  });
  it('a game seen long ago no longer counts as listed', () => {
    noteFeedGame('l365-3', { home_team: 'A', away_team: 'B' }, 'ACCEPTED');
    expect(feedVerdictFor('l365-3', Date.now() + 10 * 60000).verdict).toBe('NOT_IN_PROVIDER_LIVE_LIST');
  });
  it('logs a ticketed match without live data once, with the provider verdict, and changes nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    q.mockResolvedValue({ rows: [{ id: 'l365-9', home_team: 'Real Madrid', away_team: 'Inter Milano', league: 'l365_international__uefa_champions_league_women', start_time: '2026-11-18T17:45:00.000Z', status: 'UPCOMING' }] });
    expect(await runFeedWatch(NOW + 3 * 60000)).toBe(1);
    expect(warn.mock.calls[0][0]).toMatch(/\[feed-watch\] l365-9 Real Madrid v Inter Milano .*NO live data: provider live list = NOT_IN_PROVIDER_LIVE_LIST/);
    expect(await runFeedWatch(NOW + 6 * 60000)).toBe(0); // same match is not repeated for 30 minutes
    expect(q.mock.calls.every((c) => /^\s*SELECT/i.test(c[0]))).toBe(true); // reads only
    warn.mockRestore();
  });
  it('runs at most every 2 minutes', async () => {
    q.mockResolvedValue({ rows: [] });
    await runFeedWatch(NOW + 20 * 60000);
    const calls = q.mock.calls.length;
    await runFeedWatch(NOW + 20 * 60000 + 30000);
    expect(q.mock.calls.length).toBe(calls);
  });
});
