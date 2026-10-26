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

export function __resetVcSamplesForTests() { seen.clear(); }
