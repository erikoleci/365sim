// The provider's own event list of a live game (field "result_list" of the live list), e.g.
//   "2,1,1,327606921,1,13:00;2,1,2,327607979,1,18:00;4,1,1,327608431,1,20:00;..."
//   type , side (1 home / 2 away) , sequence , id , flag , minute:second
// Checked 2026-11-14 against the provider's own match page (Kosovo - Israel): type 2 = corner (13' 18' 25' 26' 40' 41'),
// type 4 = yellow card (20' home, 27' away). Only those two types are trusted; any other type is left alone (and logged once
// by the caller as evidence) because its meaning is not confirmed. This list does not depend on the game-details socket,
// so a restart of the app or a match the socket never delivers still ends with the full timeline.
import pool from '../db.js';
import { halfSql } from '../eventHalf.js';
import { setProviderCorners } from '../providerCounters.js';

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

const clockSeconds = (clock) => {
  const m = /^(\d{1,3}):(\d{2})$/.exec(String(clock || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const loggedTypes = new Set(); // evidence only: one log line per unconfirmed type code (to learn goals / red cards / substitutions)
const seen = new Map(); // match id -> last result_list handled
const SEEN_CAP = 3000;

// Logs the events that are not in the table yet. Same dedupe key as the game-details path (match, type, team, count), so an
// event both paths know is stored once. Cheap: nothing happens while the list is unchanged.
export async function ingestProviderEvents(matchId, resultList, currentClock, { db = pool, now = Date.now() } = {}) {
  const text = String(resultList || '');
  if (!text) return 0;
  const rows = providerEventRows(text);
  for (const e of parseResultList(text)) {
    if (TYPES[e.type] || loggedTypes.has(e.type) || loggedTypes.size > 40) continue;
    loggedTypes.add(e.type);
    console.log('[result-list-type] type=' + e.type + ' side=' + e.side + ' at=' + Math.floor(e.seconds / 60) + "' match=" + matchId + ' list=' + text.slice(0, 160));
  }
  // Corner totals for the live corner markets: refreshed on EVERY call (each live cycle), the list is the provider's full corner log.
  // Only when the list shows at least one corner: an empty / foreign list proves nothing about "0 corners".
  const home = rows.filter((r) => r.type === 'CORNER' && r.team === 'home').length;
  const away = rows.filter((r) => r.type === 'CORNER' && r.team === 'away').length;
  if (home + away > 0) setProviderCorners(matchId, home, away, now);
  if (seen.get(matchId) === text) return 0;
  const nowSec = clockSeconds(currentClock);
  let added = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const { rows: dup } = await db.query('SELECT 1 FROM match_events WHERE match_id = $1 AND type = $2 AND team = $3 AND detail = $4 LIMIT 1', [matchId, r.type, r.team, r.detail]);
    if (dup && dup.length) continue;
    // created_at orders the timeline: put each event where it happened relative to the clock now.
    const at = nowSec != null ? now - Math.max(0, nowSec - r.seconds) * 1000 : now + i;
    try {
      await db.query(`INSERT INTO match_events (match_id, minute, type, team, detail, created_at, half) VALUES ($1,$2,$3,$4,$5,$6,${halfSql('$1')})`, [matchId, r.minute, r.type, r.team, r.detail, at]);
    } catch {
      await db.query('INSERT INTO match_events (match_id, minute, type, team, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [matchId, r.minute, r.type, r.team, r.detail, at]);
    }
    added++;
  }
  if (seen.size >= SEEN_CAP) seen.clear();
  seen.set(matchId, text);
  return added;
}
export const __resetProviderEventsForTests = () => seen.clear();
