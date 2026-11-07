// Fixtures that have an open ticket leg and are about to be / are being played. The live feeds drop games outside the
// wanted leagues (women's, youth, lower divisions); that is right for a catalogue, but a fixture somebody already bet
// on MUST keep receiving its live data and result, or its ticket can never close (HB Koege v AGF Aarhus, Danish women's
// league: the prematch record existed from before the filter, its in-play record was dropped, the ticket hung).
import pool from '../db.js';
import { sameFixture, sameTeam, nameWords } from '../fixtureDedupe.js';

let fixtures = [];

export async function refreshTicketedFixtures() {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT m.home_team, m.away_team FROM bet_selections bs
         JOIN bets b ON b.id = bs.bet_id AND b.status = 'PENDING'
         JOIN matches_cache m ON m.id = bs.match_id
        WHERE bs.status = 'PENDING'
          AND m.start_time::timestamptz BETWEEN now() - interval '10 hours' AND now() + interval '3 hours'`
    );
    setFixtures(rows.map((r) => ({ home: r.home_team, away: r.away_team })));
  } catch { /* keep the last list; next refresh retries */ }
  return fixtures.length;
}

let timer = null;
export function startTicketedFixtureLoop(intervalMs = 60000) {
  if (timer) return timer;
  refreshTicketedFixtures();
  timer = setInterval(refreshTicketedFixtures, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
}

// The check runs for EVERY live / socket game the league filter rejected (thousands per cycle), so it must be cheap:
// a name is reduced once to folded words (Koege / Køge -> "kog"), and the expensive fuzzy comparison only runs when a
// game shares a word with a ticketed fixture. Results are remembered per name pair.
const words = nameWords;
let fixtureWords = []; // parallel to `fixtures`: one Set of words per fixture
const verdicts = new Map(); // "home|away" -> boolean, dropped whenever the fixture list changes
function setFixtures(list) {
  const sig = list.map((f) => f.home + '|' + f.away).sort().join('#');
  if (sig === setFixtures.sig) return;
  setFixtures.sig = sig;
  fixtures = list;
  fixtureWords = list.map((f) => new Set([...words(f.home), ...words(f.away)]));
  verdicts.clear();
}

// g: a live / socket game payload (home_team, away_team).
export function isTicketedFixture(g) {
  if (!g || !g.home_team || !g.away_team || !fixtures.length) return false;
  const key = g.home_team + '|' + g.away_team;
  const known = verdicts.get(key);
  if (known !== undefined) return known;
  const gw = [...words(g.home_team), ...words(g.away_team)];
  let hit = false;
  for (let i = 0; i < fixtures.length && !hit; i++) {
    if (!gw.some((x) => fixtureWords[i].has(x))) continue; // shares no word: cannot be the same fixture
    const f = fixtures[i];
    hit = sameFixture({ homeTeam: f.home, awayTeam: f.away }, { homeTeam: g.home_team, awayTeam: g.away_team })
      // one club is the same and the other is written differently (Koege / Køge, "(W)" suffix)
      || sameTeam(f.home, g.home_team) || sameTeam(f.away, g.away_team);
  }
  if (verdicts.size > 20000) verdicts.clear();
  verdicts.set(key, hit);
  return hit;
}

export function __setTicketedFixturesForTests(list) { setFixtures.sig = null; setFixtures(list); }
