// Helps label NEW provider action codes (VC) without hand-comparing frames.
//
// When the feed switches to a VC code we cannot decode, we compare that frame with the previous frame
// of the same match and record which counters moved (score, corners, cards, H1-H8 / A1-A8). A code
// that always arrives with YC1 going up is very likely a yellow card, one that arrives with nothing
// moving (like 1025 = injury) is a "no counter" event, and so on. The result is logged once per sample
// and exposed at GET /api/admin/unmapped-vc. The hints are suggestions only: nothing is decided from
// them automatically, a human still confirms the label and adds it to server/liveAction.js.
const KEYS = [
  'SC', 'C1', 'C2', 'YC1', 'YC2', 'RC1', 'RC2',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8',
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8',
];
const MAX_MATCHES = 400; // previous-frame snapshots kept
const MAX_CODES = 60;
const MAX_SAMPLES = 8;
const LOG_FIRST = 3; // log only the first N transitions of each code

const snapshots = new Map(); // eid -> { vc, vals }
const codes = new Map(); // code -> { count, tally, samples }

export function __resetVcDeltaForTests() {
  snapshots.clear();
  codes.clear();
}

function snapshotOf(attrs) {
  const vals = {};
  for (const k of KEYS) vals[k] = String(attrs[k] ?? '').trim();
  return vals;
}

function hintFor(changed) {
  const keys = changed.map((c) => c.key);
  const has = (re) => keys.some((k) => re.test(k));
  if (has(/^SC$/)) return 'score changed (goal / correction?)';
  if (has(/^RC[12]$/)) return 'red card counter moved';
  if (has(/^YC[12]$/)) return 'yellow card counter moved';
  if (has(/^C[12]$/)) return 'corner counter moved';
  if (keys.length === 0) return 'no counter moved (event without a counter, e.g. injury / VAR / stoppage)';
  return 'only H/A attack counters moved (probably normal play)';
}

// Call on EVERY gamedetails frame (cheap). `mapped` = the VC was decoded by liveAction.js.
export function observeVcFrame(eid, attrs, mapped, meta = {}) {
  const vc = String(attrs.VC ?? '').trim();
  const vals = snapshotOf(attrs);
  const prev = snapshots.get(eid);
  if (!prev && snapshots.size >= MAX_MATCHES) snapshots.clear();
  snapshots.set(eid, { vc, vals });
  if (!prev || !vc || mapped || vc === prev.vc) return null; // only the first frame of a new unmapped code

  const changed = [];
  for (const k of KEYS) {
    if (prev.vals[k] !== vals[k] && !(prev.vals[k] === '' && vals[k] === '')) {
      changed.push({ key: k, from: prev.vals[k] || '-', to: vals[k] || '-' });
    }
  }
  let rec = codes.get(vc);
  if (!rec) {
    if (codes.size >= MAX_CODES) return null;
    rec = { count: 0, tally: {}, samples: [] };
    codes.set(vc, rec);
  }
  rec.count += 1;
  if (changed.length === 0) rec.tally['(none)'] = (rec.tally['(none)'] || 0) + 1;
  for (const c of changed) rec.tally[c.key] = (rec.tally[c.key] || 0) + 1;
  const sample = {
    at: new Date().toISOString(),
    match: meta.match || null,
    t: attrs.T ?? null,
    score: attrs.SC ?? null,
    prevVc: prev.vc || null,
    changed,
    hint: hintFor(changed),
  };
  if (rec.samples.length < MAX_SAMPLES) rec.samples.push(sample);
  if (rec.count <= LOG_FIRST) {
    const delta = changed.length ? changed.map((c) => `${c.key} ${c.from}->${c.to}`).join(', ') : 'no counter moved';
    console.log(`[vc-delta] VC "${vc}" (${meta.match || eid}, T=${attrs.T}, SC=${attrs.SC || '?'}): ${delta} -- hint: ${sample.hint}`);
  }
  return sample;
}

export function getUnmappedVcReport() {
  return [...codes.entries()].map(([code, r]) => ({
    code,
    count: r.count,
    // How often each counter moved together with this code; compare against `count`.
    tally: r.tally,
    samples: r.samples,
  }));
}
