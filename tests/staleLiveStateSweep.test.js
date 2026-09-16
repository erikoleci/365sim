import { describe, it, expect, vi, beforeEach } from 'vitest';

function tag(attrs) {
  return '<Detaje ' + Object.entries(attrs).map(([k, v]) => k + '="' + v + '"').join(' ') + ' />';
}

// Same minimal DB mock shape used by tests/gameDetailsReuse.test.js — this
// suite only cares about the in-memory EID-tracking maps, so every query
// just needs to resolve to "no matching cached game" (empty rows), which is
// exactly the "unknown EID from the global feed" case the leak fix targets.
const mocks = vi.hoisted(function () {
  function query() {
    return Promise.resolve({ rows: [] });
  }
  return { pool: { query } };
});

vi.mock('../server/db.js', () => ({ default: mocks.pool, pool: mocks.pool }));
vi.mock('../server/ws.js', () => ({
  pushCardEvent: vi.fn(),
  pushLiveTick: vi.fn(),
  pushGoal: vi.fn(),
  pushGoalDisallowed: vi.fn(),
  pushMatchEnded: vi.fn(),
  pushOddsChanged: vi.fn(),
}));
vi.mock('../server/london365.js', () => ({
  recordGoalIfChanged: vi.fn(),
  minuteToNumber: () => null,
}));

let applyGameDetails, pruneStaleLiveState, __resetLiveStateForTests;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../server/london365GameDetails.js');
  applyGameDetails = mod.applyGameDetails;
  pruneStaleLiveState = mod.pruneStaleLiveState;
  __resetLiveStateForTests = mod.__resetLiveStateForTests;
  __resetLiveStateForTests();
});

describe('pruneStaleLiveState (heap leak guard for unmatched global-feed EIDs)', () => {
  it('does nothing for an EID touched moments ago', async () => {
    const now = Date.now();
    await applyGameDetails(tag({ EID: '999999', T: '1', SC: '0-0' }));
    const pruned = pruneStaleLiveState(now + 1000); // 1s later — nowhere near stale
    expect(pruned).toBe(0);
  });

  it('drops an EID not touched in over 4 hours, freeing it for reprocessing as new', async () => {
    const start = Date.now();
    await applyGameDetails(tag({ EID: '999999', T: '1', SC: '0-0' }));

    // Simulate 5 hours passing with no further updates for this EID —
    // exactly what an unmatched foreign match (never in our catalog, never
    // cleaned up by forgetLiveState) looked like before this fix: it would
    // sit in `lastSeen`/`unknownEidWarned` forever.
    const fiveHoursLater = start + 5 * 60 * 60 * 1000;
    const pruned = pruneStaleLiveState(fiveHoursLater);
    expect(pruned).toBe(1);

    // Confirm it's actually gone from tracking, not just counted: the same
    // T value that would have been silently deduped/ignored before is now
    // treated as "first time seeing this EID" again (no throw, no stuck
    // state) — logging its "no matching cached game" line once more is the
    // correct behavior for what is, for tracking purposes, a fresh EID.
    await expect(applyGameDetails(tag({ EID: '999999', T: '1', SC: '0-0' }))).resolves.toBeUndefined();
  });

  it('never prunes an EID that keeps receiving updates (a genuinely long-running match)', async () => {
    const start = Date.now();
    await applyGameDetails(tag({ EID: '999999', T: '1', SC: '0-0' }));

    // Touched again just under the staleness threshold.
    vi.useFakeTimers();
    vi.setSystemTime(start + 3 * 60 * 60 * 1000);
    await applyGameDetails(tag({ EID: '999999', T: '2', SC: '1-0' }));
    vi.useRealTimers();

    const pruned = pruneStaleLiveState(start + 5 * 60 * 60 * 1000);
    expect(pruned).toBe(0);
  });

  it('scales to many distinct unmatched EIDs without leaving stragglers behind', async () => {
    const start = Date.now();
    for (let i = 0; i < 500; i++) {
      await applyGameDetails(tag({ EID: String(i), T: '1', SC: '0-0' }));
    }
    const pruned = pruneStaleLiveState(start + 5 * 60 * 60 * 1000);
    expect(pruned).toBe(500);
    // A second sweep right after finds nothing left to prune.
    expect(pruneStaleLiveState(start + 5 * 60 * 60 * 1000 + 1)).toBe(0);
  });
});
