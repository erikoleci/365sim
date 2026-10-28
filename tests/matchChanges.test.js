import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const broadcast = vi.hoisted(() => vi.fn());
vi.mock('../server/ws.js', () => ({ broadcast }));

const mc = await import('../server/matchChanges.js');

beforeEach(() => { vi.useFakeTimers(); broadcast.mockClear(); mc.__resetForTests(); });
afterEach(() => { vi.useRealTimers(); });

describe('getChangesSince', () => {
  it('a negative position only reports where the server is (no matches, no reload)', () => {
    mc.noteMatchChanged('a');
    const r = mc.getChangesSince(-1, '');
    expect(r).toMatchObject({ full: false, ids: [], seq: 1, boot: mc.BOOT_ID });
  });

  it('returns only the matches that changed after the given position', () => {
    mc.noteMatchChanged('a'); mc.noteMatchChanged('b'); mc.noteMatchChanged('a'); mc.noteMatchChanged('c');
    const r = mc.getChangesSince(1, mc.BOOT_ID);
    expect(r.full).toBe(false);
    expect(r.ids.sort()).toEqual(['a', 'b', 'c']);
    expect(mc.getChangesSince(4, mc.BOOT_ID).ids).toEqual([]);
  });

  it('asks for a full reload when the client belongs to another server run', () => {
    mc.noteMatchChanged('a');
    expect(mc.getChangesSince(0, 'old-boot').full).toBe(true);
  });

  it('asks for a full reload when the gap is older than the log or too large', () => {
    for (let i = 0; i < mc.MAX_LOG + 10; i++) mc.noteMatchChanged('m' + i);
    expect(mc.getChangesSince(0, mc.BOOT_ID).full).toBe(true);
    mc.__resetForTests();
    for (let i = 0; i < mc.MAX_IDS_PER_REPLY + 5; i++) mc.noteMatchChanged('n' + i);
    expect(mc.getChangesSince(0, mc.BOOT_ID).full).toBe(true);
  });
});

describe('noteMatchChanged push', () => {
  it('many changes inside the delay send ONE MATCHES_CHANGED with the newest position', () => {
    for (let i = 0; i < 50; i++) mc.noteMatchChanged('m' + i);
    expect(broadcast).not.toHaveBeenCalled();
    vi.advanceTimersByTime(mc.PUSH_DELAY_MS + 1);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith('live', { type: 'MATCHES_CHANGED', seq: 50 });
  });
});
