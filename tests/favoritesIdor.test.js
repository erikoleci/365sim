import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';

// Regression test: favorites must always be scoped to the AUTHENTICATED
// user (from the JWT), never a client-supplied user id -- there is no such
// param on these routes today, and this test locks that in so it can't be
// added back accidentally (e.g. a future "toggle for user X" admin helper
// that forgets to check role).

const mocks = vi.hoisted(function () {
  const users = new Map();
  const favorites = []; // { id, user_id, type, value, created_at }
  let nextId = 1;

  function reset() {
    users.clear();
    favorites.length = 0;
    nextId = 1;
    users.set('user-a', { id: 'user-a', role: 'USER', is_active: true });
    users.set('user-b', { id: 'user-b', role: 'USER', is_active: true });
    favorites.push({ id: nextId++, user_id: 'user-b', type: 'TEAM', value: 'Real Madrid', created_at: Date.now() });
  }
  reset();

  function query(sql, params = []) {
    const s = String(sql);
    if (s.startsWith('SELECT id, role, is_active FROM users WHERE id = $1')) {
      const row = users.get(params[0]);
      return Promise.resolve({ rows: row ? [row] : [] });
    }
    if (s.startsWith('SELECT type, value FROM favorites WHERE user_id = $1')) {
      const rows = favorites.filter((f) => f.user_id === params[0]).map((f) => ({ type: f.type, value: f.value }));
      return Promise.resolve({ rows });
    }
    if (s.startsWith('SELECT id FROM favorites WHERE user_id = $1 AND type = $2 AND value = $3')) {
      const row = favorites.find((f) => f.user_id === params[0] && f.type === params[1] && f.value === params[2]);
      return Promise.resolve({ rows: row ? [{ id: row.id }] : [] });
    }
    if (s.startsWith('DELETE FROM favorites WHERE id = $1')) {
      const idx = favorites.findIndex((f) => f.id === params[0]);
      if (idx >= 0) favorites.splice(idx, 1);
      return Promise.resolve({ rows: [] });
    }
    if (s.startsWith('INSERT INTO favorites')) {
      favorites.push({ id: nextId++, user_id: params[0], type: params[1], value: params[2], created_at: params[3] });
      return Promise.resolve({ rows: [] });
    }
    throw new Error('unmocked query: ' + s);
  }

  const pool = { query };
  return { users, favorites, reset, pool };
});

vi.mock('../server/db.js', () => ({ default: mocks.pool, pool: mocks.pool }));

const { JWT_SECRET } = await import('../server/routes/auth.js');
const favoritesRouter = (await import('../server/routes/favorites.js')).default;

beforeEach(() => { mocks.reset(); });

function sign(id) {
  return jwt.sign({ id, username: id, role: 'USER' }, JWT_SECRET, { expiresIn: '7d' });
}

let server;
let baseUrl;

beforeEach(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/favorites', favoritesRouter);
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('favorites routes - ownership (IDOR) enforcement', () => {
  it('GET only returns the authenticated user\'s own favorites, never another user\'s', async () => {
    const res = await fetch(`${baseUrl}/api/favorites`, {
      headers: { authorization: 'Bearer ' + sign('user-a') },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.favorites).toEqual([]); // user-b's "Real Madrid" must not leak here
  });

  it('toggle writes are always attributed to the authenticated user, ignoring any body-supplied identity', async () => {
    const res = await fetch(`${baseUrl}/api/favorites/toggle`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + sign('user-a'), 'content-type': 'application/json' },
      // Even if a client tried to smuggle a different user id in the body,
      // the route never reads req.body.userId -- only req.user.id.
      body: JSON.stringify({ type: 'TEAM', value: 'Barcelona', userId: 'user-b' }),
    });
    expect(res.status).toBe(200);
    expect(mocks.favorites.find((f) => f.value === 'Barcelona').user_id).toBe('user-a');
  });

  it('rejects requests with no auth token at all', async () => {
    const res = await fetch(`${baseUrl}/api/favorites`);
    expect(res.status).toBe(401);
  });
});
