import { describe, it, expect, vi } from 'vitest';

vi.mock('../server/db.js', () => ({ default: { query: async () => ({ rows: [] }), connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) }, queryWithRetry: async () => ({ rows: [] }) }));
const { halfTimeFromGoalEvents } = await import('../server/matchSettlement.js');

const g = (id, team, half, minute, at) => ({ id, team, half, minute, created_at: at ?? id });
const H = 'Racing'; const A = 'Real';

describe('half-time score rebuilt from the goal events (only when certain)', () => {
  it('0-0 is 0-0 at the break', () => {
    expect(halfTimeFromGoalEvents([], H, A, 0, 0)).toEqual({ htHome: 0, htAway: 0 });
  });
  it('counts the first-half goals of each side', () => {
    const ev = [g(1, A, 1, 12), g(2, A, 1, 33), g(3, H, 2, 60), g(4, A, 2, 88)];
    expect(halfTimeFromGoalEvents(ev, H, A, 1, 3)).toEqual({ htHome: 0, htAway: 2 });
  });
  it('also reads the home/away side names used by other events', () => {
    const ev = [g(1, 'away', 1, 12), g(2, 'home', 2, 70)];
    expect(halfTimeFromGoalEvents(ev, H, A, 1, 1)).toEqual({ htHome: 0, htAway: 1 });
  });
  it('first-half stoppage time (45+3 logged as 48) still counts as the first half', () => {
    expect(halfTimeFromGoalEvents([g(1, A, 1, 48), g(2, A, 2, 70)], H, A, 0, 2)).toEqual({ htHome: 0, htAway: 1 });
  });
  it('gives up (undefined) when anything is doubtful: missing goals, no half, a half that contradicts its minute, wrong order', () => {
    expect(halfTimeFromGoalEvents([g(1, A, 1, 12)], H, A, 0, 2)).toBeUndefined();                 // a goal is missing from the log
    expect(halfTimeFromGoalEvents([g(1, A, null, 12)], H, A, 0, 1)).toBeUndefined();              // no half filed
    expect(halfTimeFromGoalEvents([g(1, A, 1, 71)], H, A, 0, 1)).toBeUndefined();                 // "first half" at 71'
    expect(halfTimeFromGoalEvents([g(1, A, 2, 30)], H, A, 0, 1)).toBeUndefined();                 // "second half" at 30'
    expect(halfTimeFromGoalEvents([g(1, A, 2, 60, 1), g(2, A, 1, 20, 2)], H, A, 0, 2)).toBeUndefined(); // second before first
    expect(halfTimeFromGoalEvents([g(1, A, 1, NaN)], H, A, 0, 1)).toBeUndefined();                // no minute
  });
});
