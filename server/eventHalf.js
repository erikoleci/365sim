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
//      - match is LIVE and no HT was seen yet -> still the first half (1). The GAME clock is never
//        used to decide this: first-half stoppage time is unbounded (+6, +15, +20 happen), so
//        "clock <= 55'" filed such events under the second half. Only the half-time signal from
//        the provider (VC 1015 -> HT -> ht_home) ends the first half. Backstop for a missed HT
//        capture, on the WALL clock (not the game clock): more than FIRST_HALF_WALL_LIMIT_MIN
//        real minutes after the scheduled kickoff, a match with no HT seen is taken to be in the
//        second half (a first half with +20 stoppage still ends ~70 real minutes after kickoff).
// Penalties stay NULL (unknown).
import { FIRST_HALF_MAX_WALL_MIN } from './marketPeriods.js';
export const FIRST_HALF_WALL_LIMIT_MIN = FIRST_HALF_MAX_WALL_MIN;
export const halfSql = (p) => `(SELECT CASE
  WHEN UPPER(COALESCE(live_status, '')) IN ('ET', 'EXTRA_TIME') THEN 3
  WHEN UPPER(COALESCE(live_status, '')) IN ('2H', 'SECOND_HALF', 'FT', 'ENDED', 'FINISHED') THEN 2
  WHEN UPPER(COALESCE(live_status, '')) IN ('1H', 'HT', 'FIRST_HALF', 'HALF_TIME', 'HALFTIME') THEN 1
  WHEN rt_home IS NOT NULL THEN 3
  WHEN ht_home IS NOT NULL THEN 2
  WHEN status = 'LIVE' AND start_time::text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN 1
  WHEN status = 'LIVE'
       AND NOW() - start_time::text::timestamptz <= INTERVAL '${FIRST_HALF_WALL_LIMIT_MIN} minutes' THEN 1
  WHEN status = 'LIVE' THEN 2
  END FROM matches_cache WHERE id = ${p})`;
