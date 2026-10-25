import { describe, it, expect } from 'vitest';
import { pickProviderClock, clockFromSeconds } from '../server/london365GameDetails.js';

describe('provider clock (T) drives the shown minute', () => {
  it('formats the game clock in seconds', () => {
    expect(clockFromSeconds(3736)).toBe('62:16');
    expect(clockFromSeconds(0)).toBeNull();
    expect(clockFromSeconds(NaN)).toBeNull();
    expect(clockFromSeconds(9 * 3600)).toBeNull();
  });
  it('uses T when it is the same clock, just fresher than the stored minute', () => {
    expect(pickProviderClock('62:00', 3736)).toBe('62:16');   // stored 16 s behind
    expect(pickProviderClock('62:16', 3736)).toBe('62:16');
    expect(pickProviderClock('62', 3736)).toBe('62:16');      // bare minute from REST
    expect(pickProviderClock('62:20', 3736)).toBe('62:16');   // a few seconds ahead of T: still the same clock
    expect(pickProviderClock(null, 3736)).toBe('62:16');
  });
  it('keeps the stored minute when the two clocks disagree', () => {
    expect(pickProviderClock('62:00', 3736 + 600)).toBeNull(); // T 10 min ahead
    expect(pickProviderClock('70:00', 3736)).toBeNull();       // T far behind
    expect(pickProviderClock('45+', 3736)).toBeNull();         // stoppage label, not a running clock
    expect(pickProviderClock('62:00', 0)).toBeNull();          // no usable T
  });
});
