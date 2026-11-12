// Correct the FINAL SCORE of a match that was closed with a wrong one (e.g. closed at 85' on a stale live score) and re-decide the tickets
// that were settled on it. Two steps: a DRY RUN that only reports, and an APPLY that is refused when anything is doubtful.
//  - a leg is re-decided only when the rules reproduce its CURRENT status at the old score (so the rule is trustworthy for that leg) and
//    need nothing but the score; every other leg is reported as "manual" and left untouched;
//  - a ticket that would go from WON to not-WON is never applied (there is no claw-back path): it is reported and blocks the apply;
//  - tickets that turn WON are paid through the normal path (recomputeBetStatus: ledger credit + admin charge).
import { pool } from './db.js';
import { determineLegOutcome, recomputeBetStatus } from './matchSettlement.js';
import { ticketOutcome } from './ticketOutcome.js';

const ctxFor = (home, away, match) => ({
  winner: home > away ? 'HOME' : away > home ? 'AWAY' : 'DRAW', totalGoals: home + away, bothScored: home > 0 && away > 0, homeScore: home, awayScore: away,
  htHome: match.ht_home != null ? Number(match.ht_home) : undefined, htAway: match.ht_away != null ? Number(match.ht_away) : undefined,
});
const safe = (leg, ctx) => { try { return determineLegOutcome(leg, ctx) || null; } catch { return null; } };

// Pure: plan from the rows. legs: bet_selections of the match; bets: Map(betId -> { stake, status, legs: all legs of that bet }).
export function planCorrection(match, newHome, newAway, legs, bets) {
  const oldCtx = ctxFor(Number(match.result_home), Number(match.result_away), match);
  const newCtx = ctxFor(newHome, newAway, match);
  const rows = []; const flips = new Map();
  for (const leg of legs) {
    const atOld = safe(leg, oldCtx); const atNew = safe(leg, newCtx);
    let action = 'keep';
    if (atNew == null || atOld !== leg.status) action = 'manual'; // rule needs more than the score, or does not reproduce the stored decision
    else if (atNew !== leg.status) { action = 'change'; flips.set(leg.id, atNew); }
    rows.push({ legId: leg.id, betId: leg.bet_id, market: leg.market_name, selection: leg.selection_name, odds: Number(leg.odds), current: leg.status, atOldScore: atOld, atNewScore: atNew, action });
  }
  const tickets = [];
  for (const [betId, b] of bets) {
    const after = b.legs.map((l) => ({ ...l, status: flips.has(l.id) ? flips.get(l.id) : l.status }));
    const out = ticketOutcome(b.stake, after);
    if (out.status === b.status && !after.some((l, i) => l.status !== b.legs[i].status)) continue;
    const pay = out.status === 'WON' ? (out.payout != null ? out.payout : Number(b.potential_return)) : 0;
    tickets.push({ betId, stake: Number(b.stake), currency: b.currency || 'ALL', from: b.status, to: out.status, payout: pay,
      blocked: b.status === 'WON' && out.status !== 'WON' ? 'was WON: no claw-back, decide by hand' : null });
  }
  return { rows, tickets, manual: rows.filter((r) => r.action === 'manual').length, changes: rows.filter((r) => r.action === 'change').length,
    blocked: tickets.filter((t) => t.blocked).length };
}

export async function correctResult(matchId, newHome, newAway, { apply = false } = {}) {
  const { rows: ms } = await pool.query('SELECT * FROM matches_cache WHERE id = $1', [matchId]);
  const match = ms[0];
  if (!match) return { error: 'Match not found' };
  if (match.status !== 'FINISHED' || match.result_home == null) return { error: 'Only a FINISHED match with a stored result can be corrected' };
  const { rows: legs } = await pool.query('SELECT * FROM bet_selections WHERE match_id = $1 ORDER BY id', [matchId]);
  const ids = [...new Set(legs.map((l) => l.bet_id))];
  const { rows: bs } = ids.length ? await pool.query('SELECT id, stake, status, potential_return, currency FROM bets WHERE id = ANY($1::text[])', [ids]) : { rows: [] };
  const { rows: all } = ids.length ? await pool.query('SELECT * FROM bet_selections WHERE bet_id = ANY($1::text[]) ORDER BY id', [ids]) : { rows: [] };
  const bets = new Map(bs.map((b) => [b.id, { ...b, legs: all.filter((l) => l.bet_id === b.id) }]));
  const plan = planCorrection(match, newHome, newAway, legs, bets);
  const base = { match: `${match.home_team} - ${match.away_team}`, oldResult: `${match.result_home}-${match.result_away}`, newResult: `${newHome}-${newAway}`, ...plan };
  if (!apply) return { dryRun: true, ...base };
  if (plan.blocked) return { applied: false, reason: 'some tickets would go from WON to lost; nothing was changed', ...base };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of plan.rows) if (r.action === 'change') await client.query('UPDATE bet_selections SET status = $1 WHERE id = $2 AND status = $3', [r.atNewScore, r.legId, r.current]);
    await client.query('UPDATE matches_cache SET result_home = $1, result_away = $2, live_home_score = $1, live_away_score = $2 WHERE id = $3', [newHome, newAway, matchId]);
    for (const betId of new Set(plan.rows.filter((r) => r.action === 'change').map((r) => r.betId))) await recomputeBetStatus(betId, client);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  return { applied: true, ...base };
}
