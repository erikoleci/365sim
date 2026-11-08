// `npm run verify:links` -- READ-ONLY. Checks, on the real database, that the two provider records of every fixture of the
// last 3 days are linked, and that no open ticket leg is stranded on a record that will never finish.
// For each pre-match (catalogue) record that has started:
//   LINKED      one in-play twin found by league + kick-off + club (the same rule the settlement uses)
//   AMBIGUOUS   several candidates -- nothing is linked automatically (needs a look)
//   NO TWIN     no in-play record exists (fine if it is not in the feed at all; a problem if tickets are open on it)
// and prints the legs still open on it plus what the twin says (status / score). Saved to verify-links.txt.
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { pool } from './db.js';
import { strictSameFixture } from './fixtureLink.js';
import { pickLiveTwin } from './liveTwin.js';
import { sameTeam } from './fixtureDedupe.js';

const out = [];
const say = (s = '') => { out.push(s); console.log(s); };
const hasLive = (r) => r.live_home_score != null || r.live_minute != null || r.result_home != null;
const sc = (r) => (r.result_home != null ? r.result_home + '-' + r.result_away : r.live_home_score != null ? r.live_home_score + '-' + r.live_away_score + ' (live)' : 'pa rezultat');

async function main() {
  const { rows } = await pool.query(
    `SELECT * FROM matches_cache WHERE start_time::timestamptz BETWEEN now() - interval '3 days' AND now()`
  );
  const { rows: legRows } = await pool.query(
    `SELECT bs.match_id, COUNT(*)::int AS n FROM bet_selections bs JOIN bets b ON b.id = bs.bet_id AND b.status = 'PENDING'
      WHERE bs.status = 'PENDING' GROUP BY bs.match_id`
  );
  const open = new Map(legRows.map((r) => [r.match_id, r.n]));
  const catalogue = rows.filter((r) => !hasLive(r));
  const live = rows.filter(hasLive);
  const tally = { LINKED: 0, AMBIGUOUS: 0, 'NO TWIN': 0 };
  const problems = [];
  for (const c of catalogue) {
    const strict = live.filter((l) => strictSameFixture(c, l));
    const legacy = pickLiveTwin(c, live);
    const openLegs = open.get(c.id) || 0;
    let verdict;
    if (strict.length > 1) verdict = 'AMBIGUOUS';
    else if (strict.length === 1 || legacy) verdict = 'LINKED';
    else verdict = 'NO TWIN';
    tally[verdict]++;
    const twin = strict[0] || legacy;
    const stranded = openLegs > 0 && twin && twin.status === 'FINISHED';
    const lost = openLegs > 0 && !twin && Date.now() - Date.parse(c.start_time) > 20 * 60000;
    if (verdict === 'AMBIGUOUS' || stranded || lost) {
      problems.push({ c, twin, verdict, openLegs, strict, stranded, lost });
    }
  }
  // Two finished records of one fixture must show the same final score (ticket #120: 2-4 on one, 4-4 on the other).
  const mismatches = [];
  for (const c of catalogue) {
    if (c.status !== 'FINISHED' || c.result_home == null || c.result_away == null) continue;
    for (const l of live.filter((x) => strictSameFixture(c, x) && x.status === 'FINISHED' && x.result_home != null && x.result_away != null)) {
      const crossed = sameTeam(c.home_team, l.away_team) && sameTeam(c.away_team, l.home_team) && !(sameTeam(c.home_team, l.home_team) || sameTeam(c.away_team, l.away_team));
      const lh = crossed ? l.result_away : l.result_home;
      const la = crossed ? l.result_home : l.result_away;
      if (Number(lh) !== Number(c.result_home) || Number(la) !== Number(c.result_away)) mismatches.push({ c, l, lh, la, openLegs: open.get(c.id) || 0 });
    }
  }
  say(`Rekorde katalogu të nisura (3 ditë): ${catalogue.length}   rekorde in-play: ${live.length}`);
  say(`LINKED=${tally.LINKED}   AMBIGUOUS=${tally.AMBIGUOUS}   NO TWIN=${tally['NO TWIN']}`);
  say('');
  if (!problems.length) say('ASNJË PROBLEM: asnjë leg i hapur nuk ka mbetur te rekord që s\'do mbarojë, asnjë çift i paqartë.');
  for (const p of problems) {
    const { c, twin } = p;
    say(`${c.home_team} v ${c.away_team}  [${c.id}] ${c.status}  liga=${c.league}  nisja=${c.start_time}  legs të hapura=${p.openLegs}`);
    if (p.verdict === 'AMBIGUOUS') say('   AMBIGUOUS: ' + p.strict.map((s) => s.id + ' (' + s.home_team + ' v ' + s.away_team + ')').join(' | '));
    if (p.stranded) say(`   ngecur: binjaku ${twin.id} është FINISHED ${sc(twin)}; legs duhen kaluar në të (rebindLegsToLiveTwin e bën në ciklin e radhës)`);
    if (p.lost) say('   [link-missing] asnjë rekord in-play i gjetur dhe bileta është e hapur: ndeshja nuk është në feed');
  }
  say('');
  say(mismatches.length ? 'REZULTATE QË NUK PËRPUTHEN (' + mismatches.length + '):' : 'Rezultatet e çifteve të mbaruara përputhen.');
  for (const m of mismatches) say(`   ${m.c.home_team} v ${m.c.away_team}  katalogu ${m.c.id}=${m.c.result_home}-${m.c.result_away}  in-play ${m.l.id}=${m.lh}-${m.la}  nisja=${m.c.start_time}`);
  say('');
  say('PËRFUNDIM: ' + (problems.length || mismatches.length ? (problems.length + mismatches.length) + ' rast(e) për t\'u parë' : 'në rregull'));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    try { writeFileSync('verify-links.txt', out.join('\n') + '\n'); } catch { /* read-only folder */ }
    await pool.end().catch(() => {});
  });
