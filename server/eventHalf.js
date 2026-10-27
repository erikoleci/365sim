// SQL expression giving the half the match is in RIGHT NOW (1 | 2 | 3 | NULL). `p` is the
// placeholder of the match id, e.g. '$1'.
//
// 1) The cached live status, when it is one we know: events during the break (HT) count as first
//    half; full time / ended count as second half; extra time is 3 (its two halves are not told
//    apart).
// 2) The provider's REST sync overwrites live_status with its own NUMERIC api_status (e.g. "3"),
//    whose meaning is undocumented. Then the status says nothing, and the old code returned NULL,
//    so the client fell back to "minute > 45 = second half": a corner/card/goal in first-half
//    stoppage time (clock 46'-51') was filed under the second half. So when the status is not
//    readable we use what we KNOW about the match:
//      - the 90-minute score was captured (rt_home)   -> extra time (3)
//      - the half-time score was captured (ht_home)   -> second half (2)
//      - match is LIVE, no HT seen yet, clock <= 55'  -> still the first half (1): first-half
//        stoppage time. (If the HT capture was ever missed, a 46'-55' second-half event would be
//        filed as 45+N; that is the rare case we accept, it was the common case before.)
// Penalties stay NULL (unknown).
export const halfSql = (p) => `(SELECT CASE
  WHEN UPPER(COALESCE(live_status, '')) IN ('ET', 'EXTRA_TIME') THEN 3
  WHEN UPPER(COALESCE(live_status, '')) IN ('2H', 'SECOND_HALF', 'FT', 'ENDED', 'FINISHED') THEN 2
  WHEN UPPER(COALESCE(live_status, '')) IN ('1H', 'HT', 'FIRST_HALF', 'HALF_TIME', 'HALFTIME') THEN 1
  WHEN rt_home IS NOT NULL THEN 3
  WHEN ht_home IS NOT NULL THEN 2
  WHEN status = 'LIVE'
       AND COALESCE(substring(COALESCE(live_minute, '') from '^[0-9]+')::int, 999) <= 55 THEN 1
  END FROM matches_cache WHERE id = ${p})`;
