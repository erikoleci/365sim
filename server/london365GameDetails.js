// Consumer for the LondonPro365 "gamedetails" live-match-detail feed
// (separate socket from the odds/coefs one in london365Socket.js — see
// startLondon365GameDetailsSocket there).
//
// FIELDS VERIFIED AGAINST REAL PROVIDER OUTPUT (per the site owner's own
// captured update sequences — not guessed):
//   EID        -> the game id (matches matches_cache.id = 'l365-' + EID)
//   SC         -> "home-away" score, e.g. "1-2"
//   H / A      -> home / away team name
//   YC1 / YC2  -> yellow card count, home / away
//   RC1 / RC2  -> red card count, home / away
//   T          -> a per-EID counter that increases with most updates
//                 (2921 -> 2922 -> 2924 -> ...) within a single match's
//                 lifetime. IMPORTANT: production data has also shown T
//                 (and the score!) going BACKWARDS for the same EID over
//                 time -- the most plausible explanation is the provider
//                 reusing an EID for a later, unrelated match/session once
//                 the earlier one is done with it. So T is used only as a
//                 same-session de-dup/ordering key, and a DECREASE is
//                 treated as "this EID has moved on to a new session" (see
//                 applyGameDetails below) rather than assumed to always
//                 mean a stale duplicate. Its exact underlying meaning
//                 (tick? server timestamp?) is still NOT confirmed, so it
//                 is never displayed or treated as a minute.
//
// FIELDS DELIBERATELY NOT MAPPED (no confirmed meaning — see instructions):
//   H1-H8, A1-A8, XY, PG, AM, TA, TT, Pj, S, KC1, KC2, TC1, TC2, VC
//   These are kept verbatim on the in-memory state under `raw` for future
//   analysis, but never surfaced as "minute", "possession", "position",
//   etc. Inventing a mapping for these would violate the one hard
//   requirement of this feature (no fabricated live data).
//
// LIVE MINUTE: the site already has a verified minute source — the
// existing REST/odds-socket pipeline writes matches_cache.live_minute
// (see london365.js). That column is used as-is here as the source of
// truth for logging; this module never derives a minute from the
// unverified fields above.

import pool from './db.js';
import { pushCardEvent, pushLiveTick } from './ws.js';
import { recordGoalIfChanged, eventMinuteFromClock } from './london365.js';
import { parseGameDetails } from './gameDetailsParser.js';
// Bare integer > 130 is a clock in SECONDS ("1776" = 29:36), not a minute.
function normalizeLiveMinute(minute) {
  const str = minute == null ? '' : String(minute).trim();
  if (/^\d+$/.test(str) && Number(str) > 130) {
    const t = Number(str);
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }
  return minute ?? null;
}
import { decodeLiveAction, makeAction } from './liveAction.js';
import { isTrackedGame, getLiveRow, setLiveRow, forgetLiveRow, __resetLiveTrackerForTests } from './liveTracker.js';
import { bump } from './feedStats.js';
import { announceGoalIfChanged, clearGoalAnnounced } from './goalAnnouncer.js';
export { parseGameDetails };

function parseScore(sc) {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(String(sc || '').trim());
  if (!m) return null;
  return { home: Number(m[1]), away: Number(m[2]) };
}

// EID -> { t, yc1, yc2, rc1, rc2 } last-seen verified values, purely
// in-memory (per instructions: live state belongs in memory, not a DB
// round-trip per tick). Resets on restart, which just means the very next
// real change after a restart is treated as "first seen" instead of a
// diff — never produces a false card duplicate.
const lastSeen = new Map();
// EID -> last-touched timestamp, for ALL eids (matched or not) — used only
// by pruneStaleLiveState below to bound the maps' growth over time.
const lastTouched = new Map();
const unknownEidWarned = new Set();
// EID -> last {minute, homeScore, awayScore, ts} actually sent over the
// 'live' WS broadcast. applyGameDetails runs ~1/sec per live match from
// the provider feed, but minute/score rarely change that often (minute
// only moves via the separate 30s REST loop; score only on a goal) —
// broadcasting every single tick to every connected client regardless
// was pure wasted outbound bandwidth on a metered host (this was the
// single biggest driver once the REST poll fallback was already cut down
// and the frontend moved off this host). RESYNC_MS still forces an
// occasional re-send even with no change, as a safety net against a
// client missing a message, just far less often than 1/sec.
const lastBroadcast = new Map();
// Matches whose clock we derive from the provider's T (seconds) because the
// REST feed carries no minute for them, and when we last persisted it.
const derivedClock = new Map();
const DERIVED_CLOCK_WRITE_MS = 15000;
const LIVE_TICK_RESYNC_MS = 15000;
// How long the last decoded pitch action (corner, attack, ...) stays on the
// pitch when the following messages carry no (decodable) VC. The provider's own
// pitch keeps showing the last action until the next one; clearing it on the very
// next ~1/sec tick made it flash for under a second -> "the pitch never shows it".
const ACTION_HOLD_MS = 8000;
// VC codes we could not decode, logged once each so they can be labelled in
// liveAction.js (never guessed). Bounded so a noisy feed cannot grow it.
const unmappedVcSeen = new Set();
const UNMAPPED_VC_CAP = 200;
const HT_HOLD_MS = 45000; // how long a VC=1015 "pushim" keeps clients in HT (> one REST cycle)

// Test-only: clears in-memory state between test cases so each test is
// independent (lastSeen/lastBroadcast are intentionally module-level, not
// per-call, in production — see comments above).
export function __resetLiveStateForTests() {
  unmappedVcSeen.clear();
  __resetLiveTrackerForTests(); // also clears the live row cache
  lastSeen.clear();
  lastBroadcast.clear();
  derivedClock.clear();
  unknownEidWarned.clear();
  lastTouched.clear();
  teamIndex = { at: 0, map: new Map() };
}

// MEMORY LEAK FIX: lastSeen/lastBroadcast/unknownEidWarned are module-level
// maps keyed by EID that only ever grew — nothing removed an entry once its
// match finished, so every match ever seen live stayed in memory for the
// life of the process. Called from the two places in london365.js that
// confirm a match has ended.
export function forgetLiveState(eid) {
  const id = String(eid || '').replace(/^l365-/, '');
  if (!id) return;
  lastSeen.delete(id);
  lastBroadcast.delete(id);
  derivedClock.delete(id);
  derivedClock.delete('l365-' + id);
  unknownEidWarned.delete(id);
  lastTouched.delete(id);
  forgetLiveRow(id);
  clearGoalAnnounced(id);
}

// MEMORY LEAK FIX #2: forgetLiveState above only ever runs for matches we
// actually imported (called from london365.js when one of THOSE ends). The
// gamedetails socket, however, is a GLOBAL feed — it pushes updates for
// every live match on the provider worldwide, most of which never match
// anything in matches_cache (different country/league — see
// LONDON365_ONLY_COUNTRIES). Every one of those "unknown" EIDs still hit
// the `lastSeen.set(eid, ...)` / `unknownEidWarned.add(eid)` lines below,
// and since forgetLiveState never fires for an EID we never imported, both
// maps grew without bound for the entire life of the process — this is
// what was actually behind the "JavaScript heap out of memory" crash
// (confirmed hitting the heap limit ~9 minutes after boot in production
// logs), not any single large object. This sweep is the backstop for that:
// called on an interval (see startStaleLiveStateSweep), it drops any EID
// (matched or not) not touched in STALE_AFTER_MS, which is far longer than
// any real match (including extra time/penalties) could plausibly still be
// live, so a genuinely in-progress match is never affected.
const STALE_AFTER_MS = 4 * 60 * 60 * 1000; // 4 hours
export function pruneStaleLiveState(now = Date.now(), staleAfterMs = STALE_AFTER_MS) {
  let pruned = 0;
  for (const [eid, ts] of lastTouched) {
    if (now - ts >= staleAfterMs) {
      lastSeen.delete(eid);
      unknownEidWarned.delete(eid);
      lastTouched.delete(eid);
      pruned++;
    }
  }
  for (const [matchId, entry] of lastBroadcast) {
    if (entry && now - entry.ts >= staleAfterMs) lastBroadcast.delete(matchId);
  }
  if (pruned) console.log(`[live] pruned ${pruned} stale in-memory EID entries (heap leak guard)`);
  return pruned;
}

let staleSweepTimer = null;
export function startStaleLiveStateSweep(intervalMs = 2 * 60 * 1000) {
  if (staleSweepTimer) return staleSweepTimer;
  staleSweepTimer = setInterval(() => pruneStaleLiveState(), intervalMs);
  if (staleSweepTimer.unref) staleSweepTimer.unref();
  return staleSweepTimer;
}


// EIDs to drop unconditionally, before any tracking/DB work at all --
// confirmed junk on this feed (e.g. a virtual/simulated fixture that isn't
// a real match and was sending updates several times a second, see the
// heap-OOM fix above). Not the same mechanism as unknownEidWarned (which
// still does one DB lookup and keeps a per-EID memory entry) -- this list
// is checked FIRST and the EID never touches lastSeen/lastTouched/the DB
// at all, so it costs nothing no matter how fast it bursts.
// 58729560: confirmed junk (a virtual/simulated fixture, several updates a
//   second) -- see the fast-heap-OOM fix this originally shipped with.
// 52628036: this one went back and forth (blocked, then unblocked on the
//   theory its T counter climbed steadily like one real match). Turns out
//   that was wrong -- capturing this EID's raw feed for longer shows AT
//   LEAST 5 distinct, unrelated real matches (different team pairs, e.g.
//   "FC Agniputhra v South United" alongside several women's internationals
//   like "China PR (W) v Philippines (W)") all tagged with this exact same
//   EID, cycling within the same few seconds. The provider is multiplexing
//   several real matches onto one EID -- our data model can only ever
//   attach updates to a single matches_cache row per id, so this EID can
//   never be correctly attributed to any one of them regardless of how
//   it's handled, and it's high enough traffic to be worth dropping
//   outright rather than silently mis-serving whichever match happens to
//   win the race.
const BLOCKED_EIDS = new Set(['58729560']);
// 52628036 is not a match id: the provider sends the details of several
// different live matches under this one EID (captures: Hapoel Tel Aviv v
// Hapoel Haifa, then Zaglebie Lubin II v Gornik Polkowice, ...). Applying it
// by EID would mix matches, and it never matches a l365-<gameId> row, so it
// used to be dropped. Instead the real match is found from the H/A team
// names in the message against the LIVE matches we hold; a message whose
// teams match no single live match (or match two) is dropped.
const TEAM_RESOLVED_EIDS = new Set(['52628036']);
const normTeam = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const TEAM_INDEX_TTL_MS = 10000;
let teamIndex = { at: 0, map: new Map() };
async function resolveGameIdByTeams(h, a) {
  const now = Date.now();
  if (now - teamIndex.at > TEAM_INDEX_TTL_MS) {
    try {
      const { rows } = await pool.query(
        "SELECT id AS game_id, home_team AS h, away_team AS a FROM matches_cache WHERE id LIKE 'l365-%' AND status = 'LIVE'"
      );
      const map = new Map();
      for (const r of rows) {
        const key = normTeam(r.h) + '|' + normTeam(r.a);
        map.set(key, map.has(key) ? null : String(r.game_id).replace(/^l365-/, '')); // null = ambiguous
      }
      teamIndex = { at: now, map };
    } catch (err) {
      teamIndex = { at: now - TEAM_INDEX_TTL_MS + 2000, map: teamIndex.map }; // retry in ~2s, keep old index
    }
  }
  return teamIndex.map.get(normTeam(h) + '|' + normTeam(a)) || null;
}
const TICK_LOG = process.env.LONDON365_GAMEDETAILS_TICK_LOG === '1';

// Provider ticks arrive about once a second per match while each tick awaits
// several DB round trips, so two ticks of one match can overlap and both see
// the same card/corner baseline -- the cause of duplicated events. Ticks of
// one match are therefore processed one after another.
const detailChains = new Map();
// Fingerprint of everything on a message that can change what the pitch shows.
function actionSignature(attrs) {
  return [attrs.VC, attrs.C1, attrs.C2, attrs.H2, attrs.H3, attrs.H4, attrs.A2, attrs.A3, attrs.A4]
    .map((v) => (v == null ? '' : String(v)))
    .join('|');
}

export function applyGameDetails(raw) {
  const a = parseGameDetails(raw);
  const key = a ? `${a.EID}|${a.H}|${a.A}` : '_';
  const prev = detailChains.get(key) || Promise.resolve();
  const next = prev.then(() => applyGameDetailsNow(raw));
  const tail = next.catch(() => {});
  detailChains.set(key, tail);
  tail.then(() => { if (detailChains.get(key) === tail) detailChains.delete(key); });
  return next;
}

// Insert a card/corner row only if the same one (type, team, running count)
// is not there already.
async function insertEventOnce(matchId, minute, type, team, detail, now) {
  const { rows } = await pool.query(
    'SELECT 1 FROM match_events WHERE match_id = $1 AND type = $2 AND team = $3 AND detail = $4 LIMIT 1',
    [matchId, type, team, detail]
  );
  if (rows && rows.length) return false;
  await pool.query(
    `INSERT INTO match_events (match_id, minute, type, team, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [matchId, minute, type, team, detail, now]
  );
  return true;
}

async function applyGameDetailsNow(raw) {
  bump('gamedetails.received');
  const attrs = parseGameDetails(raw);
  if (!attrs) return;
  let eid = attrs.EID;
  if (BLOCKED_EIDS.has(eid)) return;
  if (TEAM_RESOLVED_EIDS.has(eid)) {
    const gameId = await resolveGameIdByTeams(attrs.H, attrs.A);
    if (!gameId) { bump('gamedetails.dropped_team_unresolved'); return; }
    eid = gameId; // from here on this is the real game id, like any other EID
  }
  // Not a match we hold (different country/league, never imported): drop it
  // here, before it touches the per-EID maps or the database. This is a
  // membership check on an in-memory Set, evaluated on EVERY message, so a
  // game that gets imported later starts being processed immediately (the old
  // per-EID "unknown" verdict below could block it for up to 4 hours).
  // Fail-open until the tracker is loaded, so behaviour is unchanged if the
  // DB was unreachable at boot.
  if (!isTrackedGame(eid)) { bump('gamedetails.dropped_untracked'); return; }
  lastTouched.set(eid, Date.now());
  // Hard backstop against a burst overwhelming the scheduled sweep above:
  // this is a GLOBAL provider feed (every live match worldwide, most
  // never matching anything we imported — see the MEMORY LEAK FIX #2
  // comment), so its volume can spike far faster than a fixed-interval
  // timer can react to. If the map has grown past a sane ceiling, run an
  // immediate aggressive prune (a much shorter threshold than the normal
  // 4h one) right here in the hot path instead of waiting for the next
  // scheduled sweep — this is what actually prevents the heap from
  // filling up between timer ticks during a high-volume burst, which is
  // what a merely-more-frequent interval alone still cannot guarantee.
  if (lastTouched.size > 5000) pruneStaleLiveState(Date.now(), 10 * 60 * 1000);
  const t = Number(attrs.T);
  const prevSeen = lastSeen.get(eid);
  // Tracks the card-count baseline separately from `prevSeen` itself: when
  // the T-decrease branch below resets tracking for this EID (reused id /
  // new match), the OLD match's leftover yellow/red card counts must not
  // be used as the baseline for the new match's first diff — that would
  // either fabricate "cards" for the new match (if its real count is lower
  // than the old leftover) or silently miss its first real card (if the
  // new count doesn't yet exceed the old one).
  let cardBaseline = prevSeen;

  // De-dup / ordering within one EID's session: an EXACT repeat of the
  // last T we saw is the "provider re-sent the identical update" case and
  // is safe to skip outright. A DECREASE, however, is NOT treated as a
  // stale duplicate to discard — production data has shown T (and the
  // score) going backwards for the same EID, most plausibly because the
  // provider reused that EID for a later, unrelated match once the
  // earlier one ended. Silently dropping every update forever after that
  // point (the previous behavior) would freeze a genuinely live new match
  // on this fast socket path indefinitely, since its T would almost never
  // climb back above the old match's peak. So a decrease instead clears
  // this EID's tracking and falls through to processing the update
  // normally, as if seeing this EID for the first time. This is safe even
  // if the decrease is actually just a rare out-of-order duplicate
  // delivery rather than a genuine reuse: recordGoalIfChanged below makes
  // its own idempotency decision from the current DB row, not from this
  // in-memory counter, so re-processing an identical score is still a
  // no-op there either way.
  if (prevSeen && Number.isFinite(t)) {
    // An exact repeat is only skippable when it ALSO carries the same pitch
    // action and counters. A corner/attack often arrives between two clock ticks
    // with the same T as the previous message; dropping it here (the old
    // `t === prevSeen.t` check) meant that action was never read at all.
    if (t === prevSeen.t && prevSeen.sig === actionSignature(attrs)) return;
    if (t < prevSeen.t) {
      lastSeen.delete(eid);
      cardBaseline = null;
      // This EID has (most plausibly) moved on to a new match session --
      // if it was previously marked "unknown" (see MEMORY LEAK FIX #2 /
      // the DB-skip optimization above), that verdict belongs to the OLD
      // session and must not be reused for whatever match this EID
      // represents now, or a genuine match we do track could go silently
      // unmatched for up to 4 hours (until pruneStaleLiveState clears it).
      unknownEidWarned.delete(eid);
    }
  }

  const matchId = 'l365-' + eid;
  // Skip the DB round-trip entirely for an EID we've already confirmed
  // isn't one of ours this run (see the "no matching cached game" log
  // below) -- with the coalescing fix in london365Socket.js this no
  // longer risks unbounded concurrency, but a chatty non-match feed (a
  // virtual/simulated fixture has been observed sending updates several
  // times a SECOND) was still burning a full round-trip to Aiven Postgres
  // per tick for a lookup whose answer cannot change mid-match. Cleared by
  // pruneStaleLiveState like everything else, so a genuine EID reuse still
  // gets a fresh lookup eventually.
  if (unknownEidWarned.has(eid)) {
    lastSeen.set(eid, { t: Number.isFinite(t) ? t : 0, yc1: 0, yc2: 0, rc1: 0, rc2: 0 });
    return;
  }
  // Teams / score / minute for this match, from the short-lived in-memory copy
  // that every writer of those columns keeps current (upsertMatch here and in
  // london365.js, and the score UPDATE below), instead of one SELECT per
  // provider tick (~1/sec per live match). The TTL (see liveTracker.js) bounds
  // how stale it can ever be if some writer were ever missed.
  let row = getLiveRow(matchId);
  if (row) {
    bump('gamedetails.row_cache_hit');
  } else {
    bump('gamedetails.row_select');
    const { rows } = await pool.query(
      'SELECT id, home_team, away_team, live_home_score, live_away_score, live_minute, live_status FROM matches_cache WHERE id = $1',
      [matchId]
    );
    row = rows[0];
    if (row) setLiveRow(matchId, row);
  }
  if (!row) {
    // Game not in our catalog (different country/league than what we
    // import — see LONDON365_ONLY_COUNTRIES). Per instructions, this
    // module must never force an import or touch the country/league
    // whitelist, so it just skips, logging once per EID to avoid spam.
    // Silenced on purpose: this is a GLOBAL feed and most EIDs will never
    // match anything we imported (different country/league — see
    // LONDON365_ONLY_COUNTRIES). That's expected, permanent, per-EID noise,
    // not a bug worth a log line every time it's first seen — it was
    // filling the logs with nothing actionable in it. The unknownEidWarned
    // tracking itself is untouched (still skips the DB round-trip on every
    // later tick for the same EID); only the console.log is gone.
    unknownEidWarned.add(eid);
    lastSeen.set(eid, { t: Number.isFinite(t) ? t : 0, yc1: 0, yc2: 0, rc1: 0, rc2: 0 });
    return;
  }

  const score = parseScore(attrs.SC);
  let minuteDisplay = normalizeLiveMinute(row.live_minute) || null; // verified source, see header comment
  // Most matches carry NO minute on the REST side (they only showed "LIVE").
  // T is the game clock in seconds (verified), so use it when REST has none,
  // and keep using it for matches already marked as derived (a value we
  // stored ourselves would otherwise freeze as the "REST minute").
  const derivedState = derivedClock.get(matchId);
  const useDerived = Number.isFinite(t) && t > 0 && t < 8 * 3600 && (!minuteDisplay || derivedState);
  if (useDerived) {
    minuteDisplay = Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
    const nowW = Date.now();
    if (!derivedState || nowW - derivedState.at >= DERIVED_CLOCK_WRITE_MS) {
      derivedClock.set(matchId, { at: nowW });
      await pool.query(
        'UPDATE matches_cache SET live_minute = $1, live_minute_updated_at = $2 WHERE id = $3',
        [minuteDisplay, nowW, matchId]
      );
    }
  }
  // Event minute as the provider labels it: T is the game clock in seconds
  // (verified against its on-screen clock) and the minute in progress is
  // floor(T/60)+1. Falls back to the stored clock string without a usable T.
  const eventMinuteNow = Number.isFinite(t) && t >= 0 ? Math.floor(t / 60) + 1 : eventMinuteFromClock(minuteDisplay);
  // Per-tick log line (~1/sec per live match) is opt-in: it was flooding the
  // log stream and costs CPU for no diagnostic value once the feed is confirmed.
  if (TICK_LOG) console.log(`[live] EID=${eid} score=${attrs.SC || '?'} minute=${minuteDisplay || '?'}`);

  // BUG FIX: this fast (~1/sec) socket used to only ever write the score
  // into `live_statistics` (via recordGoalIfChanged below) and never into
  // matches_cache.live_home_score/live_away_score — the columns actually
  // read by GET /api/matches and GET /api/matches/:id (see routes/matches.js
  // and oddsUtils.mapEventToMatch). Those columns were only ever refreshed
  // by the *separate* 30s REST live loop (syncLondon365Live in london365.js).
  // Net effect: a client that (re)loads the match list, or reconnects after
  // missing the one-off pushGoal broadcast, could sit on a stale score for
  // up to ~30s even though this socket had the correct value the instant it
  // arrived — exactly the "provider is live but the page doesn't reflect it"
  // symptom. Now the confirmed score is written here immediately, so
  // matches_cache is never behind what this socket already knows.
  let homeScoreForBroadcast = row.live_home_score;
  let awayScoreForBroadcast = row.live_away_score;

  // Broadcast on EVERY processed update (not only when the score changes),
  // so a connected client's minute/score get resynced at this feed's real
  // ~1/sec cadence instead of waiting on the next goal or the slow 60s
  // match-list poll. Only ever carries values already verified elsewhere
  // (matches_cache.live_minute / live_home_score / live_away_score) — never
  // derived from the unconfirmed T/H1-H8/A1-A8 fields (see header comment).
  // Broadcast only when a connected client would actually see something
  // different (score/minute changed), or every LIVE_TICK_RESYNC_MS as a
  // safety net — not on every ~1/sec provider tick regardless of content.
  // Values are still only ever the already-verified matches_cache ones
  // (see header comment) — this only changes WHEN we send, never WHAT.
  // What the pitch shows: the provider's own VC code when we can decode it;
  // otherwise the latest increase of a per-team counter, held for a few
  // seconds. Counters confirmed against hand-labelled captures: C1/C2 corners,
  // H4/A4 dangerous attacks, H3/A3 attacks, H2/A2 offsides (each rose in the
  // same message as the matching action). Needs a baseline: the first message
  // of a match never produces an action.
  const num = (k) => Number(attrs[k]) || 0;
  const ctr = { c1: num('C1'), c2: num('C2'), h2: num('H2'), h3: num('H3'), h4: num('H4'), a2: num('A2'), a3: num('A3'), a4: num('A4') };
  const nowMs = Date.now();
  let recent = cardBaseline && cardBaseline.recent && cardBaseline.recent.until > nowMs ? cardBaseline.recent : null;
  if (cardBaseline && cardBaseline.ctr) {
    const up = (k) => ctr[k] > cardBaseline.ctr[k];
    const found = up('c1') ? ['home', 'corner'] : up('c2') ? ['away', 'corner']
      : up('h4') ? ['home', 'dangerous_attack'] : up('a4') ? ['away', 'dangerous_attack']
      : up('h3') ? ['home', 'attack'] : up('a3') ? ['away', 'attack']
      : up('h2') ? ['home', 'offside'] : up('a2') ? ['away', 'offside'] : null;
    if (found) recent = { ...makeAction(found[0], found[1]), until: nowMs + 7000 };
  }
  const decodedAction = decodeLiveAction(attrs.VC);
  const vcText = String(attrs.VC ?? '').trim();
  if (vcText && !decodedAction && !unmappedVcSeen.has(vcText) && unmappedVcSeen.size < UNMAPPED_VC_CAP) {
    unmappedVcSeen.add(vcText);
    console.log('[gamedetails] unmapped VC code "' + vcText + '" (EID ' + eid + ', T=' + attrs.T + ', SC=' + (attrs.SC || '?') + ') -- label it in server/liveAction.js');
  }
  // Last real action, kept for ACTION_HOLD_MS so a quiet/unknown next message
  // does not wipe the pitch the instant after the action arrived.
  let held = cardBaseline && cardBaseline.held && cardBaseline.held.until > nowMs ? cardBaseline.held : null;
  if (decodedAction && decodedAction.kind !== 'half_time') {
    held = { action: decodedAction, until: nowMs + ACTION_HOLD_MS };
  } else if (recent) {
    held = { action: { side: recent.side, kind: recent.kind, label: recent.label }, until: Math.max(held ? held.until : 0, recent.until) };
  }
  const liveAction = decodedAction
    || (recent ? { side: recent.side, kind: recent.kind, label: recent.label } : null)
    || (held ? held.action : null);
  const actionKey = (a) => (a ? a.side + ':' + a.kind : null);
  // Half time. VC=1015 is the provider's own "pushim" (hand-labelled capture);
  // it is held for HT_HOLD_MS so one quiet tick cannot flip the clients back to a
  // running clock before the REST sync (api_status) confirms it. Otherwise the
  // provider's status code from the REST sync is passed on, so clients learn about
  // HT / 2H at socket speed instead of at the next list refresh.
  let htUntil = cardBaseline && cardBaseline.htUntil > nowMs ? cardBaseline.htUntil : 0;
  if (liveAction && liveAction.kind === 'half_time') htUntil = nowMs + HT_HOLD_MS;
  const liveStatusNow = htUntil > nowMs ? 'HT' : (row.live_status || undefined);
  function broadcastTick() {
    const nowTs = Date.now();
    const prevBroadcast = lastBroadcast.get(matchId);
    const tickPayload = {
      minute: minuteDisplay || undefined,
      // Real server-side "as of now" reference for this push, same reason
      // as goalAnnouncer.js -- without it the frontend clock briefly
      // anchors a fresh minute to a stale timestamp already in state.
      minuteUpdatedAt: minuteDisplay ? nowTs : undefined,
      homeScore: homeScoreForBroadcast ?? undefined,
      awayScore: awayScoreForBroadcast ?? undefined,
      // What the provider's pitch shows right now (attack, corner, ...),
      // decoded from VC only for codes confirmed in liveAction.js; null when
      // the code is unknown so the client clears any previous label.
      action: liveAction,
      // HT / 1H / 2H ... so the client can stop and restart its clock at once.
      liveStatus: liveStatusNow,
    };
    const changed = !prevBroadcast
      || actionKey(prevBroadcast.action) !== actionKey(liveAction)
      || prevBroadcast.liveStatus !== tickPayload.liveStatus
      || prevBroadcast.minute !== tickPayload.minute
      || prevBroadcast.homeScore !== tickPayload.homeScore
      || prevBroadcast.awayScore !== tickPayload.awayScore;
    const dueForResync = !prevBroadcast || (nowTs - prevBroadcast.ts) >= LIVE_TICK_RESYNC_MS;
    if (changed || dueForResync) {
      pushLiveTick(matchId, tickPayload);
      lastBroadcast.set(matchId, { ...tickPayload, ts: nowTs });
    }
  }

  const scoreChanged = Boolean(score)
    && (score.home !== row.live_home_score || score.away !== row.live_away_score);
  const prevScoreRow = { live_home_score: row.live_home_score, live_away_score: row.live_away_score };
  const goalEv = { id: matchId, home_team: attrs.H || row.home_team, away_team: attrs.A || row.away_team };

  if (scoreChanged) {
    // INSTANT PATH: the goal and the new score go to every connected client
    // straight from memory, before any Postgres round trip. Persistence (the
    // UPDATE below, match_events, live_statistics) follows and used to sit in
    // FRONT of the push -- 3 sequential DB round trips (plus a possible Neon
    // cold start) between the provider's tick and the client's screen.
    homeScoreForBroadcast = score.home;
    awayScoreForBroadcast = score.away;
    announceGoalIfChanged(goalEv, score, minuteDisplay, prevScoreRow);
    broadcastTick();
    await pool.query(
      'UPDATE matches_cache SET live_home_score = $1, live_away_score = $2 WHERE id = $3',
      [score.home, score.away, matchId]
    );
    // Keep the in-memory copy in step with the row we just wrote. `row` itself
    // is left untouched: everything below (goal diff, `before`) needs the
    // PRE-update values.
    setLiveRow(matchId, { ...row, live_home_score: score.home, live_away_score: score.away });
  }

  if (score) {
    const ev = goalEv;
    const before = `${row.live_home_score}-${row.live_away_score}`;
    await recordGoalIfChanged(ev, score, minuteDisplay, prevScoreRow, eventMinuteNow);
    if (`${score.home}-${score.away}` !== before) {
      const team = Math.sign(score.home - (row.live_home_score || 0)) === 1 ? 'home' : 'away';
      console.log(`[live-event] GOAL EID=${eid} team=${team} score=${score.home}-${score.away} minute=${minuteDisplay || '?'}`);
    }
  }

  // Steady ~1/sec resync path (a score change was already broadcast above).
  broadcastTick();

  const yc1 = Number(attrs.YC1) || 0, yc2 = Number(attrs.YC2) || 0;
  const rc1 = Number(attrs.RC1) || 0, rc2 = Number(attrs.RC2) || 0;
  // C1/C2 = corners. Naming follows the exact same <letter><side> pattern
  // as YC1/YC2 (yellow cards) and RC1/RC2 (red cards) above, which is a
  // real, verified field -- high confidence this is the same convention,
  // not a guess. H1-H8/A1-A8 are NOT parsed here: their meaning isn't
  // confirmed (except H7/A7, see below), and mislabeling a live stat wrong
  // is worse than just not showing it.
  const c1 = Number(attrs.C1) || 0, c2 = Number(attrs.C2) || 0;
  // H7/A7 = possession %. Confirmed structurally (not guessed): in every
  // captured sample H7+A7 sums to exactly 100, which uniquely identifies a
  // possession-percentage pair among this feed's fields.
  const hasPossession = attrs.H7 !== undefined && attrs.H7 !== '' && attrs.A7 !== undefined && attrs.A7 !== '';
  const posHome = hasPossession ? Number(attrs.H7) : null;
  const posAway = hasPossession ? Number(attrs.A7) : null;
  const prevCards = cardBaseline || { yc1: 0, yc2: 0, rc1: 0, rc2: 0, c1: 0, c2: 0, posHome: null, posAway: null };
  const now = Date.now();
  const minuteNum = eventMinuteNow;

  // Totals on a first-ever message are history we cannot date, EXCEPT very
  // early in a match (a fresh session / reused EID), where the true starting
  // counts are zero and a first card or corner really is new.
  const baselineKnown = Boolean(cardBaseline) || (Number.isFinite(t) && t <= 300);
  async function recordCard(type, team, count) {
    // Clients first (memory), history row after -- same reasoning as goals.
    pushCardEvent(matchId, { cardType: type, team, count, minute: minuteDisplay || undefined, minuteUpdatedAt: minuteDisplay ? now : undefined });
    if (!(await insertEventOnce(matchId, minuteNum, type, team, String(count), now))) return;
    console.log(`[live-event] ${type} EID=${eid} team=${team} minute=${minuteDisplay || '?'}`);
  }
  // Only against a known baseline: on the first message we ever see for a
  // match (or after the baseline was dropped) the totals are history we cannot
  // date, and turning them into events stamped with the CURRENT minute is what
  // produced cards at the wrong minute. The totals themselves are still saved
  // to live_statistics below.
  if (baselineKnown) {
    if (yc1 > prevCards.yc1) await recordCard('YELLOW_CARD', 'home', yc1);
    if (yc2 > prevCards.yc2) await recordCard('YELLOW_CARD', 'away', yc2);
    if (rc1 > prevCards.rc1) await recordCard('RED_CARD', 'home', rc1);
    if (rc2 > prevCards.rc2) await recordCard('RED_CARD', 'away', rc2);
  }

  // Corners as discrete events (the "Ngjarjet" list), one per increment of
  // C1/C2. Only once a baseline exists: on the first message we ever see for a
  // match the totals are history we cannot date, so they must not be turned
  // into events at the current minute. Capped per tick so a data glitch can't
  // flood the table.
  if (baselineKnown) {
    const addCorners = async (team, from, to) => {
      for (let n = from + 1; n <= Math.min(to, from + 3); n++) {
        await insertEventOnce(matchId, minuteNum, 'CORNER', team, String(n), now);
      }
    };
    if (c1 > prevCards.c1) await addCorners('home', prevCards.c1, c1);
    if (c2 > prevCards.c2) await addCorners('away', prevCards.c2, c2);
  }

  // Keep the aggregate totals the stats panel actually reads
  // (live_statistics.cards_home/away) in step with the discrete
  // match_events rows above -- these were previously only ever recorded as
  // individual events, never summed into the columns the UI queries, so
  // the "Cards" stat box stayed empty even though card data WAS arriving.
  // Only written when it actually changed, same reasoning as
  // live_minute_updated_at: an unconditional write on every ~1/sec tick
  // would be a lot of unnecessary churn for a number that rarely moves.
  if (yc1 !== prevCards.yc1 || yc2 !== prevCards.yc2 || rc1 !== prevCards.rc1 || rc2 !== prevCards.rc2) {
    await pool.query(
      `INSERT INTO live_statistics (match_id, cards_home, cards_away, updated_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (match_id) DO UPDATE SET cards_home = excluded.cards_home, cards_away = excluded.cards_away, updated_at = excluded.updated_at`,
      [matchId, yc1 + rc1, yc2 + rc2, now]
    );
  }
  // Corners -- same reasoning/shape as cards above, only written on change.
  if (c1 !== prevCards.c1 || c2 !== prevCards.c2) {
    await pool.query(
      `INSERT INTO live_statistics (match_id, corners_home, corners_away, updated_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (match_id) DO UPDATE SET corners_home = excluded.corners_home, corners_away = excluded.corners_away, updated_at = excluded.updated_at`,
      [matchId, c1, c2, now]
    );
  }
  // Possession -- only written when the feed actually sent a value for
  // this tick (hasPossession), and only on change, same as the others.
  if (hasPossession && (posHome !== prevCards.posHome || posAway !== prevCards.posAway)) {
    await pool.query(
      `INSERT INTO live_statistics (match_id, possession_home, possession_away, updated_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (match_id) DO UPDATE SET possession_home = excluded.possession_home, possession_away = excluded.possession_away, updated_at = excluded.updated_at`,
      [matchId, posHome, posAway, now]
    );
  }

  lastSeen.set(eid, { t: Number.isFinite(t) ? t : (prevSeen ? prevSeen.t : 0), yc1, yc2, rc1, rc2, c1, c2, posHome, posAway, ctr, recent, htUntil, held, sig: actionSignature(attrs) });
}

export function getGameDetailsMemoryDiagnostics() {
  return {
    lastSeen: lastSeen.size,
    lastTouched: lastTouched.size,
    unknownEidWarned: unknownEidWarned.size,
    lastBroadcast: lastBroadcast.size,
  };
}
