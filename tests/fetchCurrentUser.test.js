import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const api = await import('../services/api.ts');

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
const KEY = 'betsim_token';
const TOKEN_KEYS = () => [...store.keys()].filter((k) => k === KEY);

describe('fetchCurrentUser - only a rejected token logs the person out', () => {
  beforeEach(() => { store.clear(); vi.useFakeTimers(); });

  const signIn = () => { store.set(KEY, 'abc'); store.set('cachedUser', JSON.stringify({ id: 'u1', name: 'Test' })); };

  it('keeps the token and the cached user when the server is busy (500 on every try)', async () => {
    signIn();
    globalThis.fetch = vi.fn(async () => reply(500, { error: 'Authentication check failed' }));
    const p = api.fetchCurrentUser();
    await vi.runAllTimersAsync();
    const user = await p;
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(user).toEqual({ id: 'u1', name: 'Test' });
    expect(TOKEN_KEYS().length).toBe(1);
  });

  it('recovers when the second try works', async () => {
    signIn();
    let n = 0;
    globalThis.fetch = vi.fn(async () => (++n === 1 ? reply(429, { error: 'Shumë përpjekje' }) : reply(200, { user: { id: 'u1', name: 'Fresh' } })));
    const p = api.fetchCurrentUser();
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ id: 'u1', name: 'Fresh' });
  });

  it('logs out on 401 (expired / invalid token)', async () => {
    signIn();
    globalThis.fetch = vi.fn(async () => reply(401, { error: 'Invalid or expired token' }));
    const user = await api.fetchCurrentUser();
    expect(user).toBeNull();
    expect(TOKEN_KEYS().length).toBe(0);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('logs out on 403 (disabled account)', async () => {
    signIn();
    globalThis.fetch = vi.fn(async () => reply(403, { error: 'Account is disabled' }));
    expect(await api.fetchCurrentUser()).toBeNull();
    expect(TOKEN_KEYS().length).toBe(0);
  });
});
