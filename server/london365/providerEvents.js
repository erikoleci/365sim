// The provider's own event list of a live game (field "result_list" of the live list), e.g.
//   "2,1,1,327606921,1,13:00;2,1,2,327607979,1,18:00;4,1,1,327608431,1,20:00;..."
//   type , side (1 home / 2 away) , sequence , id , flag , minute:second
// Checked 2026-11-14 against the provider's own match page (Kosovo - Israel): type 2 = corner (13' 18' 25' 26' 40' 41'),
// type 4 = yellow card (20' home, 27' away). Only those two types are trusted; any other type is left alone (and logged once
// by the caller as evidence) because its meaning is not confirmed.
// Type 1 = GOAL, confirmed 2026-11-26 on four live games (Muranga Seal-KCB 0-2, Tai Po-Adelaide 0-3, Tesla PA U20-Venus PA U20 2-0,
// Persika-Persipa 3-0): the number of type-1 entries per side equalled the score each time. Goals are only used to FILL GAPS
// (see reconcileGoals): the socket stays the primary source, the list recovers what it missed (restart, first-seen 2+ goals). This list does not depend on the game-details socket,
// so a restart of the app or a match the socket never delivers still ends with the full timeline.
import pool from '../db.js';
import { halfSql } from '../eventHalf.js';
import { setProviderCorners } from '../providerCounters.js';
import { sameTeam } from '../fixtureDedupe.js';

const TYPES = { 2: 'CORNER', 4: 'YELLOW_CARD' };

export function parseResultList(text) {
  const out = [];
  for (const part of String(text || '').split(';')) {
    const f = part.split(',');
    if (f.length < 6) continue;
    const type = Number(f[0]);
    const side = Number(f[1]);
    const m = /^(\d{1,3}):(\d{2})$/.exec(String(f[5]).trim());
    if (!Number.isInteger(type) || (side !== 1 && side !== 2) || !m) continue;
    out.push({ type, side, seconds: Number(m[1]) * 60 + Number(m[2]) });
  }
  return out;
}

// Rows to log: type name, team, running count of that type for that team (the same "detail" the game-details path writes), minute.
export function providerEventRows(text) {
  const counts = {};
  const rows = [];
  const list = parseResultList(text).sort((a, b) => a.seconds - b.seconds);
  for (const e of list) {
    const type = TYPES[e.type];
    if (!type) continue;
    const team = e.side === 1 ? 'home' : 'away';
    const key = type + ':' + team;
    counts[key] = (counts[key] || 0) + 1;
    rows.push({ type, team, detail: String(counts[key]), minute: Math.floor(e.seconds / 60), seconds: e.seconds });
  }
  return rows;
}

// Goals of the list in time order, with the running score after each ("1-0", "1-1"...).
export function providerGoals(text) {
  let h = 0; let a = 0;
  return parseResultList(text).filter((e) => e.type === 1).sort((x, y) => x.seconds - y.seconds).map((e) => {
    if (e.side === 1) h++; else a++;
    return { side: e.side === 1 ? 'home' : 'away', minute: Math.floor(e.seconds / 60), seconds: e.seconds, score: h + '-' + a };
  });
}

// Which goals of the list are missing from the logged GOAL rows of one side: every logged row consumes the listed goal with the
// nearest minute (within 1'), the rest are missing; never more than the difference in counts.
export function missingGoals(listGoals, loggedMinutes) {
  const left = [...listGoals];
  for (const m of loggedMinutes) {
    let best = -1;
    for (let i = 0; i < left.length; i++) if (Math.abs(left[i].minute - Number(m)) <= 1 && (best < 0 || Math.abs(left[i].minute - Number(m)) < Math.abs(left[best].minute - Number(m)))) best = i;
    if (best >= 0) left.splice(best, 1);
  }
  return left.slice(0, Math.max(0, listGoals.length - loggedMinutes.length));
}

// Fills goals the socket never logged. Only when the list agrees with the live score for BOTH sides (a lagging or foreign list
// proves nothing), and only the missing ones. Minutes are the provider's own (exact).
async function reconcileGoals(matchId, text, score, goalRows, { db, now, nowSec }) {
  const list = providerGoals(text);
  if (!list.length || !score) return 0;
  const lh = list.filter((g) => g.side === 'home'); const la = list.filter((g) => g.side === 'away');
  if (lh.length !== score.home || la.length !== score.away) return 0;
  if (goalRows.length >= list.length) return 0;
  const { rows: mr } = await db.query('SELECT home_team, away_team FROM matches_cache WHERE id = $1', [matchId]);
  const m = mr && mr[0];
  if (!m) return 0;
  const sideOf = (t) => (t === 'home' || t === m.home_team ? 'home' : t === 'away' || t === m.away_team ? 'away'
    : sameTeam(t, m.home_team) ? 'home' : sameTeam(t, m.away_team) ? 'away' : null);
  const logged = { home: [], away: [] };
  for (const r of goalRows) { const s = sideOf(r.team); if (s) logged[s].push(r.minute); }
  const add = [...missingGoals(lh, logged.home), ...missingGoals(la, logged.away)].sort((x, y) => x.seconds - y.seconds);
  let added = 0;
  for (let i = 0; i < add.length; i++) {
    const g = add[i];
    const team = g.side === 'home' ? m.home_team : m.away_team;
    const at = nowSec != null ? now - Math.max(0, nowSec - g.seconds) * 1000 : now + i;
    try {
      await db.query(`INSERT INTO match_events (match_id, minute, type, team, detail, created_at, minute_exact, half) VALUES ($1,$2,'GOAL',$3,$4,$5,true,${halfSql('$1')})`, [matchId, g.minute, team, g.score, at]);
    } catch {
      await db.query(`INSERT INTO match_events (match_id, minute, type, team, detail, created_at) VALUES ($1,$2,'GOAL',$3,$4,$5)`, [matchId, g.minute, team, g.score, at]);
    }
    added++;
  }
  if (added) console.log('[provider-goals] ' + matchId + ' recovered ' + added + ' goal(s) from the provider list: ' + add.map((g) => g.side + ' ' + g.minute + "'").join(', '));
  return added;
}

const clockSeconds = (clock) => {
  const m = /^(\d{1,3}):(\d{2})$/.exec(String(clock || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const loggedTypes = new Set(); // evidence only: one log line per unconfirmed type code (to learn goals / red cards / substitutions)
const seen = new Map(); // match id -> last result_list handled
const SEEN_CAP = 3000;

// Logs the events that are not in the table yet. Same dedupe key as the game-details path (match, type, team, count), so an
// event both paths know is stored once. Cheap: nothing happens while the list is unchanged.
export async function ingestProviderEvents(matchId, resultList, currentClock, { db = pool, now = Date.now(), score = null } = {}) {
  const text = String(resultList || '');
  if (!text) return 0;
  const rows = providerEventRows(text);
  for (const e of parseResultList(text)) {
    if (TYPES[e.type] || e.type === 1 || loggedTypes.has(e.type) || loggedTypes.size > 40) continue;
    loggedTypes.add(e.type);
    console.log('[result-list-type] type=' + e.type + ' side=' + e.side + ' at=' + Math.floor(e.seconds / 60) + "' match=" + matchId + ' list=' + text.slice(0, 160));
  }
  // Corner totals for the live corner markets: refreshed on EVERY call (each live cycle), the list is the provider's full corner log.
  // Only when the list shows at least one corner: an empty / foreign list proves nothing about "0 corners".
  const home = rows.filter((r) => r.type === 'CORNER' && r.team === 'home').length;
  const away = rows.filter((r) => r.type === 'CORNER' && r.team === 'away').length;
  if (home + away > 0) setProviderCorners(matchId, home, away, now);
  const seenKey = text + '|' + (score ? score.home + '-' + score.away : '');
  if (seen.get(matchId) === seenKey) return 0;
  const nowSec = clockSeconds(currentClock);
  let added = 0;
  const hasGoals = parseResultList(text).some((e) => e.type === 1);
  if (rows.length || hasGoals) {
    // One query for what is already stored (not one per event): this runs for every live game, every cycle that the list changed.
    const { rows: have } = await db.query("SELECT type, team, detail, minute FROM match_events WHERE match_id = $1 AND type IN ('CORNER','YELLOW_CARD','GOAL')", [matchId]);
    const known = new Set((have || []).filter((h) => h.type !== 'GOAL').map((h) => h.type + ':' + h.team + ':' + h.detail));
    if (hasGoals) added += await reconcileGoals(matchId, text, score, (have || []).filter((h) => h.type === 'GOAL'), { db, now, nowSec });
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (known.has(r.type + ':' + r.team + ':' + r.detail)) continue;
      // created_at orders the timeline: put each event where it happened relative to the clock now.
      const at = nowSec != null ? now - Math.max(0, nowSec - r.seconds) * 1000 : now + i;
      try {
        await db.query(`INSERT INTO match_events (match_id, minute, type, team, detail, created_at, half) VALUES ($1,$2,$3,$4,$5,$6,${halfSql('$1')})`, [matchId, r.minute, r.type, r.team, r.detail, at]);
      } catch {
        await db.query('INSERT INTO match_events (match_id, minute, type, team, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [matchId, r.minute, r.type, r.team, r.detail, at]);
      }
      added++;
    }
  }
  if (seen.size >= SEEN_CAP) seen.clear();
  seen.set(matchId, seenKey);
  return added;
}
export const __resetProviderEventsForTests = () => seen.clear();
