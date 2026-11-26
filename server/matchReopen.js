// Admin "Rihap ndeshjen": brings a match that was closed (FINISHED) by mistake back to LIVE, so the live sync takes it up again
// (score, clock, goals, markets) and its tickets are decided on what really happens. Example: Besiktas - Hapoel Beer Sheva dropped
// out of the provider's list at 31', was closed without a result and the tickets would have been closed on a wrong picture.
//
// Only a match WITHOUT a final result is reopened. A match that already has one was settled, and tickets decided on it were paid or
// closed: reopening cannot undo that, the result correction (/admin/matches/correct-results) is the tool for it. Tickets are never
// touched here: legs still PENDING stay pending, legs already decided stay decided.
import pool from './db.js';
import { noteMatchStatus } from './liveTracker.js';
import { resolveSports, api } from './london365/api.js';

// Ids of the games the provider lists as live right now (null when it could not be asked).
export async function providerLiveIds() {
  try {
    const ids = new Set();
    for (const sid of await resolveSports()) {
      const games = await api('/ajax/livegames', { method: 'POST', body: { sport: sid, market_type: 1 } });
      if (Array.isArray(games)) games.forEach((g) => ids.add(String(g.id)));
    }
    return ids;
  } catch { return null; }
}

export async function reopenMatch(matchId, { db = pool, liveIds = providerLiveIds } = {}) {
  const { rows } = await db.query('SELECT id, home_team, away_team, status, result_home, result_away, start_time FROM matches_cache WHERE id = $1', [matchId]);
  const m = rows && rows[0];
  if (!m) return { ok: false, code: 'NOT_FOUND', error: 'Ndeshja nuk u gjet' };
  if (m.status !== 'FINISHED') return { ok: false, code: 'NOT_CLOSED', error: 'Ndeshja nuk është e mbyllur (statusi: ' + m.status + ')' };
  if (m.result_home != null || m.result_away != null) {
    return { ok: false, code: 'HAS_RESULT', error: 'Ndeshja ka rezultat përfundimtar (' + m.result_home + '-' + m.result_away + '), biletat janë vendosur mbi të. Përdor korrigjimin e rezultatit.' };
  }
  // Ask the provider first: a match it does not list live is over (or missing for a moment): reopening it would only have it
  // closed again a minute later.
  const listed = await liveIds();
  if (!listed) return { ok: false, code: 'PROVIDER_UNREACHABLE', error: 'Nuk u kontrollua te ofruesi, provo përsëri pas pak.' };
  if (!listed.has(String(matchId).replace(/^l365-/, ''))) {
    return { ok: false, code: 'NOT_LIVE_AT_PROVIDER', error: 'Ndeshja ka mbaruar: ofruesi nuk e liston më live. Nëse është ende në lojë, provo pas 1-2 minutash (ofruesi e heq ndonjëherë për pak çaste).' };
  }
  const up = await db.query(
    `UPDATE matches_cache SET status = 'LIVE', live_status = CASE WHEN live_status = 'ended' THEN NULL ELSE live_status END
      WHERE id = $1 AND status = 'FINISHED' AND result_home IS NULL AND result_away IS NULL RETURNING id`, [matchId]);
  if (!up.rows || !up.rows.length) return { ok: false, code: 'CHANGED', error: 'Ndeshja u ndryshua ndërkohë, provo përsëri' };
  noteMatchStatus(matchId, 'LIVE');
  const { rows: c } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending, COUNT(*) FILTER (WHERE status <> 'PENDING')::int AS decided FROM bet_selections WHERE match_id = $1`, [matchId]);
  const since = Date.parse(m.start_time);
  return { ok: true, home: m.home_team, away: m.away_team, pendingLegs: (c && c[0] && c[0].pending) || 0, decidedLegs: (c && c[0] && c[0].decided) || 0,
    note: Number.isFinite(since) && Date.now() - since > 3 * 3600000 ? 'Ndeshja ka filluar para më shumë se 3 orësh: sistemi mund ta mbyllë sërish.' : null };
}
