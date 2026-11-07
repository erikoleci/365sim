// Fixtures that have an open ticket leg and are about to be / are being played. The live feeds drop games outside the
// wanted leagues (women's, youth, lower divisions); that is right for a catalogue, but a fixture somebody already bet
// on MUST keep receiving its live data and result, or its ticket can never close (HB Koege v AGF Aarhus, Danish women's
// league: the prematch record existed from before the filter, its in-play record was dropped, the ticket hung).
import pool from '../db.js';
import { sameFixture, sameTeam } from '../fixtureDedupe.js';

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
    fixtures = rows.map((r) => ({ home: r.home_team, away: r.away_team }));
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

// g: a live / socket game payload (home_team, away_team).
export function isTicketedFixture(g) {
  if (!g || !g.home_team || !g.away_team) return false;
  for (const f of fixtures) {
    if (sameFixture({ homeTeam: f.home, awayTeam: f.away }, { homeTeam: g.home_team, awayTeam: g.away_team })) return true;
    // one club is the same and the other is written differently (Koege / Køge, "(W)" suffix)
    if (sameTeam(f.home, g.home_team) || sameTeam(f.away, g.away_team)) return true;
  }
  return false;
}

export function __setTicketedFixturesForTests(list) { fixtures = list; }
