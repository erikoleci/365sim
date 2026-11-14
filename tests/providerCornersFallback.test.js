import { describe, it, expect } from 'vitest';
import { readLiveCorners } from '../server/matchSettlement.js';
import { setProviderCorners, __resetProviderCornersForTests } from '../server/providerCounters.js';

const client = (row) => ({ query: async () => ({ rows: row ? [row] : [] }) });

describe('readLiveCorners: provider list as the fallback counter', () => {
  it('uses a fresh database counter first', async () => {
    __resetProviderCornersForTests(); setProviderCorners('m', 9, 9, 1000);
    expect(await readLiveCorners(client({ corners_home: 2, corners_away: 1, updated_at: 990 }), 'm', 1000)).toEqual({ home: 2, away: 1, fresh: true });
  });
  it('falls back to the provider list when the database has nothing or a stale counter', async () => {
    __resetProviderCornersForTests(); setProviderCorners('m', 4, 2, 100000);
    expect(await readLiveCorners(client(null), 'm', 100500)).toEqual({ home: 4, away: 2, fresh: true });
    expect(await readLiveCorners(client({ corners_home: 1, corners_away: 1, updated_at: 1 }), 'm', 100500)).toEqual({ home: 4, away: 2, fresh: true });
  });
  it('is not fresh when both sources are old', async () => {
    __resetProviderCornersForTests(); setProviderCorners('m', 4, 2, 1000);
    const r = await readLiveCorners(client({ corners_home: 1, corners_away: 1, updated_at: 1 }), 'm', 200000);
    expect(r.fresh).toBe(false);
    expect(await readLiveCorners(client(null), 'zzz', 200000)).toBe(null);
  });
});
