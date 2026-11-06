// Second source of final scores, used ONLY when the main feed never delivered a result for a match whose
// tickets are still open hours after kickoff. Public ESPN scoreboard (no key). Safeguards, because this settles
// money: only a match ESPN marks as plain Full Time (not extra time / penalties, whose regular-time score
// needs the event log), both clubs must match the leg's clubs in the SAME home/away order, and the kickoff must
// be within 3 hours. Anything uncertain is left open for the admin. RESULTS_FALLBACK=0 turns it off.
import { pool } from './db.js';
import { settleMatch } from './matchSettlement.js';

const SLUGS = [
  'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'por.1', 'ned.1', 'bel.1', 'tur.1', 'sco.1', 'gre.1',
  'eng.2', 'esp.2', 'ita.2', 'ger.2', 'fra.2', 'por.2',
  'uefa.champions', 'uefa.europa', 'uefa.europa.conf', 'eng.fa', 'eng.league_cup', 'esp.copa_del_rey', 'ita.coppa_italia', 'ger.dfb_pokal', 'fra.coupe_de_france',
];
const GENERIC = new Set(['fc', 'cf', 'ca', 'rc', 'sc', 'ac', 'as', 'cd', 'sd', 'ud', 'afc', 'sk', 'fk', 'stade', 'de', 'la', 'le', 'el', 'a', 'da', 'do', 'of', 'club', 'calcio']);
const words = (n) => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !GENERIC.has(t));
export function sameClub(a, b) {
  const ka = words(a), kb = words(b);
  if (!ka.length || !kb.length) return false;
  const [s, l] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  return s.every((t) => l.some((u) => u === t || (t.length >= 4 && u.length >= 4 && (u.startsWith(t) || t.startsWith(u)))));
}

// ESPN scoreboard JSON -> [{home, away, homeScore, awayScore, start}] of plain full-time finals.
export function parseFinals(json) {
  const out = [];
  for (const ev of (json && json.events) || []) {
    const comp = ev.competitions && ev.competitions[0];
    const st = (comp && comp.status && comp.status.type) || (ev.status && ev.status.type) || {};
    if (!comp || st.name !== 'STATUS_FULL_TIME') continue;
    const h = comp.competitors.find((c) => c.homeAway === 'home'), a = comp.competitors.find((c) => c.homeAway === 'away');
    if (!h || !a) continue;
    const hs = Number(h.score), as = Number(a.score);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    out.push({ home: h.team.displayName, away: a.team.displayName, homeScore: hs, awayScore: as, start: Date.parse(ev.date) });
  }
  return out;
}

export function findFinal(finals, { home, away, start }) {
  const hits = finals.filter((f) => sameClub(home, f.home) && sameClub(away, f.away) && Math.abs(f.start - start) <= 3 * 3600 * 1000);
  return hits.length === 1 ? hits[0] : null; // none or ambiguous: leave it to the admin
}

const cache = new Map(); // yyyymmdd -> { at, finals }
async function finalsOn(day, fetchImpl) {
  const hit = cache.get(day);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.finals;
  const finals = [];
  for (const slug of SLUGS) {
    try {
      const res = await fetchImpl(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${day}`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) finals.push(...parseFinals(await res.json()));
    } catch { /* one competition unreachable: the others still count */ }
  }
  cache.set(day, { at: Date.now(), finals });
  return finals;
}
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

export async function settleFromFallback({ now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
  if (String(process.env.RESULTS_FALLBACK ?? '1') === '0' || !fetchImpl) return { settledMatches: 0, disabled: true };
  const { rows } = await pool.query(
    `SELECT DISTINCT bs.match_id, bs.match_home, bs.match_away, m.start_time
       FROM bet_selections bs JOIN matches_cache m ON m.id = bs.match_id
      WHERE bs.status = 'PENDING' AND m.result_home IS NULL AND m.result_away IS NULL`
  );
  let settledMatches = 0;
  for (const r of rows) {
    const start = Date.parse(r.start_time);
    if (!Number.isFinite(start) || now - start < 100 * 60 * 1000) continue; // ESPN only reports plain Full Time, so this is safe once the match could be over
    const finals = [...await finalsOn(ymd(start), fetchImpl), ...await finalsOn(ymd(start + 86400000), fetchImpl)];
    const f = findFinal(finals, { home: r.match_home, away: r.match_away, start });
    if (!f) continue;
    try {
      const res = await settleMatch(r.match_id, f.homeScore, f.awayScore, { force: true });
      if (res && res.autoSettledLegs) {
        settledMatches++;
        console.log(`[settle] fallback result ${r.match_home} v ${r.match_away} ${f.homeScore}-${f.awayScore} (ESPN): ${JSON.stringify(res)}`);
      }
    } catch (err) { console.error('[settle] fallback settle failed:', err.message); }
  }
  return { settledMatches };
}
