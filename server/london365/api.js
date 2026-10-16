// HTTP access to the provider API (retrying) and the list of sports to import.
import { SPORTS_RAW, SITE_ORIGIN, API_BASE } from './config.js';

export let resolvedSports = null;
export async function resolveSports() {
  if (resolvedSports) return resolvedSports;
  if (SPORTS_RAW !== 'all') {
    resolvedSports = SPORTS_RAW.split(',').map(Number).filter(Boolean);
    return resolvedSports;
  }
  try {
    const sports = await api('/ajax/sports');
    const ids = Array.isArray(sports) ? sports.map((s) => Number(s.id)).filter(Boolean) : [];
    resolvedSports = ids.length ? ids : [1];
  } catch (err) {
    console.error('[london365] sports discovery failed, falling back to Soccer:', err.message);
    resolvedSports = [1];
  }
  return resolvedSports;
}
export const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Origin: SITE_ORIGIN,
  Referer: SITE_ORIGIN + '/',
  'Content-Type': 'application/json',
  Accept: 'application/json',
};
// HTTP with gentle retry; the API intermittently answers "Something went wrong".
export const API_TIMEOUT_MS = Math.max(1, Number(process.env.LONDON365_API_TIMEOUT_MS || 12000));
export async function api(pathname, opts) {
  opts = opts || {};
  const retries = opts.retries || 3;
  let lastErr = null;
  for (let attempt = 1; attempt !== retries + 1; attempt++) {
    try {
      // Without a timeout a stalled connection never settles. One such request
      // used to hang a whole live cycle (and, with the overlap guard below, every
      // later cycle too): all matches froze at 0-0 with an estimated clock.
      const resp = await fetch(API_BASE + pathname, {
        method: opts.method || 'GET',
        headers: HEADERS,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      const text = await resp.text();
      if (resp.ok === false) throw new Error('HTTP ' + resp.status);
      if (text.trim().toLowerCase().indexOf('something went wrong') === 0) throw new Error('API transient error');
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
      if (attempt !== retries) await new Promise(function (r) { setTimeout(r, 500 * attempt); });
    }
  }
  throw new Error('london365 api ' + pathname + ' failed: ' + (lastErr ? lastErr.message : 'unknown'));
}
