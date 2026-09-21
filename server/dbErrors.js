// Maps a thrown database error to an HTTP status + message for the catch-all
// error handler. Everything used to become "503 Service temporarily
// unavailable", including plain data errors (e.g. a foreign-key violation when
// deleting a user that still has bets), which made real, fixable problems look
// like an outage.
export function mapDbError(err) {
  const code = err && err.code;
  if (code === '23503') {
    return { status: 409, body: { error: 'Ky rekord eshte i lidhur me te dhena te tjera (kupona, transaksione...) dhe nuk mund te fshihet.', code: 'FOREIGN_KEY_VIOLATION' } };
  }
  if (code === '23505') {
    return { status: 409, body: { error: 'Ekziston tashme nje rekord me kete vlere.', code: 'DUPLICATE' } };
  }
  return { status: 503, body: { error: 'Service temporarily unavailable. Please try again shortly.' } };
}
