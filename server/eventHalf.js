// SQL expression giving the half the match is in RIGHT NOW (1 | 2 | NULL), read from the cached
// live status. `p` is the placeholder of the match id, e.g. '$1'. Events during the break (HT)
// count as first half; full time / ended count as second half; extra time is 3 (its two halves are
// not told apart); penalties stay NULL (unknown).
export const halfSql = (p) => `(SELECT CASE
  WHEN UPPER(COALESCE(live_status, '')) IN ('ET', 'EXTRA_TIME') THEN 3
  WHEN UPPER(COALESCE(live_status, '')) IN ('2H', 'SECOND_HALF', 'FT', 'ENDED', 'FINISHED') THEN 2
  WHEN UPPER(COALESCE(live_status, '')) IN ('1H', 'HT', 'FIRST_HALF', 'HALF_TIME', 'HALFTIME') THEN 1
  END FROM matches_cache WHERE id = ${p})`;
