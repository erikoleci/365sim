// Consumer for the LondonPro365 "gamedetails" live-match-detail feed
// (separate socket from the odds/coefs one in london365Socket.js — see
// startLondon365GameDetailsSocket there).
//
// FIELDS VERIFIED AGAINST REAL PROVIDER OUTPUT (per the site owner's own
// captured update sequences — not guessed):
//   EID        -> the game id (matches matches_cache.id = 'l365-' + EID)
//   SC         -> "home-away" score, e.g. "1-2"
//   H / A      -> home / away team name
//   YC1 / YC2  -> yellow card count, home / away
//   RC1 / RC2  -> red card count, home / away
//   T          -> a per-EID counter that strictly increases with every
//                 update (2921 -> 2922 -> 2924 -> ...). Its exact meaning
//                 (tick? server timestamp?) is NOT confirmed, so it is
//                 used ONLY as an opaque de-duplication/ordering key —
//                 never displayed or treated as a minute.
//
// FIELDS DELIBERATELY NOT MAPPED (no confirmed meaning — see instructions):
//   H1-H8, A1-A8, XY, PG, AM, TA, TT, Pj, S, KC1, KC2, TC1, TC2, VC
//   These are kept verbatim on the in-memory state under `raw` for future
//   analysis, but never surfaced as "minute", "possession", "position",
//   etc. Inventing a mapping for these would violate the one hard
//   requirement of this feature (no fabricated live data).
//
// LIVE MINUTE: the site already has a verified minute source — the
// existing REST/odds-socket pipeline writes matches_cache.live_minute
// (see london365.js). That column is used as-is here as the source of
// truth for logging; this module never derives a minute from the
// unverified fields above.

import pool from './db.js';
import { pushCardEvent, pushLiveTick } from './ws.js';
import { recordGoalIfChanged, minuteToNumber } from './london365.js';
import { parseGameDetails } from './gameDetailsParser.js';
export { parseGameDetails };

function parseScore(sc) {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(String(sc || '').trim());
  if (!m) return null;
  return { home: Number(m[1]), away: Number(m[2]) };
}

// EID -> { t, yc1, yc2, rc1, rc2 } last-seen verified values, purely
// in-memory (per instructions: live state belongs in memory, not a DB
// round-trip per tick). Resets on restart, which just means the very next
// real change after a restart is treated as "first seen" instead of a
// diff — never produces a false card duplicate.
const lastSeen = new Map();
const unknownEidWarned = new Set();

export async function applyGameDetails(raw) {
  const attrs = parseGameDetails(raw);
  if (!attrs) return;
  const eid = attrs.EID;
  const t = Number(attrs.T);
  const prevSeen = lastSeen.get(eid);

  // De-dup / ordering: T strictly increases per EID on every real update
  // (confirmed from captured sequences). A non-increasing T for an EID
  // we've already seen is the exact "provider re-sent the same update"
  // case instructions #11 warns about — skip it outright.
  if (prevSeen && Number.isFinite(t) && t <= prevSeen.t) return;

  const matchId = 'l365-' + eid;
  const { rows } = await pool.query(
    'SELECT id, home_team, away_team, live_home_score, live_away_score, live_minute FROM matches_cache WHERE id = $1',
    [matchId]
  );
  const row = rows[0];
  if (!row) {
    // Game not in our catalog (different country/league than what we
    // import — see LONDON365_ONLY_COUNTRIES). Per instructions, this
    // module must never force an import or touch the country/league
    // whitelist, so it just skips, logging once per EID to avoid spam.
    if (!unknownEidWarned.has(eid)) {
      unknownEidWarned.add(eid);
      console.log(`[live] EID=${eid} has no matching cached game (l365-${eid}) — skipping`);
    }
    lastSeen.set(eid, { t: Number.isFinite(t) ? t : 0, yc1: 0, yc2: 0, rc1: 0, rc2: 0 });
    return;
  }

  const score = parseScore(attrs.SC);
  const minuteDisplay = row.live_minute || null; // verified source, see header comment
  console.log(`[live] EID=${eid} score=${attrs.SC || '?'} minute=${minuteDisplay || '?'}`);

  // BUG FIX: this fast (~1/sec) socket used to only ever write the score
  // into `live_statistics` (via recordGoalIfChanged below) and never into
  // matches_cache.live_home_score/live_away_score — the columns actually
  // read by GET /api/matches and GET /api/matches/:id (see routes/matches.js
  // and oddsUtils.mapEventToMatch). Those columns were only ever refreshed
  // by the *separate* 30s REST live loop (syncLondon365Live in london365.js).
  // Net effect: a client that (re)loads the match list, or reconnects after
  // missing the one-off pushGoal broadcast, could sit on a stale score for
  // up to ~30s even though this socket had the correct value the instant it
  // arrived — exactly the "provider is live but the page doesn't reflect it"
  // symptom. Now the confirmed score is written here immediately, so
  // matches_cache is never behind what this socket already knows.
  let homeScoreForBroadcast = row.live_home_score;
  let awayScoreForBroadcast = row.live_away_score;
  if (score && (score.home !== row.live_home_score || score.away !== row.live_away_score)) {
    await pool.query(
      'UPDATE matches_cache SET live_home_score = $1, live_away_score = $2 WHERE id = $3',
      [score.home, score.away, matchId]
    );
    homeScoreForBroadcast = score.home;
    awayScoreForBroadcast = score.away;
  }

  if (score) {
    const ev = { id: matchId, home_team: attrs.H || row.home_team, away_team: attrs.A || row.away_team };
    const prevScoreRow = { live_home_score: row.live_home_score, live_away_score: row.live_away_score };
    const before = `${row.live_home_score}-${row.live_away_score}`;
    await recordGoalIfChanged(ev, score, minuteDisplay, prevScoreRow);
    if (`${score.home}-${score.away}` !== before) {
      const team = Math.sign(score.home - (row.live_home_score || 0)) === 1 ? 'home' : 'away';
      console.log(`[live-event] GOAL EID=${eid} team=${team} score=${score.home}-${score.away} minute=${minuteDisplay || '?'}`);
    }
  }

  // Broadcast on EVERY processed update (not only when the score changes),
  // so a connected client's minute/score get resynced at this feed's real
  // ~1/sec cadence instead of waiting on the next goal or the slow 60s
  // match-list poll. Only ever carries values already verified elsewhere
  // (matches_cache.live_minute / live_home_score / live_away_score) — never
  // derived from the unconfirmed T/H1-H8/A1-A8 fields (see header comment).
  pushLiveTick(matchId, {
    minute: minuteDisplay || undefined,
    homeScore: homeScoreForBroadcast ?? undefined,
    awayScore: awayScoreForBroadcast ?? undefined,
  });

  const yc1 = Number(attrs.YC1) || 0, yc2 = Number(attrs.YC2) || 0;
  const rc1 = Number(attrs.RC1) || 0, rc2 = Number(attrs.RC2) || 0;
  const prevCards = prevSeen || { yc1: 0, yc2: 0, rc1: 0, rc2: 0 };
  const now = Date.now();
  const minuteNum = minuteToNumber(minuteDisplay);

  async function recordCard(type, team, count) {
    await pool.query(
      `INSERT INTO match_events (match_id, minute, type, team, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [matchId, minuteNum, type, team, String(count), now]
    );
    pushCardEvent(matchId, { cardType: type, team, count, minute: minuteDisplay || undefined });
    console.log(`[live-event] ${type} EID=${eid} team=${team} minute=${minuteDisplay || '?'}`);
  }
  if (yc1 > prevCards.yc1) await recordCard('YELLOW_CARD', 'home', yc1);
  if (yc2 > prevCards.yc2) await recordCard('YELLOW_CARD', 'away', yc2);
  if (rc1 > prevCards.rc1) await recordCard('RED_CARD', 'home', rc1);
  if (rc2 > prevCards.rc2) await recordCard('RED_CARD', 'away', rc2);

  lastSeen.set(eid, { t: Number.isFinite(t) ? t : (prevSeen ? prevSeen.t : 0), yc1, yc2, rc1, rc2 });
}
