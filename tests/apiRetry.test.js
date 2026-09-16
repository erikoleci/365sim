import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', {
    store: {},
    getItem(k) { return this.store[k] ?? null; },
    setItem(k, v) { this.store[k] = v; },
    removeItem(k) { delete this.store[k]; },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok, status,
    headers: { get: () => 'application/json' },
    json: async () => body,
  };
}

describe('api request() - rides out a Render free-tier cold start instead of failing immediately', () => {
  it('GET retries automatically on a network-level failure and succeeds once the server wakes up', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ matches: [], leagueNames: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const api = await import('../services/api.ts');
    const promise = api.fetchMatches();

    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;
    expect(result).toEqual({ matches: [], leagueNames: {} });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after 9 attempts and throws a friendly connection error (not a raw network exception)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const api = await import('../services/api.ts');
    const promise = api.fetchMatches().catch((e) => e);

    for (let i = 0; i < 9; i++) await vi.advanceTimersByTimeAsync(5000);

    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/lidhemi me serverin/);
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it('does NOT retry a real HTTP error response (e.g. wrong password) - fails immediately', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'Invalid username or password' }, false, 401));
    vi.stubGlobal('fetch', fetchMock);

    const api = await import('../services/api.ts');
    await expect(api.login('bob', 'wrongpass')).rejects.toThrow('Invalid username or password');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('login retries through a cold start (POST, but explicitly opted into retry)', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ token: 't', user: { id: 'u1', username: 'bob' } }));
    vi.stubGlobal('fetch', fetchMock);

    const api = await import('../services/api.ts');
    const promise = api.login('bob', 'pw');
    await vi.advanceTimersByTimeAsync(5000);
    const user = await promise;
    expect(user).toEqual({ id: 'u1', username: 'bob' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a mutating call (not opted into retry) does NOT auto-retry on network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const api = await import('../services/api.ts');
    await expect(api.agentCreditUser('user-1', 10)).rejects.toThrow(/lidhemi me serverin/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
