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
} from './london365.js';
import { applyGameDetails } from './london365GameDetails.js';

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
    applySocketGame(d, 'LIVE').catch(function (err) {
      console.error('[london365-socket] new-live-game failed:', err.message);
    });
    // Also start streaming this game's live detail (score/cards/etc) the
    // moment it goes live — no need to wait for the next backfill sweep.
    subscribeGameDetails(d.id);
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
  gameDetailsSocket.on('gamedetails', function (raw) {
    gameDetailsCount++;
    if (gameDetailsCount <= 3 || gameDetailsCount % 200 === 0) {
      console.log('[london365-gamedetails] received #' + gameDetailsCount + ':', String(raw).slice(0, 200));
    }
    applyGameDetails(raw).catch(function (err) {
      console.error('[london365-gamedetails] apply failed:', err.message);
    });
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

export function stopLondon365GameDetailsSocket() {
  if (!gameDetailsSocket) return;
  try { gameDetailsSocket.close(); } catch (err) { /* ignore */ }
  gameDetailsSocket = null;
}