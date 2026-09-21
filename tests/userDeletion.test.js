import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(function () {
  const state = { counts: { bets: 0, casino_rounds: 0, transactions: 0, sub_users: 0 }, log: [] };
  const client = {
    query: vi.fn(function (sql) { state.log.push(String(sql).trim().split(/\s+/).slice(0, 3).join(' ')); return Promise.resolve({ rows: [], rowCount: 1 }); }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(function () { return Promise.resolve({ rows: [{ ...state.counts }] }); }),
    connect: vi.fn(function () { return Promise.resolve(client); }),
  };
  return { state, client, pool };
});
vi.mock('../server/db.js', () => ({ default: mocks.pool }));

const { deleteUserIfUnused, getUserDeleteBlockers, deleteBlockedMessage } = await import('../server/userDeletion.js');
const { mapDbError } = await import('../server/dbErrors.js');

beforeEach(() => {
  mocks.state.counts = { bets: 0, casino_rounds: 0, transactions: 0, sub_users: 0 };
  mocks.state.log.length = 0;
  vi.clearAllMocks();
});

describe('deleteUserIfUnused', () => {
  it('deletes a user with no history (favorites first, in one transaction)', async () => {
    const r = await deleteUserIfUnused('user-1');
    expect(r).toEqual({ ok: true });
    expect(mocks.state.log).toEqual(['BEGIN', 'DELETE FROM favorites', 'DELETE FROM users', 'COMMIT']);
    expect(mocks.client.release).toHaveBeenCalled();
  });

  it('refuses (no DELETE at all) when the user has bets, ledger rows, casino rounds or sub-users', async () => {
    mocks.state.counts = { bets: 2, casino_rounds: 1, transactions: 3, sub_users: 1 };
    const r = await deleteUserIfUnused('user-1');
    expect(r.ok).toBe(false);
    expect(r.blockers.map((b) => b.key).sort()).toEqual(['bets', 'casino_rounds', 'sub_users', 'transactions']);
    expect(mocks.pool.connect).not.toHaveBeenCalled();
  });

  it('a credited-then-debited user (ledger rows only) is refused with an actionable message', async () => {
    mocks.state.counts = { bets: 0, casino_rounds: 0, transactions: 2, sub_users: 0 };
    const blockers = await getUserDeleteBlockers('user-1');
    expect(deleteBlockedMessage(blockers)).toMatch(/2 transaksione/);
    expect(deleteBlockedMessage(blockers)).toMatch(/Caktivizoje/);
  });

  it('rolls back and releases the client if the delete itself fails', async () => {
    mocks.client.query.mockImplementation((sql) => {
      if (String(sql).startsWith('DELETE FROM users')) return Promise.reject(Object.assign(new Error('boom'), { code: '23503' }));
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    await expect(deleteUserIfUnused('user-1')).rejects.toThrow('boom');
    expect(mocks.client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.client.release).toHaveBeenCalled();
  });
});

describe('mapDbError', () => {
  it('foreign-key violation -> 409 with a real message (not a fake outage)', () => {
    const m = mapDbError({ code: '23503', message: 'violates foreign key' });
    expect(m.status).toBe(409);
    expect(m.body.code).toBe('FOREIGN_KEY_VIOLATION');
  });
  it('unique violation -> 409; anything else -> 503', () => {
    expect(mapDbError({ code: '23505' }).status).toBe(409);
    expect(mapDbError(new Error('connection timeout')).status).toBe(503);
    expect(mapDbError(undefined).status).toBe(503);
  });
});
