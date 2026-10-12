import { describe, it, expect } from 'vitest';
import {
  parseLiveClock, projectClock, MAX_PROJECTION_SECONDS, MAX_PROJECTION_BARE_MINUTE_SECONDS, shouldAcceptNewClockBase, clockReceivedAt,
} from '../components/MatchCard.tsx';
import { formatEstimatedMinute, liveMinuteFallback, isMessageForMatch, isHalftime, isGhostLiveMatch, isLiveClockStale } from '../utils/liveStatus.ts';

describe('parseLiveClock - verified provider formats and rejects', () => {
  it('parses "72", "72:14" and the live API sample "75:39"', () => {
    expect(parseLiveClock('72')).toEqual({ minute: 72, second: 0, half: 'Pjesa II' });
    expect(parseLiveClock('72:14')).toEqual({ minute: 72, second: 14, half: 'Pjesa II' });
    expect(parseLiveClock('75:39')).toEqual({ minute: 75, second: 39, half: 'Pjesa II' });
  });
  it('rejects empty / malformed / implausible values', () => {
    expect(parseLiveClock('')).toBeNull();
    expect(parseLiveClock(undefined)).toBeNull();
    expect(parseLiveClock('abc')).toBeNull();
    expect(parseLiveClock('11081:42')).toEqual({ minute: 11081, second: 42, half: 'Penallti' }); // parsed, but useTickingClock refuses > 130 min
    expect(parseLiveClock('300924')).toBeNull();
  });
});

describe('projectClock - never runs on forever', () => {
  const T = 1_000_000;
  const base = 75 * 60 + 39;
  it('still counts normally for a few seconds', () => {
    expect(projectClock(base, T, T + 7000)).toEqual({ minute: 75, second: 46, half: 'Pjesa II' });
  });
  it('freezes after MAX_PROJECTION_SECONDS without a new provider reading (feed stopped)', () => {
    const frozen = projectClock(base, T, T + (MAX_PROJECTION_SECONDS + 5) * 1000);
    const hoursLater = projectClock(base, T, T + 3 * 3600 * 1000);
    expect(hoursLater).toEqual(frozen);
    expect(frozen.minute * 60 + frozen.second).toBe(base + MAX_PROJECTION_SECONDS);
  });
  it('a bare minute ("72") cannot roll over into the next minute ahead of the provider', () => {
    const r = projectClock(72 * 60, T, T + 10 * 60 * 1000, MAX_PROJECTION_BARE_MINUTE_SECONDS);
    expect(r.minute).toBe(72);
    expect(r.second).toBe(59);
  });
  it('a clock stamp from the future or hours old is ignored in favour of "now"', () => {
    const now = 10_000_000_000;
    expect(clockReceivedAt(now + 5000, now)).toBe(now);
    expect(clockReceivedAt(now - 4 * 3600 * 1000, now)).toBe(now);
    expect(clockReceivedAt(now - 5000, now)).toBe(now - 5000);
  });
  it('a stale update still never rewinds the shown clock', () => {
    const cur = { totalSeconds: 75 * 60, receivedAt: 1000 };
    expect(shouldAcceptNewClockBase(cur, 72 * 60, 1000 + 30_000)).toBe(false);
  });
});

describe('estimated minute is never shown as a precise clock', () => {
  it('formats as a rounded "~40\'" (no seconds)', () => {
    expect(formatEstimatedMinute('40')).toBe("~40'");
    expect(formatEstimatedMinute('45+')).toBe('~45+');
    expect(formatEstimatedMinute('90+')).toBe('~90+');
    expect(formatEstimatedMinute(undefined)).toBe('LIVE');
  });
  it('badge fallback: estimate vs provider minute vs nothing', () => {
    expect(liveMinuteFallback({ currentMinute: '40', currentMinuteEstimated: true })).toBe('LIVE'); // a guess is never shown as a minute
    expect(liveMinuteFallback({ currentMinute: '61' })).toBe("61'");
    expect(liveMinuteFallback({})).toBe('LIVE');
  });
});

describe('live messages reach the displayed row even when the fixture has two provider ids', () => {
  it('matches the row id and the liveSourceId, nothing else', () => {
    const row = { id: 'l365-5122706', liveSourceId: 'l365-5200421' };
    expect(isMessageForMatch(row, 'l365-5122706')).toBe(true);
    expect(isMessageForMatch(row, 'l365-5200421')).toBe(true);
    expect(isMessageForMatch(row, 'l365-999')).toBe(false);
    expect(isMessageForMatch({ id: 'l365-1' }, 'l365-2')).toBe(false);
  });
});

describe('halftime / full-time statuses (text codes only; numeric provider codes are unverified)', () => {
  it('HT stops the clock', () => {
    expect(isHalftime({ liveStatus: 'HT' })).toBe(true);
    expect(isHalftime({ liveStatus: '2H' })).toBe(false);
  });
});

describe('isGhostLiveMatch - LIVE rows that are not receiving live data are hidden', () => {
  const NOW = Date.parse('2026-10-11T16:47:00.000Z');
  const kick = (minsAgo) => new Date(NOW - minsAgo * 60000).toISOString();
  it('hides an estimated minute ("~60\'") and a LIVE row with no minute at all', () => {
    expect(isGhostLiveMatch({ status: 'LIVE', startTime: kick(62), currentMinute: '60', currentMinuteEstimated: true }, NOW)).toBe(true);
    expect(isGhostLiveMatch({ status: 'LIVE', startTime: kick(130) }, NOW)).toBe(true);
  });
  it('keeps a row with a real provider clock', () => {
    expect(isGhostLiveMatch({ status: 'LIVE', startTime: kick(62), currentMinute: '58:49' }, NOW)).toBe(false);
  });
  it('keeps halftime and a match that kicked off a moment ago', () => {
    expect(isGhostLiveMatch({ status: 'LIVE', startTime: kick(50), liveStatus: 'HT' }, NOW)).toBe(false);
    expect(isGhostLiveMatch({ status: 'LIVE', startTime: kick(2) }, NOW)).toBe(false);
  });
  it('only ever concerns LIVE rows', () => {
    expect(isGhostLiveMatch({ status: 'UPCOMING', startTime: kick(-30) }, NOW)).toBe(false);
    expect(isGhostLiveMatch({ status: 'FINISHED', startTime: kick(200) }, NOW)).toBe(false);
  });
});

describe('halftime / feed gaps are not ghosts, a frozen clock is flagged', () => {
  const NOW = Date.parse('2026-10-11T16:47:00.000Z');
  const kick = (m) => new Date(NOW - m * 60000).toISOString();
  it('a row with no minute right now but a provider stamp from the last 30 min stays visible (halftime)', () => {
    expect(isGhostLiveMatch({ status: 'LIVE', startTime: kick(55), currentMinute: undefined, currentMinuteUpdatedAt: NOW - 10 * 60000 }, NOW)).toBe(false);
  });
  it('an old stamp (hours) does not protect a dead row', () => {
    expect(isGhostLiveMatch({ status: 'LIVE', startTime: kick(200), currentMinuteUpdatedAt: NOW - 3 * 3600000 }, NOW)).toBe(true);
  });
  it('flags a clock that stopped moving, not a fresh one, not halftime, not an estimate', () => {
    const base = { status: 'LIVE', currentMinute: '72:14', currentMinuteEstimated: false };
    expect(isLiveClockStale({ ...base, currentMinuteUpdatedAt: NOW - 10_000 }, NOW)).toBe(false);
    expect(isLiveClockStale({ ...base, currentMinuteUpdatedAt: NOW - 200_000 }, NOW)).toBe(true);
    expect(isLiveClockStale({ ...base, liveStatus: 'HT', currentMinuteUpdatedAt: NOW - 600_000 }, NOW)).toBe(false);
    expect(isLiveClockStale({ ...base, currentMinuteEstimated: true, currentMinuteUpdatedAt: NOW - 600_000 }, NOW)).toBe(false);
  });
});
