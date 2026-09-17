// Render's free tier spins the whole web service down after roughly 15
// minutes with no INBOUND request, and the next request after that has to
// wait 50+ seconds while it wakes back up (Render's own dashboard says so
// explicitly). services/api.ts's request() retry (see apiRetry.test.js)
// papers over this from the frontend so it no longer looks like a hard
// crash requiring a manual "provoje përsëri" click -- but the person who
// happens to be that first visitor after idle time still sits through the
// full 50s wait every time, since nothing was actually keeping the service
// warm.
//
// A ping has to arrive from OUTSIDE the box to count: an interval that
// calls its own /api/health over localhost/127.0.0.1 never leaves the
// process, so Render's edge/load-balancer never sees it as traffic and
// still spins the service down right on schedule. Pinging the service's
// own PUBLIC url instead makes a genuine round trip out through Render's
// load balancer and back in, which does count as activity.
//
// Only runs when RENDER_EXTERNAL_URL is set -- Render provides this
// automatically on every service, so this is a silent no-op when running
// locally or in tests, and it will never fire against some unrelated host
// if this code is ever deployed somewhere else without that var set.
let keepAliveTimer = null;

export function startKeepAliveSelfPing(intervalMs = 10 * 60 * 1000, fetchImpl = globalThis.fetch) {
  const base = process.env.RENDER_EXTERNAL_URL;
  if (!base || keepAliveTimer) return keepAliveTimer;
  if (typeof fetchImpl !== 'function') {
    console.warn('[keep-alive] no fetch implementation available — self-ping disabled');
    return null;
  }
  const url = base.replace(/\/+$/, '') + '/api/health';
  const ping = async () => {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) console.warn(`[keep-alive] self-ping to ${url} returned ${res.status}`);
    } catch (err) {
      console.warn(`[keep-alive] self-ping to ${url} failed:`, err.message);
    }
  };
  keepAliveTimer = setInterval(ping, intervalMs);
  // Don't hold the process open just for this — a graceful shutdown (or a
  // test's module teardown) should never have to wait on it.
  if (keepAliveTimer.unref) keepAliveTimer.unref();
  console.log(`[keep-alive] self-ping started for ${url} every ${Math.round(intervalMs / 60000)} min`);
  return keepAliveTimer;
}

// Test-only: lets each test start from a clean slate instead of the module
// remembering a timer (and therefore refusing to start a second one) across
// test cases.
export function __resetKeepAliveForTests() {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}
