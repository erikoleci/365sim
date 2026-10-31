import { describe, it, expect, beforeEach } from 'vitest';
import { noteOddsRefusal, isAcceptedRetry, forgetOddsRefusal, ACCEPT_WINDOW_MS, __resetOddsAcceptanceForTests } from '../server/oddsAcceptance.js';

const L = (m, k, s) => ({ matchId: m, marketId: k, selectionId: s });
const T0 = 1_800_000_000_000;
beforeEach(() => __resetOddsAcceptanceForTests());

describe('accepting changed prices books at once', () => {
  it('the retry of a ticket refused for moved prices skips the wait', () => {
    noteOddsRefusal('u1', [L('m1', 'h2h', '1'), L('m2', 'ou', 'o')], T0);
    expect(isAcceptedRetry('u1', [L('m2', 'ou', 'o'), L('m1', 'h2h', '1')], T0 + 3000)).toBe(true);
  });
  it('not for another ticket, another user, a changed ticket, or after the window', () => {
    noteOddsRefusal('u1', [L('m1', 'h2h', '1')], T0);
    expect(isAcceptedRetry('u2', [L('m1', 'h2h', '1')], T0 + 1000)).toBe(false);
    expect(isAcceptedRetry('u1', [L('m9', 'h2h', '1')], T0 + 1000)).toBe(false);
    expect(isAcceptedRetry('u1', [L('m1', 'h2h', '1'), L('m2', 'h2h', '1')], T0 + 1000)).toBe(false); // an added leg is a new ticket
    expect(isAcceptedRetry('u1', [L('m1', 'h2h', '1')], T0 + ACCEPT_WINDOW_MS + 1)).toBe(false);
    expect(isAcceptedRetry('u1', [], T0)).toBe(false);
  });
  it('is used once', () => {
    noteOddsRefusal('u1', [L('m1', 'h2h', '1')], T0);
    forgetOddsRefusal('u1');
    expect(isAcceptedRetry('u1', [L('m1', 'h2h', '1')], T0 + 1000)).toBe(false);
  });
});
