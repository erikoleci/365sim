import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks pool.query so the test doesn't need a real DB.
const queryMock = vi.fn();
vi.mock('../server/db.js', () => ({
  default: { query: (...args) => queryMock(...args) },
  getKV: vi.fn(),
  setKV: vi.fn(),
}));

const unsubscribeGameDetails = vi.fn();
const getSubscribedGameDetailsIds = vi.fn();
vi.mock('../server/london365Socket.js', () => ({
  unsubscribeGameDetails,
  getSubscribedGameDetailsIds,
}));

const forgetLiveState = vi.fn();
vi.mock('../server/london365GameDetails.js', () => ({
  forgetLiveState,
  applyGameDetails: vi.fn(),
  startStaleLiveStateSweep: vi.fn(),
}));

describe('reconcileGameDetailsSubscriptions', () => {
  beforeEach(() => {
    queryMock.mockReset();
    unsubscribeGameDetails.mockReset();
    getSubscribedGameDetailsIds.mockReset();
    forgetLiveState.mockReset();
  });

  it('drops subscriptions for ids no longer LIVE in matches_cache (the purge-orphan bug)', async () => {
    const { reconcileGameDetailsSubscriptions } = await import('../server/london365.js');

    // Subscribed to 3 games, but a purge*() deleted one of them
    // (58729560) from matches_cache without cleaning up its subscription
    // — this is exactly the scenario from the production OOM crash.
    getSubscribedGameDetailsIds.mockReturnValue(new Set(['52628036', '58729560', '11111111']));
    queryMock.mockResolvedValue({
      rows: [{ id: 'l365-52628036' }, { id: 'l365-11111111' }],
    });

    const dropped = await reconcileGameDetailsSubscriptions();

    expect(dropped).toBe(1);
    expect(unsubscribeGameDetails).toHaveBeenCalledWith('58729560');
    expect(forgetLiveState).toHaveBeenCalledWith('58729560');
    expect(unsubscribeGameDetails).not.toHaveBeenCalledWith('52628036');
    expect(unsubscribeGameDetails).not.toHaveBeenCalledWith('11111111');
  });

  it('is a no-op when there are no subscriptions', async () => {
    const { reconcileGameDetailsSubscriptions } = await import('../server/london365.js');
    getSubscribedGameDetailsIds.mockReturnValue(new Set());

    const dropped = await reconcileGameDetailsSubscriptions();

    expect(dropped).toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('keeps every subscription when all are still LIVE', async () => {
    const { reconcileGameDetailsSubscriptions } = await import('../server/london365.js');
    getSubscribedGameDetailsIds.mockReturnValue(new Set(['1', '2']));
    queryMock.mockResolvedValue({ rows: [{ id: 'l365-1' }, { id: 'l365-2' }] });

    const dropped = await reconcileGameDetailsSubscriptions();

    expect(dropped).toBe(0);
    expect(unsubscribeGameDetails).not.toHaveBeenCalled();
  });
});
