import { describe, it, expect } from 'vitest';
import { firstHalfDividerIndex, eventMinuteLabel, isFirstHalfEvent, isSecondHalfEvent } from '../utils/eventHalf';

const ev = (minute, half) => ({ minute, half });
const ctx = (o = {}) => ({ halftime: false, finished: false, minuteNow: NaN, liveStatus: '2H', ...o });

describe('first-half stoppage time stays in the first half', () => {
  // the screenshot: corner 11', 3 yellow cards, goal 45', then a corner at 47' (45+2) of the FIRST half
  const events = [ev(11, 1), ev(25, 1), ev(29, 1), ev(35, 1), ev(45, 1), ev(47, 1)];
  it('puts the divider after the 47\' corner when the half says first half', () => {
    expect(firstHalfDividerIndex(events, ctx({ halftime: true }))).toBe(6); // at the end: nothing after the break yet
    const withSecond = [...events, ev(47, 2)];
    expect(firstHalfDividerIndex(withSecond, ctx())).toBe(6); // the real 47' of the 2nd half goes after
  });
  it('labels it 45+2\'', () => {
    expect(eventMinuteLabel(ev(47, 1))).toBe("45+2'");
    expect(eventMinuteLabel(ev(47, 2))).toBe("47'");
    expect(eventMinuteLabel(ev(93, 2))).toBe("90+3'");
    expect(eventMinuteLabel(ev(45, 1))).toBe("45'");
    expect(eventMinuteLabel(ev(null, 1))).toBe('-');
  });
  it('the divider does not appear while the first half is still being played (stoppage time)', () => {
    expect(firstHalfDividerIndex(events, ctx({ liveStatus: '1H', minuteNow: 47 }))).toBeNull();
  });
  it('older rows without a half fall back to the minute', () => {
    const old = [ev(12), ev(44), ev(46), ev(70)];
    expect(isFirstHalfEvent(ev(44))).toBe(true);
    expect(isSecondHalfEvent(ev(46))).toBe(true);
    expect(firstHalfDividerIndex(old, ctx())).toBe(2);
    expect(eventMinuteLabel(ev(47))).toBe("47'");
  });
  it('no divider before the first half has any event', () => {
    expect(firstHalfDividerIndex([ev(50, 2)], ctx())).toBeNull();
    expect(firstHalfDividerIndex([], ctx({ halftime: true }))).toBeNull();
  });
});
