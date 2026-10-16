// Small runtime state shared between the live sync, the socket handlers and the status report.

export let socketConnected = false;
export function setLondon365SocketConnected(value) {
  socketConnected = !!value;
}
// Per-match count of consecutive live-sync cycles (~LIVE_INTERVAL_MS apart, default 30s) in which
// the provider's live list did NOT include a match we still have marked LIVE. Confirming across 2+
// independent passes (instead of a single miss) keeps a one-off gap in the feed from being mistaken
// for the match ending; a genuinely finished match is corrected within ~30-60s after a restart
// instead of waiting for the much longer time-based fallbacks.
export const missedLiveCycles = new Map();
/** When the last live sync cycle completed (ms since epoch, 0 = never). */
export let lastLiveSyncAt = 0;
export function noteLiveSyncCompleted(at = Date.now()) { lastLiveSyncAt = at; }
