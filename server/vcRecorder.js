// Finds the provider's penalty code by itself. Every time the feed switches to an action code we cannot decode, the
// transition is noted (a few per match, not per frame) and written to vc_unmapped_seen. Flashscore logs every penalty
// as a PENALTY row in match_events; the codes that keep showing up in the minutes BEFORE those rows are the penalty
// candidates (GET /api/admin/vc-penalty-candidates). Nothing is decided from it: a human confirms and adds the code to liveAction.js.
const buf = [];
const BUF_CAP = 500;

export function recordUnmappedVc({ matchId, match, code }, now = Date.now()) {
  const c = String(code ?? '').trim();
  if (!c || !matchId || buf.length >= BUF_CAP) return;
  buf.push({ matchId: String(matchId), match: match ? String(match).slice(0, 120) : null, code: c.slice(0, 16), at: now });
}

export async function flushVcRecorder(pool) {
  if (!buf.length) return 0;
  const rows = buf.splice(0);
  try {
    await pool.query(
      `INSERT INTO vc_unmapped_seen (match_id, match_name, code, at)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::bigint[])`,
      [rows.map((r) => r.matchId), rows.map((r) => r.match), rows.map((r) => r.code), rows.map((r) => r.at)]
    );
    await pool.query('DELETE FROM vc_unmapped_seen WHERE at < $1', [Date.now() - 45 * 86400000]);
    return rows.length;
  } catch (e) {
    console.warn('[vc-recorder] flush failed: ' + (e && e.message));
    return 0;
  }
}

// Pure ranking: seen = [{match_id, code, at}], penalties = [{match_id, at}]. A code "hits" a penalty when it was seen in
// the same match within windowMs before the penalty row. Ranked by hits, then by how rarely the code appears otherwise.
export function rankPenaltyCandidates(seen, penalties, windowMs = 240000) {
  const byCode = new Map();
  for (const s of seen) {
    const r = byCode.get(s.code) || { code: s.code, seen: 0, hits: 0, matches: new Set() };
    r.seen += 1; r.matches.add(s.match_id);
    byCode.set(s.code, r);
  }
  const hitKey = new Set();
  for (const p of penalties) {
    for (const s of seen) {
      if (s.match_id !== p.match_id) continue;
      const d = Number(p.at) - Number(s.at);
      if (d >= -30000 && d <= windowMs) hitKey.add(s.code + '|' + p.match_id + '|' + p.at);
    }
  }
  for (const k of hitKey) { const r = byCode.get(k.split('|')[0]); if (r) r.hits += 1; }
  return [...byCode.values()]
    .map((r) => ({ code: r.code, seen: r.seen, matches: r.matches.size, penaltiesAfter: r.hits, shareOfSeen: r.seen ? Math.round((r.hits / r.seen) * 100) / 100 : 0 }))
    .sort((a, b) => b.penaltiesAfter - a.penaltiesAfter || b.shareOfSeen - a.shareOfSeen);
}

export async function penaltyCandidates(pool, windowMs = 240000) {
  const since = Date.now() - 45 * 86400000;
  const [{ rows: seen }, { rows: pens }] = await Promise.all([
    pool.query('SELECT match_id, code, at FROM vc_unmapped_seen WHERE at > $1', [since]),
    pool.query(`SELECT match_id, created_at AS at FROM match_events WHERE type = 'PENALTY' AND created_at > $1`, [since]),
  ]);
  const norm = (r) => ({ ...r, at: Number(r.at) });
  return { penaltyRows: pens.length, seenRows: seen.length, candidates: rankPenaltyCandidates(seen.map(norm), pens.map(norm), windowMs).slice(0, 15) };
}
