// Native Socket.IO client for the LondonPro365 live feed.
//
// The SPA at londonpro365.com streams real-time deltas from
// ecco.socketi355.com:1440 over rooms "inplay" and "prematch-games".
// This module keeps a persistent connection and forwards every event into
// the provider module's DB handlers, so odds, scores, and match lifecycle
// changes land in matches_cache (and reach app clients over our own
// WebSocket) without waiting for the next REST poll. REST polling stays on
// as a safety net: if the socket drops, the 30s loop re-syncs everything.
//
// Env:
//   LONDON365_SOCKET           default https://ecco.socketi355.com:1440
//   LONDON365_SOCKET_ENABLED   1 (default) or 0

import pool from './db.js';
import {
  isLondon365Enabled,
  setLondon365SocketConnected,
  applySocketCoefs,
  applySocketGame,
  markLondon365GameEnded,
  removeSocketCoef,
  isLiveGameWanted,
} from './london365.js';
import { applyGameDetails, startStaleLiveStateSweep } from './london365GameDetails.js';
import { hasKnownLiveMatches } from './liveTracker.js';

const SOCKET_URL = process.env.LONDON365_SOCKET || 'https://ecco.socketi355.com:1440';
const SOCKET_ENABLED = (process.env.LONDON365_SOCKET_ENABLED || '1') === '1';

// Separate live-match-DETAIL feed (score/cards/etc per game, event
// "gamedetails") — a different socket endpoint from the odds feed above.
// Kept fully independent: if this one is unavailable/misbehaving, the
// odds/coefs socket and REST polling are completely unaffected.
const GAMEDETAILS_SOCKET_URL = process.env.LONDON365_GAMEDETAILS_SOCKET || 'https://ecco-p2p.socketi355.com:1338';
const GAMEDETAILS_SOCKET_ENABLED = (process.env.LONDON365_GAMEDETAILS_SOCKET_ENABLED || '1') === '1';
let gameDetailsSocket = null;
// Game ids (bare provider id, no "l365-" prefix) we've asked the
// gamedetails socket to stream. Re-sent on every (re)connect since the
// provider's server doesn't remember subscriptions across a dropped
// connection — see gameDetailsSocket.on('connect', ...) below.
const subscribedGameIds = new Set();

let socket = null;

export function isLondon365SocketConnected() {
  return !!(socket && socket.connected);
}

export async function startLondon365Socket() {
  if (!isLondon365Enabled() || !SOCKET_ENABLED || socket) return;

  let io;
  try {
    // socket.io-client 2.x speaks the same protocol as the provider's server
    // (the SPA itself ships a 2.x client); a 4.x client would fail handshake.
    io = (await import('socket.io-client')).default;
  } catch (err) {
    console.warn('[london365-socket] socket.io-client unavailable, REST polling only:', err.message);
    return;
  }

  try {
    socket = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 3000,
      reconnectionDelayMax: 30000,
      timeout: 10000,
      rejectUnauthorized: false,
    });
  } catch (err) {
    console.error('[london365-socket] failed to create client:', err.message);
    socket = null;
    return;
  }

  socket.on('connect', function () {
    setLondon365SocketConnected(true);
    console.log('[london365-socket] connected to ' + SOCKET_URL);
    socket.emit('connectToRoom', { room: 'inplay' });
    socket.emit('connectToRoom', { room: 'prematch-games' });
  });

  socket.on('disconnect', function () {
    setLondon365SocketConnected(false);
  });

  socket.on('connect_error', function (err) {
    setLondon365SocketConnected(false);
    console.warn('[london365-socket] ' + err.message + ' (REST polling continues)');
  });

  // Real-time coefficient movement for a live game: { game_id, coefs: [...] }
  socket.on('new-coefs', function (d) {
    if (!d || !d.game_id) return;
    applySocketCoefs(d.game_id, d.coefs || []).catch(function (err) {
      console.error('[london365-socket] new-coefs failed:', err.message);
    });
  });

  // A new prematch game appeared: full game payload with packed odd string.
  socket.on('new-game', function (d) {
    if (!d || !d.id) return;
    applySocketGame(d, 'UPCOMING').catch(function (err) {
      console.error('[london365-socket] new-game failed:', err.message);
    });
  });

  // A game just kicked off / became live.
  socket.on('new-live-game', function (d) {
    if (!d || !d.id) return;
    // Start streaming this game's live detail (score/cards/etc) the moment it
    // goes live -- immediately, NOT after the DB write below, so the first
    // goal can never be waiting on Postgres or on odds parsing. Only games that
    // pass the country/competition filter are subscribed (a synchronous,
    // in-memory check); previously every live game worldwide was subscribed and
    // then dropped again by the 2-minute reconcile.
    if (isLiveGameWanted(d)) subscribeGameDetails(d.id);
    applySocketGame(d, 'LIVE').catch(function (err) {
      console.error('[london365-socket] new-live-game failed:', err.message);
    });
  });

  // A game left the live feed (finished or postponed): stop showing it as LIVE.
  socket.on('delete-live-game', function (d) {
    if (!d || !d.id) return;
    markLondon365GameEnded(d.id).catch(function (err) {
      console.error('[london365-socket] delete-live-game failed:', err.message);
    });
  });

  // A single coefficient was withdrawn from a live game.
  socket.on('delete-live-coef', function (d) {
    if (!d || !d.game_id || !d.coef_id) return;
    removeSocketCoef(d.game_id, d.coef_id).catch(function (err) {
      console.error('[london365-socket] delete-live-coef failed:', err.message);
    });
  });

  console.log('[london365-socket] starting live socket feed for ' + SOCKET_URL);
}

export function stopLondon365Socket() {
  if (!socket) return;
  try { socket.close(); } catch (err) { /* ignore */ }
  socket = null;
  setLondon365SocketConnected(false);
}

// Live-match-DETAIL socket ("gamedetails" event): score, cards, and the
// other per-tick fields listed at the top of london365GameDetails.js.
// Every message is processed the instant it arrives — no batching, no
// waiting for the next REST/live-loop cycle (see applyGameDetails).
export async function startLondon365GameDetailsSocket() {
  if (!isLondon365Enabled() || !GAMEDETAILS_SOCKET_ENABLED || gameDetailsSocket) return;

  // Heap-leak guard: this socket receives updates for every live match on
  // the provider worldwide, and most never match anything we imported (see
  // pruneStaleLiveState's comment in london365GameDetails.js for why that
  // otherwise grows the in-memory tracking maps without bound). Starting
  // the sweep here ties its lifetime to this socket's, and it's a no-op
  // (early-returns) if already running, so this is safe even if this
  // function is ever called more than once.
  startStaleLiveStateSweep();

  let io;
  try {
    io = (await import('socket.io-client')).default;
  } catch (err) {
    console.warn('[london365-gamedetails] socket.io-client unavailable:', err.message);
    return;
  }

  try {
    gameDetailsSocket = io(GAMEDETAILS_SOCKET_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 3000,
      reconnectionDelayMax: 30000,
      timeout: 10000,
      rejectUnauthorized: false,
    });
  } catch (err) {
    console.error('[london365-gamedetails] failed to create client:', err.message);
    gameDetailsSocket = null;
    return;
  }

  gameDetailsSocket.on('connect', function () {
    console.log('[london365-gamedetails] connected to ' + GAMEDETAILS_SOCKET_URL);
    // Per-game subscribe, not a room join (see subscribeGameDetails above).
    // Re-send every id we already know about — the provider's server
    // doesn't remember subscriptions across a reconnect — plus backfill
    // from the DB in case some games went live before this socket ever
    // connected (e.g. right after a boot/redeploy).
    for (const id of subscribedGameIds) {
      gameDetailsSocket.emit('merranimim', { gameid: id });
    }
    pool.query("SELECT id FROM matches_cache WHERE id LIKE 'l365-%' AND status = 'LIVE'")
      .then(function (res) {
        for (const row of res.rows) subscribeGameDetails(row.id);
      })
      .catch(function (err) {
        console.error('[london365-gamedetails] live backfill query failed:', err.message);
      });
  });
  gameDetailsSocket.on('disconnect', function () {
    console.warn('[london365-gamedetails] disconnected — socket.io will auto-reconnect');
  });
  gameDetailsSocket.on('connect_error', function (err) {
    console.warn('[london365-gamedetails] ' + err.message);
  });

  // The feed sends one flat XML-attribute string per update — see
  // parseGameDetails in gameDetailsParser.js for the exact shape.
  let gameDetailsCount = 0;
  // Opt-in, single-match full trace: the normal sampled/truncated log below
  // is fine for "is the socket alive" checks, but useless for figuring out
  // what H1-H8/A1-A8 actually mean — that needs every update for ONE EID,
  // untruncated, with a real wall-clock timestamp so it can be lined up
  // against what londonpro365.com's own live match center shows for that
  // same match at that same moment (attacks, corners, shots, possession).
  // Set LONDON365_GAMEDETAILS_CAPTURE_EID=<the EID> temporarily while
  // watching one live match; leave unset otherwise (this is not meant to
  // run permanently — it logs every single update, no sampling).
  const CAPTURE_EID = process.env.LONDON365_GAMEDETAILS_CAPTURE_EID || null;
  // Hard cap so a forgotten LONDON365_GAMEDETAILS_CAPTURE_EID can never flood the
  // terminal/log stream forever (one multiplexed EID sends several untruncated
  // lines per second; left on it swamped the console and slowed the whole
  // process). Logs the first N lines, then says so once and stops until restart.
  const CAPTURE_MAX_LINES = Math.max(1, Number(process.env.LONDON365_GAMEDETAILS_CAPTURE_MAX || 200));
  let captureLines = 0;
  // MEMORY LEAK FIX #3 (the fast one): applyGameDetails does a DB
  // round-trip (a SELECT against matches_cache, sometimes an UPDATE/INSERT
  // too) per message. The line below used to fire it completely
  // unawaited -- `applyGameDetails(raw).catch(...)` -- for every single
  // incoming socket message with zero backpressure. Under normal load
  // that's harmless (the DB round-trip is much faster than messages
  // arrive), but this is a GLOBAL feed and at least one EID observed in
  // production sends updates many times a SECOND (looks like a
  // virtual/simulated fixture, not a real match) -- when the arrival rate
  // outpaces the DB round-trip rate even briefly, every unawaited call
  // stays alive (with its own pending pg query, parsed attrs, and
  // closures) until that query resolves, so the number of CONCURRENT
  // in-flight calls grows without bound for as long as the burst lasts.
  // This is what actually caused the heap-limit OOM crashes recorded
  // within ~100s of boot -- much too fast to be the (already-fixed,
  // bounded) EID-tracking-map leak, which only grows over hours.
  //
  // Fix: coalesce by EID into a single pending map (a burst of updates for
  // the SAME EID just overwrites the previous pending one -- only the
  // latest live state ever matters for a tick feed like this) and drain it
  // with exactly one applyGameDetails call in flight at a time. Memory is
  // now bounded by the number of DISTINCT eids simultaneously live
  // (realistically dozens, never thousands), not by total message volume,
  // no matter how fast any single EID's feed bursts.
  const pendingByEid = new Map(); // eid -> raw string (latest only)
  let draining = false;

  async function drainPending() {
    if (draining) return;
    draining = true;
    try {
      while (pendingByEid.size) {
        const [eid, raw] = pendingByEid.entries().next().value;
        pendingByEid.delete(eid);
        try {
          await applyGameDetails(raw);
        } catch (err) {
          console.error('[london365-gamedetails] apply failed:', err.message);
        }
      }
    } finally {
      draining = false;
    }
  }

  gameDetailsSocket.on('gamedetails', function (raw) {
    gameDetailsCount++;
    if (gameDetailsCount <= 3 || gameDetailsCount % 200 === 0) {
      console.log('[london365-gamedetails] received #' + gameDetailsCount + ':', String(raw).slice(0, 200));
    }
    if (CAPTURE_EID && captureLines < CAPTURE_MAX_LINES && String(raw).includes('EID="' + CAPTURE_EID + '"')) {
      captureLines++;
      console.log('[london365-gamedetails][capture ' + new Date().toISOString() + ']', String(raw));
      if (captureLines === CAPTURE_MAX_LINES) {
        console.log('[london365-gamedetails][capture] reached ' + CAPTURE_MAX_LINES + ' lines -- capture stopped. Remove LONDON365_GAMEDETAILS_CAPTURE_EID (or raise LONDON365_GAMEDETAILS_CAPTURE_MAX) and restart.');
      }
    }
    const eidMatch = /EID="([^"]*)"/.exec(String(raw));
    const key = eidMatch ? eidMatch[1] : String(raw); // fallback: never coalesce if EID missing
    pendingByEid.set(key, raw);
    drainPending();
  });

  // Diagnostic-only: socket.io v2 has no onAny(), so this reaches into the
  // underlying Engine.IO transport to log every raw packet regardless of
  // its event name — the only way to tell, from Render/Koyeb logs alone,
  // whether "gamedetails" is really the right event name/room for this
  // server, or whether the connection is silently receiving nothing (or
  // something under a different name) after connecting successfully.
  // Off by default; set LONDON365_GAMEDETAILS_DEBUG=1 temporarily to see it.
  if (process.env.LONDON365_GAMEDETAILS_DEBUG === '1') {
    let packetCount = 0;
    const logRawPacket = function (packet) {
      packetCount++;
      if (packetCount <= 20 || packetCount % 100 === 0) {
        console.log('[london365-gamedetails][debug] raw packet #' + packetCount + ':', JSON.stringify(packet).slice(0, 300));
      }
    };
    if (gameDetailsSocket.io && gameDetailsSocket.io.engine) {
      gameDetailsSocket.io.engine.on('packet', logRawPacket);
    }
  }

  console.log('[london365-gamedetails] starting live-detail socket feed for ' + GAMEDETAILS_SOCKET_URL);

  // Safety net: a match can also transition to LIVE purely via the REST
  // polling path (see server/london365.js's live loop) without ever firing
  // the odds socket's 'new-live-game' event above — this sweep catches
  // those too, deduped by subscribedGameIds so it's a no-op most of the time.
  setInterval(function () {
    // Nothing LIVE in memory => nothing to subscribe; skip the query so the
    // DB can idle (fail-open until the tracker has been loaded).
    if (!hasKnownLiveMatches()) return;
    pool.query("SELECT id FROM matches_cache WHERE id LIKE 'l365-%' AND status = 'LIVE'")
      .then(function (res) {
        for (const row of res.rows) subscribeGameDetails(row.id);
      })
      .catch(function () { /* next sweep will retry */ });
  }, 30000);
}

// Subscribes the gamedetails socket to one game's live-detail stream.
// CONFIRMED from a captured real client packet: 42["merranimim",{"gameid":
// "5115374"}] — this is a PER-GAME subscribe, not a room join (the earlier
// "connectToRoom"/"inplay" attempt was the wrong mechanism for this
// specific socket, even though that pattern is correct for the sibling
// odds socket above). Safe to call repeatedly for the same id (deduped)
// and safe to call before the socket has connected yet (queued via
// subscribedGameIds, flushed on 'connect').
export function subscribeGameDetails(gameId) {
  const id = String(gameId || '').replace(/^l365-/, '');
  if (!id || subscribedGameIds.has(id)) return;
  subscribedGameIds.add(id);
  if (gameDetailsSocket && gameDetailsSocket.connected) {
    gameDetailsSocket.emit('merranimim', { gameid: id });
  }
}

// MEMORY LEAK FIX: subscribeGameDetails only ever added to
// subscribedGameIds, with nothing anywhere removing an id once its match
// finished. Every match that had ever gone live stayed subscribed forever,
// and on every reconnect (see the 'connect' handler above) the ENTIRE
// history was re-emitted to the provider — a Set that only grows, replayed
// in full on every reconnect, for as long as the process stays up. Over
// days of uptime with hundreds of matches/day this is exactly the kind of
// unbounded growth that shows up as a slow heap climb ending in
// "JavaScript heap out of memory". Called from the two places a match is
// confirmed finished (see london365.js).
export function unsubscribeGameDetails(gameId) {
  const id = String(gameId || '').replace(/^l365-/, '');
  subscribedGameIds.delete(id);
}

// Read-only view of currently-subscribed (bare, no "l365-" prefix) game
// ids — used by reconcileGameDetailsSubscriptions() in london365.js to drop
// subscriptions orphaned by a purge*() that deleted a still-LIVE row
// without going through the normal "match confirmed finished" cleanup path.
export function getSubscribedGameDetailsIds() {
  return new Set(subscribedGameIds);
}

export function stopLondon365GameDetailsSocket() {
  if (!gameDetailsSocket) return;
  try { gameDetailsSocket.close(); } catch (err) { /* ignore */ }
  gameDetailsSocket = null;
}
export function getSocketMemoryDiagnostics() {
  return { subscribedGameIds: subscribedGameIds.size };
}
