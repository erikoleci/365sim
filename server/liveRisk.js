// Automatic detection of players who beat the live feed (satellite / stadium / faster stream).
//
// A live ticket is a "hit" when a goal or red card was recorded on one of its matches within
// HIT_WINDOW_MS AFTER the ticket was placed: the player bet just before our feed showed the event.
// By chance that is ~1-2% of live tickets, so a user with a high share of hits is flagged and
// gets a longer delay and a lower live stake (see riskPolicy()). The level is recomputed at most
// once per RECHECK_MS per user, when they place a live ticket.
const HIT_WINDOW_MS = Math.max(1000, Number(process.env.LIVE_RISK_HIT_WINDOW_MS ?? 20000));
const LOOKBACK_MS = Math.max(3600000, Number(process.env.LIVE_RISK_LOOKBACK_MS ?? 14 * 24 * 3600 * 1000));
const RECHECK_MS = 60000;
const MIN_LIVE_TICKETS = Number(process.env.LIVE_RISK_MIN_TICKETS ?? 5);
const WATCH = { hits: Number(process.env.LIVE_RISK_WATCH_HITS ?? 2), ratio: Number(process.env.LIVE_RISK_WATCH_RATIO ?? 0.12) };
const RESTRICTED = { hits: Number(process.env.LIVE_RISK_RESTRICTED_HITS ?? 3), ratio: Number(process.env.LIVE_RISK_RESTRICTED_RATIO ?? 0.2) };

export function classify(total, hits) {
  if (total < MIN_LIVE_TICKETS) return 'NORMAL';
  const ratio = hits / total;
  if (hits >= RESTRICTED.hits && ratio >= RESTRICTED.ratio) return 'RESTRICTED';
  if (hits >= WATCH.hits && ratio >= WATCH.ratio) return 'WATCH';
  return 'NORMAL';
}

// What each level changes. delayMs is a floor for the live delay, stakeFactor scales the live max stake.
export function riskPolicy(level, baseDelayMs) {
  if (level === 'RESTRICTED') return { delayMs: Math.max(baseDelayMs, 15000), stakeFactor: 0.25 };
  if (level === 'WATCH') return { delayMs: Math.max(baseDelayMs, 10000), stakeFactor: 0.5 };
  return { delayMs: baseDelayMs, stakeFactor: 1 };
}

export async function getLiveRisk(pool, userId, now = Date.now()) {
  const { rows: u } = await pool.query('SELECT live_risk, live_risk_hits, live_risk_checked_at FROM users WHERE id = $1', [userId]);
  const row = u[0];
  if (!row) return { level: 'NORMAL', hits: 0 };
  if (row.live_risk_checked_at != null && now - Number(row.live_risk_checked_at) < RECHECK_MS) {
    return { level: row.live_risk, hits: Number(row.live_risk_hits) };
  }
  const since = now - LOOKBACK_MS;
  const { rows: t } = await pool.query('SELECT COUNT(*)::int AS n FROM bets WHERE user_id = $1 AND is_live = true AND created_at > $2', [userId, since]);
  const { rows: h } = await pool.query(
    `SELECT COUNT(DISTINCT b.id)::int AS n
       FROM bets b
       JOIN bet_selections bs ON bs.bet_id = b.id
       JOIN match_events e ON e.match_id = bs.match_id
        AND e.type IN ('GOAL','RED_CARD')
        AND e.created_at BETWEEN b.created_at AND b.created_at + $3
      WHERE b.user_id = $1 AND b.is_live = true AND b.created_at > $2`,
    [userId, since, HIT_WINDOW_MS],
  );
  const level = classify(t[0].n, h[0].n);
  await pool.query('UPDATE users SET live_risk = $1, live_risk_hits = $2, live_risk_checked_at = $3 WHERE id = $4', [level, h[0].n, now, userId]);
  if (level !== row.live_risk) console.log(`[live-risk] user=${userId} ${row.live_risk} -> ${level} (hits=${h[0].n}/${t[0].n})`);
  return { level, hits: h[0].n };
}
