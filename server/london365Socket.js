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

import {
  isLondon365Enabled,
  setLondon365SocketConnected,
  applySocketCoefs,
  applySocketGame,
  markLondon365GameEnded,
  removeSocketCoef,
} from './london365.js';

const SOCKET_URL = process.env.LONDON365_SOCKET || 'https://ecco.socketi355.com:1440';
const SOCKET_ENABLED = (process.env.LONDON365_SOCKET_ENABLED || '1') === '1';

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