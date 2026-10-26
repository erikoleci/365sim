// Small in-memory ring buffer of the last unhandled route errors, so the real cause behind the generic
// "503 Service temporarily unavailable" can be read from GET /api/admin/recent-errors (admin login)
// without opening the hosting provider's log viewer. Messages are truncated; nothing is persisted.
const MAX = 30;
const items = [];

export function recordRouteError(err, req) {
  items.unshift({
    at: new Date().toISOString(),
    method: req && req.method,
    url: req && req.originalUrl ? String(req.originalUrl).slice(0, 120) : null,
    code: (err && err.code) || null,
    name: (err && err.name) || null,
    message: String((err && err.message) || err).slice(0, 300),
    where: err && err.stack ? String(err.stack).split('\n').slice(1, 3).map((l) => l.trim().slice(0, 140)) : [],
  });
  if (items.length > MAX) items.length = MAX;
}

export function getRecentErrors() {
  return items.slice();
}

export function __resetRecentErrorsForTests() {
  items.length = 0;
}
