// Every VC (live action) code the provider sends, with how often and one example frame, so codes we
// have no label for (e.g. a penalty) can be found by looking at GET /api/admin/vc-codes while matches
// are live, instead of waiting for one specific match. Side digit stripped: 11010 and 21010 are the
// same action ("?010"). In memory only: resets on restart.
const MAX_CODES = 300;
const seen = new Map();

export function recordVcSample(vc, label, ctx) {
  const s = String(vc ?? '').trim();
  if (!/^\d{4,5}$/.test(s)) return;
  const code = s.length === 5 ? s.slice(1) : s;
  let e = seen.get(code);
  if (!e) {
    if (seen.size >= MAX_CODES) return;
    e = { code, label: label || null, count: 0, home: 0, away: 0, firstSeen: new Date().toISOString(), example: null };
    seen.set(code, e);
  }
  e.count += 1;
  if (s.length === 5) { if (s[0] === '1') e.home += 1; else if (s[0] === '2') e.away += 1; }
  if (label && !e.label) e.label = label;
  e.lastSeen = new Date().toISOString();
  // keep the example that carries the most context (a score / clock), replace once
  if (!e.example || (e.example.score == null && ctx && ctx.score != null)) {
    e.example = { vc: s, match: ctx && ctx.match, score: ctx && ctx.score, t: ctx && ctx.t, goalNext: false };
  }
}

export function getVcSamples() {
  const all = [...seen.values()].sort((a, b) => a.count - b.count);
  return { unlabelled: all.filter((x) => !x.label), labelled: all.filter((x) => x.label) };
}

// Per-match history of VC CHANGES: the sample above keeps one example per code, so a rare code (a penalty) is
// seen without the time it came. Here every change of VC of a match is kept with score and clock, newest last, so a
// penalty can be looked up by team name afterwards. Memory only, bounded: 150 changes per match, 400 matches.
const HIST_PER_MATCH = 150;
const HIST_MATCHES = 400;
const history = new Map(); // matchId -> { match, last, list: [{ at, vc, label, score, t }] }

export function recordVcChange(matchId, vc, ctx) {
  const s = String(vc ?? '').trim();
  if (!matchId || !/^\d{4,5}$/.test(s)) return;
  let h = history.get(matchId);
  if (!h) {
    if (history.size >= HIST_MATCHES) history.delete(history.keys().next().value);
    h = { match: (ctx && ctx.match) || String(matchId), last: null, list: [] };
    history.set(matchId, h);
  }
  if (h.last === s) return;
  h.last = s;
  if (ctx && ctx.match) h.match = ctx.match;
  h.list.push({ at: Date.now(), vc: s, label: (ctx && ctx.label) || null, score: ctx && ctx.score != null ? String(ctx.score) : null, t: ctx && ctx.t != null ? String(ctx.t) : null });
  if (h.list.length > HIST_PER_MATCH) h.list.shift();
}

export function getVcHistory(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const [id, h] of history) {
    if (!h.match.toLowerCase().includes(q)) continue;
    out.push({ id, match: h.match, changes: h.list.slice().reverse() });
    if (out.length >= 6) break;
  }
  return out;
}

export function __resetVcSamplesForTests() { seen.clear(); history.clear(); }
