import { describe, it, expect, vi } from 'vitest';
vi.mock('../server/db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../server/london365/api.js', () => ({ resolveSports: vi.fn(async () => [1]), api: vi.fn(async () => []) }));
const { reopenMatch } = await import('../server/matchReopen.js');

const row = (o) => ({ id: 'l365-1', home_team: 'Besiktas', away_team: 'Beer Sheva', status: 'FINISHED', result_home: null, result_away: null, start_time: new Date().toISOString(), ...o });
const LIVE = async () => new Set(['1']);
const mk = (match, { updated = true } = {}) => ({ query: vi.fn(async (sql) => {
  if (sql.startsWith('SELECT id, home_team')) return { rows: match ? [match] : [] };
  if (sql.startsWith('UPDATE matches_cache')) return { rows: updated ? [{ id: 'l365-1' }] : [] };
  return { rows: [{ pending: 4, decided: 1 }] };
}) });

describe('reopenMatch', () => {
  it('reopens a FINISHED match that has no final result, and leaves tickets alone', async () => {
    const db = mk(row());
    const r = await reopenMatch('l365-1', { db, liveIds: LIVE });
    expect(r).toMatchObject({ ok: true, pendingLegs: 4, decidedLegs: 1 });
    const updates = db.query.mock.calls.filter((c) => /UPDATE/.test(c[0]));
    expect(updates).toHaveLength(1);
    expect(updates[0][0]).toMatch(/matches_cache/); expect(updates[0][0]).not.toMatch(/bet_selections|bets /);
    expect(updates[0][0]).toMatch(/result_home IS NULL AND result_away IS NULL/);
  });
  it('refuses a match with a final result (its tickets were decided on it)', async () => {
    const db = mk(row({ result_home: 1, result_away: 0 }));
    expect(await reopenMatch('l365-1', { db, liveIds: LIVE })).toMatchObject({ ok: false, code: 'HAS_RESULT' });
    expect(db.query.mock.calls.some((c) => /UPDATE/.test(c[0]))).toBe(false);
  });
  it('refuses a match that is not closed, or does not exist', async () => {
    expect(await reopenMatch('l365-1', { db: mk(row({ status: 'LIVE' })), liveIds: LIVE })).toMatchObject({ ok: false, code: 'NOT_CLOSED' });
    expect(await reopenMatch('l365-9', { db: mk(null), liveIds: LIVE })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
  it('reports a change made in between instead of claiming success', async () => {
    expect(await reopenMatch('l365-1', { db: mk(row(), { updated: false }), liveIds: LIVE })).toMatchObject({ ok: false, code: 'CHANGED' });
  });
  it('warns when the match started more than 3 hours ago', async () => {
    const r = await reopenMatch('l365-1', { db: mk(row({ start_time: new Date(Date.now() - 4 * 3600000).toISOString() })), liveIds: LIVE });
    expect(r.note).toMatch(/3 orësh/);
  });
  it('says the match is over when the provider does not list it live, and changes nothing', async () => {
    const db = mk(row());
    expect(await reopenMatch('l365-1', { db, liveIds: async () => new Set(['2']) })).toMatchObject({ ok: false, code: 'NOT_LIVE_AT_PROVIDER' });
    expect(db.query.mock.calls.some((c) => /UPDATE/.test(c[0]))).toBe(false);
  });
  it('does not reopen blindly when the provider cannot be asked', async () => {
    const db = mk(row());
    expect(await reopenMatch('l365-1', { db, liveIds: async () => null })).toMatchObject({ ok: false, code: 'PROVIDER_UNREACHABLE' });
    expect(db.query.mock.calls.some((c) => /UPDATE/.test(c[0]))).toBe(false);
  });
});
