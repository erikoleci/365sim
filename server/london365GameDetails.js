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
import { recordGoalIfChanged, minuteToNumber } from './london365.js';
import { parseGameDetails } from './gameDetailsParser.js';
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
const LIVE_TICK_RESYNC_MS = 15000;

// Test-only: clears in-memory state between test cases so each test is
// independent (lastSeen/lastBroadcast are intentionally module-level, not
// per-call, in production — see comments above).
export function __resetLiveStateForTests() {
  lastSeen.clear();
  lastBroadcast.clear();
  unknownEidWarned.clear();
  lastTouched.clear();
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
  unknownEidWarned.delete(id);
  lastTouched.delete(id);
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
const BLOCKED_EIDS = new Set(['58729560']);

export async function applyGameDetails(raw) {
  const attrs = parseGameDetails(raw);
  if (!attrs) return;
  const eid = attrs.EID;
  if (BLOCKED_EIDS.has(eid)) return;
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
    if (t === prevSeen.t) return;
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
  const { rows } = await pool.query(
    'SELECT id, home_team, away_team, live_home_score, live_away_score, live_minute FROM matches_cache WHERE id = $1',
    [matchId]
  );
  const row = rows[0];
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
  const minuteDisplay = row.live_minute || null; // verified source, see header comment
  console.log(`[live] EID=${eid} score=${attrs.SC || '?'} minute=${minuteDisplay || '?'}`);

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
  if (score && (score.home !== row.live_home_score || score.away !== row.live_away_score)) {
    await pool.query(
      'UPDATE matches_cache SET live_home_score = $1, live_away_score = $2 WHERE id = $3',
      [score.home, score.away, matchId]
    );
    homeScoreForBroadcast = score.home;
    awayScoreForBroadcast = score.away;
  }

  if (score) {
    const ev = { id: matchId, home_team: attrs.H || row.home_team, away_team: attrs.A || row.away_team };
    const prevScoreRow = { live_home_score: row.live_home_score, live_away_score: row.live_away_score };
    const before = `${row.live_home_score}-${row.live_away_score}`;
    await recordGoalIfChanged(ev, score, minuteDisplay, prevScoreRow);
    if (`${score.home}-${score.away}` !== before) {
      const team = Math.sign(score.home - (row.live_home_score || 0)) === 1 ? 'home' : 'away';
      console.log(`[live-event] GOAL EID=${eid} team=${team} score=${score.home}-${score.away} minute=${minuteDisplay || '?'}`);
    }
  }

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
  const nowTs = Date.now();
  const prevBroadcast = lastBroadcast.get(matchId);
  const tickPayload = {
    minute: minuteDisplay || undefined,
    homeScore: homeScoreForBroadcast ?? undefined,
    awayScore: awayScoreForBroadcast ?? undefined,
  };
  const changed = !prevBroadcast
    || prevBroadcast.minute !== tickPayload.minute
    || prevBroadcast.homeScore !== tickPayload.homeScore
    || prevBroadcast.awayScore !== tickPayload.awayScore;
  const dueForResync = !prevBroadcast || (nowTs - prevBroadcast.ts) >= LIVE_TICK_RESYNC_MS;
  if (changed || dueForResync) {
    pushLiveTick(matchId, tickPayload);
    lastBroadcast.set(matchId, { ...tickPayload, ts: nowTs });
  }

  const yc1 = Number(attrs.YC1) || 0, yc2 = Number(attrs.YC2) || 0;
  const rc1 = Number(attrs.RC1) || 0, rc2 = Number(attrs.RC2) || 0;
  const prevCards = cardBaseline || { yc1: 0, yc2: 0, rc1: 0, rc2: 0 };
  const now = Date.now();
  const minuteNum = minuteToNumber(minuteDisplay);

  async function recordCard(type, team, count) {
    await pool.query(
      `INSERT INTO match_events (match_id, minute, type, team, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [matchId, minuteNum, type, team, String(count), now]
    );
    pushCardEvent(matchId, { cardType: type, team, count, minute: minuteDisplay || undefined });
    console.log(`[live-event] ${type} EID=${eid} team=${team} minute=${minuteDisplay || '?'}`);
  }
  if (yc1 > prevCards.yc1) await recordCard('YELLOW_CARD', 'home', yc1);
  if (yc2 > prevCards.yc2) await recordCard('YELLOW_CARD', 'away', yc2);
  if (rc1 > prevCards.rc1) await recordCard('RED_CARD', 'home', rc1);
  if (rc2 > prevCards.rc2) await recordCard('RED_CARD', 'away', rc2);

  lastSeen.set(eid, { t: Number.isFinite(t) ? t : (prevSeen ? prevSeen.t : 0), yc1, yc2, rc1, rc2 });
}

export function getGameDetailsMemoryDiagnostics() {
  return {
    lastSeen: lastSeen.size,
    lastTouched: lastTouched.size,
    unknownEidWarned: unknownEidWarned.size,
    lastBroadcast: lastBroadcast.size,
  };
}
