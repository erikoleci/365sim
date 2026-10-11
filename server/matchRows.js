// Row selection for GET /api/matches (the list the frontend ALWAYS uses: no ?league=).
//
// The list is capped (pages of 200 rows, MATCHES_PAGE_HARD_CAP pages) to protect memory. The old
// query ordered the whole window [now-2 days, now+21 days] by start time ASCENDING, so the cap
// cut from the FAR END -- but with a wide catalogue (LONDON365_ONLY_COUNTRIES=*, MAJOR_ONLY=0)
// the finished matches of the last two days alone can fill the cap, and TODAY'S LIVE matches
// (e.g. Chelsea-Bournemouth) fell off the end while `?league=` (no cap) still returned them.
//
// Now the window is read in priority order, so the cap only ever trims what matters least:
//   1. live / just-finished / today  : [now-8h,  now+48h)
//   2. further upcoming              : [now+48h, now+21d)
//   3. older finished                : [now-2d,  now-8h)
// `pagesPerSegmentRound` rows are fetched in parallel, like before.
export const PAGE_SIZE = 200;
export const CONCURRENT_PAGES = 3;
const H = 60 * 60 * 1000;

export function prioritySegments(nowMs) {
  const iso = (ms) => new Date(ms).toISOString();
  return [
    { name: 'live+today', lo: iso(nowMs - 8 * H), hi: iso(nowMs + 48 * H) },
    { name: 'upcoming', lo: iso(nowMs + 48 * H), hi: iso(nowMs + 21 * 24 * H) },
    { name: 'older', lo: iso(nowMs - 48 * H), hi: iso(nowMs - 8 * H) },
  ];
}

// `query(sql, params, opts)` is queryWithRetry; `columns` is the SELECT column list.
export async function fetchMatchRowsPrioritized(query, columns, maxPages, nowMs = Date.now(), log = () => {}) {
  const rows = [];
  const seen = new Set();
  const maxRows = Math.max(1, maxPages) * PAGE_SIZE; // the cap protects memory, so it counts REAL rows
  let truncated = false;
  const sql = `SELECT ${columns}
       FROM matches_cache
       WHERE id LIKE 'l365-%'
         AND start_time_tz(start_time) >= $1::timestamptz
         AND start_time_tz(start_time) < $2::timestamptz
       ORDER BY start_time ASC, id ASC
       LIMIT $3 OFFSET $4`;
  for (const seg of prioritySegments(nowMs)) {
    let page = 0;
    let segmentDone = false;
    while (!segmentDone) {
      if (rows.length >= maxRows) { truncated = true; log(seg.name); break; }
      const n = Math.min(CONCURRENT_PAGES, Math.ceil((maxRows - rows.length) / PAGE_SIZE));
      const idx = Array.from({ length: n }, (_, i) => page + i);
      const results = await Promise.all(idx.map((p) => query(sql, [seg.lo, seg.hi, PAGE_SIZE, p * PAGE_SIZE], { attemptTimeoutMs: 8000 })));
      page += n;
      for (const { rows: r } of results) {
        for (const row of r) if (!seen.has(row.id)) { seen.add(row.id); rows.push(row); }
        if (r.length < PAGE_SIZE) segmentDone = true;
      }
    }
  }
  return { rows, truncated };
}
