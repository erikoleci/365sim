// Express 4.x does NOT automatically forward a rejected Promise from an
// `async (req, res) => {...}` route handler to the app's error-handling
// middleware — that only became automatic in Express 5. Until every route
// in this app is wrapped with this, a thrown/rejected error inside an async
// handler becomes a silent Node `unhandledRejection` and the HTTP request
// is simply never responded to: the client sees the connection hang until
// the platform's own proxy (Render, in front of this app) gives up and
// returns a 502 — even though server.js already has a perfectly good
// `app.use((err, req, res, next) => ...)` handler sitting right there,
// unreachable, because nothing ever calls next(err).
//
// wrap(fn) returns a handler Express can use directly: on success it
// behaves identically to fn; on rejection/throw it calls next(err), which
// routes into that existing error middleware and returns a clean 503
// instead of hanging the request indefinitely.
export function wrap(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
