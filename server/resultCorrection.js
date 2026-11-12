// Correct the FINAL SCORE of matches that were closed with a wrong one (e.g. closed at 85' on a stale live score) and re-decide the tickets
// settled on it. Several matches are planned TOGETHER, because one ticket can have legs in more than one of them.
// Two steps: a DRY RUN that only reports, and an APPLY that is refused when anything is doubtful.
//  - a leg is re-decided only when the rules reproduce its CURRENT status at the old score (so the rule is trustworthy for that leg) and
//    need nothing but the score; every other leg is reported as "manual" and left untouched, unless the owner supplies its outcome
//    in `overrides` ({ legId: 'WON'|'LOST'|'VOID' }, only for legs that are "manual");
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
const OVERRIDE_OK = new Set(['WON', 'LOST', 'VOID']);

// Pure, per match: the legs of that match -> rows (+ flips legId -> new status).
export function planMatch(match, newHome, newAway, legs, overrides = {}) {
  const oldCtx = ctxFor(Number(match.result_home), Number(match.result_away), match);
  const newCtx = ctxFor(newHome, newAway, match);
  const rows = []; const flips = new Map();
  for (const leg of legs) {
    const atOld = safe(leg, oldCtx); const atNew = safe(leg, newCtx);
    let action = 'keep'; let to = atNew;
    if (atNew == null || atOld !== leg.status) {
      action = 'manual';
      const o = overrides[leg.id];
      if (o && OVERRIDE_OK.has(o)) { to = o; if (o !== leg.status) { action = 'override'; flips.set(leg.id, o); } }
    } else if (atNew !== leg.status) { action = 'change'; flips.set(leg.id, atNew); }
    rows.push({ legId: leg.id, betId: leg.bet_id, market: leg.market_name, selection: leg.selection_name, odds: Number(leg.odds), current: leg.status, atOldScore: atOld, atNewScore: to, action });
  }
  return { rows, flips };
}

// Pure, across matches: what every touched ticket becomes once ALL the flips are applied.
export function planTickets(bets, flips) {
  const tickets = [];
  for (const [betId, b] of bets) {
    const after = b.legs.map((l) => ({ ...l, status: flips.has(l.id) ? flips.get(l.id) : l.status }));
    if (!after.some((l, i) => l.status !== b.legs[i].status)) continue;
    const out = ticketOutcome(b.stake, after);
    const pay = out.status === 'WON' ? (out.payout != null ? out.payout : Number(b.potential_return)) : 0;
    tickets.push({ betId, userId: b.user_id, stake: Number(b.stake), currency: b.currency || 'ALL', from: b.status, to: out.status, payout: pay,
      stillPending: after.filter((l) => l.status === 'PENDING').length,
      blocked: b.status === 'WON' && out.status !== 'WON' ? 'was WON: no claw-back, decide by hand' : null });
  }
  return tickets;
}

// items: [{ matchId, homeScore, awayScore, overrides? }]
export async function correctBatch(items, { apply = false } = {}) {
  const matches = []; const flips = new Map(); const betIds = new Set();
  for (const it of items) {
    const { rows: ms } = await pool.query('SELECT * FROM matches_cache WHERE id = $1', [it.matchId]);
    const match = ms[0];
    if (!match) return { error: 'Match not found: ' + it.matchId };
    if (match.status !== 'FINISHED' || match.result_home == null) return { error: 'Only a FINISHED match with a stored result can be corrected: ' + it.matchId };
    const { rows: legs } = await pool.query('SELECT * FROM bet_selections WHERE match_id = $1 ORDER BY id', [it.matchId]);
    const p = planMatch(match, it.homeScore, it.awayScore, legs, it.overrides || {});
    for (const [k, v] of p.flips) flips.set(k, v);
    legs.forEach((l) => betIds.add(l.bet_id));
    matches.push({ match, it, rows: p.rows });
  }
  const ids = [...betIds];
  const { rows: bs } = ids.length ? await pool.query('SELECT id, user_id, stake, status, potential_return, currency FROM bets WHERE id = ANY($1::text[])', [ids]) : { rows: [] };
  const { rows: all } = ids.length ? await pool.query('SELECT * FROM bet_selections WHERE bet_id = ANY($1::text[]) ORDER BY id', [ids]) : { rows: [] };
  const bets = new Map(bs.map((b) => [b.id, { ...b, legs: all.filter((l) => l.bet_id === b.id) }]));
  const tickets = planTickets(bets, flips);
  const summary = matches.map((m) => ({ match: `${m.match.home_team} - ${m.match.away_team}`, oldResult: `${m.match.result_home}-${m.match.result_away}`,
    newResult: `${m.it.homeScore}-${m.it.awayScore}`, rows: m.rows }));
  const blocked = tickets.filter((t) => t.blocked).length;
  const base = { matches: summary, tickets, legChanges: flips.size, blocked };
  if (!apply) return { dryRun: true, ...base };
  if (blocked) return { applied: false, reason: 'some tickets would go from WON to lost; nothing was changed', ...base };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const m of matches) for (const r of m.rows) {
      if (flips.has(r.legId)) await client.query('UPDATE bet_selections SET status = $1 WHERE id = $2 AND status = $3', [flips.get(r.legId), r.legId, r.current]);
    }
    for (const m of matches) await client.query('UPDATE matches_cache SET result_home = $1, result_away = $2, live_home_score = $1, live_away_score = $2 WHERE id = $3', [m.it.homeScore, m.it.awayScore, m.it.matchId]);
    for (const t of tickets) await recomputeBetStatus(t.betId, client);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  return { applied: true, ...base };
}
