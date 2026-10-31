import { describe, it, expect, afterEach } from 'vitest';
import { noteServerTime, serverToLocal, serverNowStamp, __resetServerClockOffsetForTests } from '../utils/liveStatus.ts';
import { clockReceivedAt, projectClock } from '../components/MatchCard.tsx';

afterEach(() => __resetServerClockOffsetForTests());

describe('server clock offset (seconds of the match clock stay in step with the server)', () => {
  it('a phone 8 s AHEAD of the server no longer shows the clock 8 s ahead', () => {
    const now = 1_000_000_000_000;
    noteServerTime(now - 8000, now); // server says it is 8 s earlier than the phone thinks
    const stamp = now - 8000 - 1000; // reading taken 1 s ago in server time
    expect(clockReceivedAt(stamp, now)).toBe(now - 1000); // 1 s ago on the phone's clock too
    expect(projectClock(46 * 60 + 58, clockReceivedAt(stamp, now), now)).toMatchObject({ minute: 46, second: 59 });
  });
  it('a phone BEHIND the server is not thrown away as "from the future"', () => {
    const now = 1_000_000_000_000;
    noteServerTime(now + 6000, now);
    const stamp = now + 6000 - 500;
    expect(clockReceivedAt(stamp, now)).toBe(now - 500);
  });
  it('without a server time nothing changes, and absurd values are ignored', () => {
    const now = 1_000_000_000_000;
    expect(clockReceivedAt(now - 5000, now)).toBe(now - 5000);
    noteServerTime(now + 3 * 3600 * 1000, now);
    expect(serverToLocal(now)).toBe(now);
    noteServerTime(undefined, now);
    noteServerTime('x', now);
    expect(serverToLocal(now)).toBe(now);
  });
  it('the fallback stamp for a reading without one is "now" in server time', () => {
    const t = Date.now();
    noteServerTime(t + 4000, t);
    expect(Math.abs(serverNowStamp() - (Date.now() + 4000))).toBeLessThan(50);
  });
});
