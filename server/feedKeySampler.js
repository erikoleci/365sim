// Evidence collector for the provider's raw fields.
//
// We only use the fields we have verified against real captures, and the repo has no
// documentation of the rest. Questions like "does the feed carry the name of the player
// who scored?" or "is there a team logo URL?" can only be answered by looking at what the
// provider really sends. This remembers, per source, every distinct scalar field name seen
// and a few sample values (bounded), logs each NEW field once, and exposes the table at
// GET /api/admin/feed-keys so it can be read (or pasted) while real matches are live.
// Values are truncated; nothing here is used for any decision.

const seen = new Map(); // "source:key" -> { source, key, count, samples[] }
const MAX_KEYS = 400;
const MAX_SAMPLES = 4;
const SAMPLE_LEN = 60;

export function sampleFeedKeys(source, obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v !== null && typeof v === 'object') continue; // nested: sampled by its own call
    const id = source + ':' + key;
    let e = seen.get(id);
    if (!e) {
      if (seen.size >= MAX_KEYS) continue;
      e = { source, key, count: 0, samples: [] };
      seen.set(id, e);
      console.log('[feed-keys] new ' + source + ' field "' + key + '" e.g. "' + String(v).slice(0, 40) + '"');
    }
    e.count++;
    if (e.samples.length < MAX_SAMPLES) {
      const s = String(v).slice(0, SAMPLE_LEN);
      if (!e.samples.includes(s)) e.samples.push(s);
    }
  }
}

export function getFeedKeySamples() {
  return Array.from(seen.values()).sort((a, b) => a.source.localeCompare(b.source) || a.key.localeCompare(b.key));
}

export function __resetFeedKeysForTests() {
  seen.clear();
}
