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
        subscribers.get(msg.topic)?.delete(socket);
      }
    });

    socket.on('close', () => {
      for (const topic of socket.topics) subscribers.get(topic)?.delete(socket);
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

export function broadcast(topic, payload) {
  const set = subscribers.get(topic);
  if (!set || set.size === 0) return;
  const msg = JSON.stringify({ topic, ...payload });
  for (const socket of set) {
    if (socket.readyState === socket.OPEN) socket.send(msg);
  }
}

// Convenience helpers matching the notification types from the spec.
export const pushGoal = (matchId, data) => { broadcast(`match:${matchId}`, { type: 'GOAL', ...data }); broadcast('live', { type: 'GOAL', matchId, ...data }); };
export const pushOddsChanged = (matchId, data) => { broadcast(`match:${matchId}`, { type: 'ODDS_CHANGED', ...data }); broadcast('odds', { type: 'ODDS_CHANGED', matchId, ...data }); };
export const pushMatchStarted = (matchId) => { broadcast(`match:${matchId}`, { type: 'MATCH_STARTED' }); broadcast('live', { type: 'MATCH_STARTED', matchId }); };
export const pushLiveEvent = (matchId, data) => { broadcast(`match:${matchId}`, { type: 'LIVE_EVENT', ...data }); broadcast('live', { type: 'LIVE_EVENT', matchId, ...data }); };
export const pushUserNotification = (userId, data) => broadcast(`user:${userId}`, { type: 'NOTIFICATION', ...data });
