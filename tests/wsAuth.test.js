import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

// Regression test: a socket must not be able to subscribe to another
// user's private `user:<id>` topic (bet settlements, balance changes)
// without first authenticating as that exact user. Public topics
// (match:<id>, odds, live) are intentionally open to any connection since
// they only ever carry public match/odds data -- this test only locks down
// the private-topic guard in server/ws.js.

const mocks = vi.hoisted(function () {
  // Minimal fake EventEmitter: enough for `wss.on(event, cb)` /
  // `wss.emit(event, ...)`, since ws.js registers TWO 'connection'
  // listeners and both must fire, like a real EventEmitter.
  function makeEmitter() {
    const listeners = new Map();
    return {
      on(event, cb) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(cb);
      },
      emit(event, ...args) {
        for (const cb of listeners.get(event) || []) cb(...args);
      },
      clients: new Set(),
    };
  }
  let lastServer = null;
  function WebSocketServer() {
    lastServer = makeEmitter();
    return lastServer;
  }
  return { WebSocketServer, getLastServer: () => lastServer };
});

vi.mock('ws', () => ({ WebSocketServer: mocks.WebSocketServer }));

const { initWebSocket } = await import('../server/ws.js');
const { JWT_SECRET } = await import('../server/routes/auth.js');

function sign(id) {
  return jwt.sign({ id, username: id, role: 'USER' }, JWT_SECRET, { expiresIn: '7d' });
}

// Fake socket: enough surface for ws.js's connection handler (on/send/
// readyState/OPEN), driven manually via `receive(msg)`.
function makeFakeSocket() {
  const listeners = new Map();
  const socket = {
    OPEN: 1,
    readyState: 1,
    sent: [],
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(cb);
    },
    send(msg) { socket.sent.push(JSON.parse(msg)); },
    receive(msg) {
      for (const cb of listeners.get('message') || []) cb(Buffer.from(JSON.stringify(msg)));
    },
  };
  return socket;
}

describe('WebSocket - private topic authorization', () => {
  let wss;
  beforeEach(() => {
    wss = initWebSocket({ on: vi.fn() }); // fake httpServer, unused by the mock
  });

  it('rejects subscribing to another user\'s private topic without authenticating as them', () => {
    const socket = makeFakeSocket();
    wss.emit('connection', socket);

    // Authenticate as user-a, then try to subscribe to user-b's topic.
    socket.receive({ type: 'auth', token: sign('user-a') });
    socket.receive({ type: 'subscribe', topic: 'user:user-b' });

    expect(socket.topics.has('user:user-b')).toBe(false);
  });

  it('allows subscribing to your own private topic after authenticating', () => {
    const socket = makeFakeSocket();
    wss.emit('connection', socket);

    socket.receive({ type: 'auth', token: sign('user-a') });
    socket.receive({ type: 'subscribe', topic: 'user:user-a' });

    expect(socket.topics.has('user:user-a')).toBe(true);
  });

  it('rejects subscribing to a private topic with no auth at all', () => {
    const socket = makeFakeSocket();
    wss.emit('connection', socket);

    socket.receive({ type: 'subscribe', topic: 'user:user-a' });

    expect(socket.topics.has('user:user-a')).toBe(false);
  });

  it('still allows public topics (match/odds/live) without authentication', () => {
    const socket = makeFakeSocket();
    wss.emit('connection', socket);

    socket.receive({ type: 'subscribe', topic: 'match:123' });
    socket.receive({ type: 'subscribe', topic: 'odds' });
    socket.receive({ type: 'subscribe', topic: 'live' });

    expect(socket.topics.has('match:123')).toBe(true);
    expect(socket.topics.has('odds')).toBe(true);
    expect(socket.topics.has('live')).toBe(true);
  });
});
