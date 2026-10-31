// "What changed" feed for the match list. A match that is NEW, went LIVE or got its first clock reading is
// noted here (persist.js); the server then tells every connected browser with ONE tiny WebSocket message
// (MATCHES_CHANGED) and the browser asks GET /api/matches/changes for just those matches (a few KB) instead of
// downloading the whole list again. Everything is in memory and bounded (MAX_LOG entries, a few bytes each).
import { broadcast } from './ws.js';

export const BOOT_ID = Date.now().toString(36); // changes on every server restart: old positions become invalid
export const MAX_LOG = 2000;
export const MAX_IDS_PER_REPLY = 300; // a bigger gap (a first import) is cheaper as one full reload
export const PUSH_DELAY_MS = 400; // many changes inside this window produce ONE push

let seq = 0;
let log = []; // [{ seq, id }]
let pushTimer = null;

export function noteMatchChanged(id) {
  seq += 1;
  log.push({ seq, id });
  if (log.length > MAX_LOG) log = log.slice(log.length - MAX_LOG);
  if (!pushTimer) {
    pushTimer = setTimeout(() => {
      pushTimer = null;
      // A failing push must never become an uncaught exception inside a timer (it would take the process down).
      try { broadcast('live', { type: 'MATCHES_CHANGED', seq }); } catch (err) { console.warn('[matchChanges] push failed:', err && err.message); }
    }, PUSH_DELAY_MS);
    if (pushTimer.unref) pushTimer.unref();
  }
}

// since < 0 (or not a number): "where are we now?" -- returns the position only, no matches.
// full = true: the client cannot be caught up with a few matches (other server run, gap too old, too many) and
// must reload the whole list once.
export function getChangesSince(since, boot) {
  const base = { boot: BOOT_ID, seq };
  if (!Number.isFinite(since) || since < 0) return { ...base, full: false, ids: [] };
  if (boot !== BOOT_ID) return { ...base, full: true, ids: [] };
  if (since >= seq) return { ...base, full: false, ids: [] };
  const oldest = log.length ? log[0].seq : seq + 1;
  if (since < oldest - 1) return { ...base, full: true, ids: [] };
  const ids = new Set();
  for (const e of log) if (e.seq > since) ids.add(e.id);
  if (ids.size > MAX_IDS_PER_REPLY) return { ...base, full: true, ids: [] };
  return { ...base, full: false, ids: Array.from(ids) };
}

export function __resetForTests() {
  seq = 0;
  log = [];
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
}
