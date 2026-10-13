// Real-time push layer (Notifications spec: "WebSocket ose SSE").
//
// Design: a single broadcast hub, topic-based (`match:<id>`, `odds`,
// `notifications:<userId>`), so the frontend subscribes only to what's on
// screen instead of every client polling every match on an interval. This
// does NOT replace the existing HTTP refresh endpoints (matches.js keeps
// working as a fallback/initial load) — it removes the NEED for the
// frontend to keep re-polling once connected.
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './routes/auth.js';

let wss = null;
// topic -> Set<ws>
const subscribers = new Map();

export function initWebSocket(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (socket) => {
    socket.topics = new Set();
    socket.userId = null; // set only after a valid 'auth' message

    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'auth' && typeof msg.token === 'string') {
        try {
          socket.userId = jwt.verify(msg.token, JWT_SECRET).id;
        } catch {
          socket.userId = null; // invalid/expired token — leave unauthenticated
        }
        return;
      }

      if (msg.type === 'subscribe' && typeof msg.topic === 'string') {
        // Private per-user topics require the socket to have authenticated
        // as that same user first — otherwise anyone could subscribe to
        // another user's notifications (bet settlements, balance changes).
        if (msg.topic.startsWith('user:') && msg.topic !== `user:${socket.userId}`) return;
        socket.topics.add(msg.topic);
        if (!subscribers.has(msg.topic)) subscribers.set(msg.topic, new Set());
        subscribers.get(msg.topic).add(socket);
      }
      if (msg.type === 'unsubscribe' && typeof msg.topic === 'string') {
        socket.topics.delete(msg.topic);
        const set = subscribers.get(msg.topic);
        set?.delete(socket);
        // MEMORY LEAK FIX: the Map entry itself was never removed once its
        // Set emptied out — same unbounded-growth pattern found in the
        // london365 live feed (see london365Socket.js/london365GameDetails.js).
        // Per-match topics (`match:<id>`) accumulate one permanent empty-Set
        // entry for every match ANY client has ever viewed, for the life of
        // the process.
        if (set && set.size === 0) subscribers.delete(msg.topic);
      }
    });

    socket.on('close', () => {
      for (const topic of socket.topics) {
        const set = subscribers.get(topic);
        set?.delete(socket);
        if (set && set.size === 0) subscribers.delete(topic);
      }
    });
  });

  // Heartbeat so dead connections (phone lock, network drop) get cleaned
  // up instead of silently accumulating in `subscribers`.
  setInterval(() => {
    wss.clients.forEach((socket) => {
      if (socket.isAlive === false) return socket.terminate();
      socket.isAlive = false;
      socket.ping();
    });
  }, 30000).unref?.();
  wss.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
  });

  return wss;
}

// A client that cannot keep up (phone on a bad network) would otherwise make the
// server queue unlimited data for it. Droppable frames (live ticks, which are
// superseded by the next one anyway) are skipped for a socket whose outgoing buffer
// is already this large; critical frames (goals, settlements) are always sent.
const MAX_SOCKET_BUFFER_BYTES = 1024 * 1024;

export function broadcast(topic, payload, { droppable = false } = {}) {
  const set = subscribers.get(topic);
  if (!set || set.size === 0) return;
  const msg = JSON.stringify({ topic, ...payload });
  for (const socket of set) {
    if (socket.readyState !== socket.OPEN) continue;
    if (droppable && socket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) continue;
    socket.send(msg);
  }
}

// Match ids (bare, no "l365-" prefix) that at least one client currently has open
// (subscribed to `match:<id>`). The live loop refreshes these first.
export function getWatchedMatchIds() {
  const ids = [];
  for (const topic of subscribers.keys()) {
    if (topic.startsWith('match:')) ids.push(topic.slice(6).replace(/^l365-/, ''));
  }
  return ids;
}

// Test-only: attach a fake socket to a topic.
export function __subscribeForTests(topic, socket) {
  if (!subscribers.has(topic)) subscribers.set(topic, new Set());
  subscribers.get(topic).add(socket);
}
export function __resetWsForTests() {
  subscribers.clear();
  tickQueue.clear();
  if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
}

// Convenience helpers matching the notification types from the spec.
// Besides the per-match topic, every live event is also broadcast on the
// global 'odds' / 'live' topics — the frontend subscribes to those two on
// connect, which is what makes odds arrows and live score updates reach
// clients without a manual refresh.
export const pushGoal = (matchId, data) => {
  broadcast(`match:${matchId}`, { type: 'GOAL', ...data });
  broadcast('live', { matchId, type: 'GOAL', ...data });
};
// Fired when a provider score UPDATE actually means a goal was retracted
// (VAR overturn / ref correction) rather than a new goal — the score for a
// team went DOWN. Carries the corrected (lower) score so the frontend can
// apply it the same way as a GOAL, but callers can distinguish the two to
// show "gol i anuluar" instead of a goal celebration.
export const pushGoalDisallowed = (matchId, data) => {
  broadcast(`match:${matchId}`, { type: 'GOAL_DISALLOWED', ...data });
  broadcast('live', { matchId, type: 'GOAL_DISALLOWED', ...data });
};
export const pushOddsChanged = (matchId, data) => {
  broadcast(`match:${matchId}`, { type: 'ODDS_CHANGED', ...data });
  broadcast('odds', { matchId, type: 'ODDS_CHANGED', ...data });
};
// Fired the moment a match is confirmed finished (either the live-feed
// end-detection sweep in syncLondon365Live, or a provider 'game ended'
// event) — WITHOUT this, a finished match kept sitting in the frontend's
// live list until the next slow REST poll (up to 5 minutes, widened for
// bandwidth — see App.tsx) caught up, which is exactly the "kan mbaruar
// varja por akoma shfaqet live" symptom. Carries the final score so the
// frontend can show it immediately without a round-trip.
export const pushMatchEnded = (matchId, data) => {
  broadcast(`match:${matchId}`, { type: 'MATCH_ENDED', ...data });
  broadcast('live', { matchId, type: 'MATCH_ENDED', ...data });
};
// Card events from the dedicated live-match-detail feed (see
// london365GameDetails.js). Same shape/topics as pushGoal so the frontend
// can react the same way once it subscribes to match:<id>.
export const pushCardEvent = (matchId, data) => {
  broadcast(`match:${matchId}`, { type: 'CARD', ...data });
  broadcast('live', { matchId, type: 'CARD', ...data });
};
// Fired on EVERY processed update from the fast (~1/sec) gamedetails
// socket — not just when the score changes — so a connected client's
// minute/score stay resynced against the verified source (matches_cache)
// at the feed's real cadence instead of only on a goal or the slow 60s
// poll. Payload only ever carries values already confirmed elsewhere
// (matches_cache.live_minute, live_home_score/away_score) — this never
// invents a minute from the unverified T/H1-H8 fields.
// Ticks for the global 'live' topic are COALESCED: with hundreds or thousands of
// live matches ticking, one message per tick per client is a flood. Instead the
// newest tick per match is queued and sent as ONE batched frame every
// TICK_FLUSH_MS (LIVE_TICKS). Only the per-match topic (a client viewing that
// match) still gets each tick immediately.
const TICK_FLUSH_MS = 250;
const TICKS_PER_FRAME = 200;
const tickQueue = new Map(); // matchId -> newest tick payload
let tickTimer = null;

export const pushLiveTick = (matchId, data) => {
  broadcast(`match:${matchId}`, { type: 'LIVE_TICK', ...data }, { droppable: true });
  tickQueue.set(matchId, { matchId, ...data });
  if (!tickTimer) {
    tickTimer = setTimeout(flushLiveTicks, TICK_FLUSH_MS);
    tickTimer.unref?.();
  }
};

export function flushLiveTicks() {
  tickTimer = null;
  if (tickQueue.size === 0) return 0;
  const ticks = Array.from(tickQueue.values());
  tickQueue.clear();
  for (let i = 0; i < ticks.length; i += TICKS_PER_FRAME) {
    broadcast('live', { type: 'LIVE_TICKS', ticks: ticks.slice(i, i + TICKS_PER_FRAME) }, { droppable: true });
  }
  return ticks.length;
}
