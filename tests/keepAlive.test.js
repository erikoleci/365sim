import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startKeepAliveSelfPing, __resetKeepAliveForTests } from '../server/keepAlive.js';

const ORIGINAL_ENV = process.env.RENDER_EXTERNAL_URL;

beforeEach(() => {
  __resetKeepAliveForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  __resetKeepAliveForTests();
  vi.useRealTimers();
  if (ORIGINAL_ENV === undefined) delete process.env.RENDER_EXTERNAL_URL;
  else process.env.RENDER_EXTERNAL_URL = ORIGINAL_ENV;
});

describe('startKeepAliveSelfPing', () => {
  it('does nothing when RENDER_EXTERNAL_URL is not set (local/dev/tests)', () => {
    delete process.env.RENDER_EXTERNAL_URL;
    const fetchImpl = vi.fn();
    const timer = startKeepAliveSelfPing(1000, fetchImpl);
    expect(timer).toBeNull();
    vi.advanceTimersByTime(10000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('pings the PUBLIC url (not localhost) on an interval when RENDER_EXTERNAL_URL is set', async () => {
    process.env.RENDER_EXTERNAL_URL = 'https://three65sim-8lvy.onrender.com';
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    startKeepAliveSelfPing(1000, fetchImpl);

    expect(fetchImpl).not.toHaveBeenCalled(); // not immediately — only on the interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledWith('https://three65sim-8lvy.onrender.com/api/health');

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('strips a trailing slash from RENDER_EXTERNAL_URL before building the health-check url', async () => {
    process.env.RENDER_EXTERNAL_URL = 'https://three65sim-8lvy.onrender.com/';
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    startKeepAliveSelfPing(1000, fetchImpl);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledWith('https://three65sim-8lvy.onrender.com/api/health');
  });

  it('does not start a second timer if called again while one is already running', () => {
    process.env.RENDER_EXTERNAL_URL = 'https://three65sim-8lvy.onrender.com';
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const first = startKeepAliveSelfPing(1000, fetchImpl);
    const second = startKeepAliveSelfPing(1000, fetchImpl);
    expect(second).toBe(first);
  });

  it('swallows a failed ping (network error) without throwing, so a bad tick never crashes the process', async () => {
    process.env.RENDER_EXTERNAL_URL = 'https://three65sim-8lvy.onrender.com';
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    startKeepAliveSelfPing(1000, fetchImpl);
    await vi.advanceTimersByTimeAsync(1000); // must not throw/reject
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('logs a warning but does not throw when the health check itself returns non-OK', async () => {
    process.env.RENDER_EXTERNAL_URL = 'https://three65sim-8lvy.onrender.com';
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startKeepAliveSelfPing(1000, fetchImpl);
    await vi.advanceTimersByTimeAsync(1000);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('503'));
    warnSpy.mockRestore();
  });
});
