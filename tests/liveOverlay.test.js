import { describe, it, expect } from 'vitest';
import { overlayLiveTick, OVERLAY_MAX_AGE_MS } from '../server/liveOverlay.js';

const NOW = 1_800_000_000_000;
const row = (o = {}) => ({ id: 'l365-1', live_minute: '44:10', live_minute_updated_at: NOW - 14000, live_status: '1H', live_home_score: 0, live_away_score: 0, ...o });
const tick = (o = {}) => ({ minute: '46:59', minuteUpdatedAt: NOW - 800, homeScore: 1, awayScore: 0, liveStatus: '1H', ts: NOW - 800, ...o });

describe('overlayLiveTick: the page that is just opened gets what the websocket knows', () => {
  it('lays the newest tick (minute with seconds, stamp, score, status) over the database row', () => {
    const r = overlayLiveTick(row(), tick(), NOW);
    expect(r).toMatchObject({ live_minute: '46:59', live_minute_updated_at: NOW - 800, live_home_score: 1, live_status: '1H' });
  });
  it('half-time from the tick wins over a stale row status', () => {
    expect(overlayLiveTick(row(), tick({ liveStatus: 'HT' }), NOW).live_status).toBe('HT');
  });
  it('keeps the row when there is no tick, the tick is old, or the row is newer', () => {
    const r = row();
    expect(overlayLiveTick(r, null, NOW)).toBe(r);
    expect(overlayLiveTick(r, tick({ ts: NOW - OVERLAY_MAX_AGE_MS - 1 }), NOW)).toBe(r);
    expect(overlayLiveTick(r, tick({ minute: undefined }), NOW)).toBe(r);
  });
  it('keeps a row that is stamped later AND whose clock is really further on', () => {
    const r = row({ live_minute: '47:30', live_minute_updated_at: NOW - 14000 });
    expect(overlayLiveTick(r, tick({ minuteUpdatedAt: NOW - 20000 }), NOW)).toBe(r);
  });
  it('a row stamped later but with an OLDER clock (a stale REST minute stamped fresh) does not win', () => {
    // the REST sync wrote "46:20" 2 s ago, but the websocket said 46:59 800 ms ago: 46:59 is the truth
    const stale = row({ live_minute: '46:20', live_minute_updated_at: NOW - 200 });
    const r = overlayLiveTick(stale, tick({ minute: '46:59', minuteUpdatedAt: NOW - 800 }), NOW);
    expect(r.live_minute).toBe('46:59');
    // a bare REST minute is only a lower bound for the seconds and loses to a clock with seconds too
    const bare = row({ live_minute: '46', live_minute_updated_at: NOW - 200 });
    expect(overlayLiveTick(bare, tick(), NOW).live_minute).toBe('46:59');
  });
  it('a tick without a status keeps the row status; without a score keeps the row score', () => {
    const r = overlayLiveTick(row({ live_home_score: 2 }), tick({ liveStatus: undefined, homeScore: undefined }), NOW);
    expect(r.live_status).toBe('1H');
    expect(r.live_home_score).toBe(2);
  });
});
