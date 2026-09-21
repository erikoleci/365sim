// In-memory knowledge of WHICH matches we hold, so the live feed can be
// filtered before it ever touches the database.
//
// Why this exists: the odds socket (new-coefs / delete-live-coef /
// delete-live-game) and the gamedetails socket are GLOBAL provider feeds.
// Before this module every message for a game we never imported still cost a
// Postgres round trip (a SELECT of the full raw_json blob, in the coefs case)
// just to learn "no such row". A Set lookup gives the same answer for free.
//
// Three small, dependency-free pieces (no imports on purpose, so it can be
// used from london365.js, london365GameDetails.js and london365Socket.js
// without creating cycles or being affected by test mocks of those modules):
//
//  1. tracked ids   - every l365 match id that exists in matches_cache.
//  2. live-known    - ids whose DB status is (or may be) LIVE. Lets the
//                     periodic end-detection / subscription sweeps skip the
//                     database entirely while nothing is live, which is what
//                     allows Neon to auto-suspend compute during quiet hours.
//  3. live row cache- short-lived copy of the few columns applyGameDetails
//                     needs per tick (teams, score, minute), kept in step with
//                     every writer of those columns, so a ~1/sec tick feed
//                     does not become ~1 SELECT/sec per live match.
//
// FAIL-OPEN: until the tracker has been loaded from the DB once (boot, or DB
// unreachable), every check answers "yes, treat as tracked / possibly live"
// so behaviour is identical to the pre-tracker code. It can only ever skip
// work once it positively knows the answer.

const bare = (id) => String(id == null ? '' : id).replace(/^l365-/, '');

const tracked = new Map();   // bare id -> addedAt (ms)
const liveKnown = new Map(); // bare id -> lastNotedAt (ms)
let loaded = false;

export function isTrackerLoaded() { return loaded; }

export function trackGame(id) {
  const k = bare(id);
  if (k) tracked.set(k, Date.now());
}

export function isTrackedGame(id) {
  if (!loaded) return true; // fail-open
  return tracked.has(bare(id));
}

export function noteMatchStatus(id, status) {
  const k = bare(id);
  if (!k) return;
  if (status === 'LIVE') liveKnown.set(k, Date.now());
  else liveKnown.delete(k);
}

export function hasKnownLiveMatches() {
  if (!loaded) return true; // fail-open
  return liveKnown.size > 0;
}

// rows: [{ id, status }] as read from matches_cache (l365 rows only).
// startedAt: when that SELECT began - anything trackGame()'d/noted after it
// is newer than the snapshot and must survive the replacement.
export function applyTrackerSnapshot(rows, startedAt) {
  const fresh = new Set();
  const live = new Set();
  for (const r of rows || []) {
    const k = bare(r.id);
    if (!k) continue;
    fresh.add(k);
    if (r.status === 'LIVE') live.add(k);
  }
  for (const [k, at] of tracked) {
    if (!fresh.has(k) && at < startedAt) { tracked.delete(k); liveRows.delete(k); }
  }
  for (const k of fresh) if (!tracked.has(k)) tracked.set(k, 0);
  for (const [k, at] of liveKnown) {
    if (!live.has(k) && at < startedAt) liveKnown.delete(k);
  }
  for (const k of live) if (!liveKnown.has(k)) liveKnown.set(k, 0);
  loaded = true;
}

// Used by end-detection: after it has looked at every DB row still marked
// LIVE, drop any live-known id the DB no longer lists as LIVE.
export function retainLiveKnown(liveIdsFromDb, startedAt) {
  const keep = new Set([...liveIdsFromDb].map(bare));
  for (const [k, at] of liveKnown) {
    if (!keep.has(k) && at < startedAt) liveKnown.delete(k);
  }
}

// ---- live row cache ------------------------------------------------------
const LIVE_ROW_TTL_MS = Math.max(1000, Number(process.env.LONDON365_LIVE_ROW_TTL_MS || 20000));
const LIVE_ROW_MAX = 3000;
const liveRows = new Map(); // bare id -> { row, at }

export function getLiveRow(id) {
  const k = bare(id);
  const e = liveRows.get(k);
  if (!e) return null;
  if (Date.now() - e.at >= LIVE_ROW_TTL_MS) { liveRows.delete(k); return null; }
  return { ...e.row };
}

export function setLiveRow(id, row) {
  const k = bare(id);
  if (!k || !row) return;
  if (liveRows.size >= LIVE_ROW_MAX) liveRows.clear(); // hard bound, cheap to refill
  liveRows.set(k, {
    at: Date.now(),
    row: {
      home_team: row.home_team,
      away_team: row.away_team,
      live_home_score: row.live_home_score ?? null,
      live_away_score: row.live_away_score ?? null,
      live_minute: row.live_minute ?? null,
    },
  });
}

export function forgetLiveRow(id) { liveRows.delete(bare(id)); }

export function resetLiveTracker() {
  tracked.clear();
  liveKnown.clear();
  liveRows.clear();
  loaded = false;
}

export function getLiveTrackerDiagnostics() {
  return { loaded, tracked: tracked.size, liveKnown: liveKnown.size, liveRows: liveRows.size };
}

export const __resetLiveTrackerForTests = resetLiveTracker;
