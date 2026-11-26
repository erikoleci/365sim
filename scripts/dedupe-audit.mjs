// Audit: every LIVE record against every other record of about the same kick-off, names compared loosely.
// Reads the database only; changes nothing. Usage: node /app/scripts/dedupe-audit.mjs   (DUPE_ROOT / DUPE_ROWS_FILE for tests)
const ROOT = process.env.DUPE_ROOT || '/app';
const { dedupeMatches, normTeam } = await import(ROOT + '/server/fixtureDedupe.js');
let rows;
if (process.env.DUPE_ROWS_FILE) rows = JSON.parse((await import('fs')).readFileSync(process.env.DUPE_ROWS_FILE, 'utf8'));
else {
  const { pool } = await import(ROOT + '/server/db.js');
  rows = (await pool.query(`SELECT id, home_team, away_team, league, start_time, status FROM matches_cache
    WHERE id LIKE 'l365-%' AND status IN ('LIVE','UPCOMING','FINISHED')
      AND start_time::timestamptz BETWEEN now() - interval '8 hours' AND now() + interval '48 hours'`)).rows;
  await pool.end();
}
const now = process.env.DUPE_NOW ? Date.parse(process.env.DUPE_NOW) : Date.now();
const list = rows.map((r) => ({ id: r.id, homeTeam: r.home_team, awayTeam: r.away_team, league: r.league, startTime: r.start_time, status: r.status, markets: [] }));
const merged = [];
const kept = dedupeMatches(list, (ids) => merged.push(ids));
const byId = new Map(list.map((m) => [m.id, m]));
const hhmm = (m) => String(m.startTime).slice(11, 16);
const nm = (m) => `${m.homeTeam} - ${m.awayTeam} [${m.status} ${hhmm(m)}] ${m.id}`;
const grams = (s) => { const n = ' ' + normTeam(s) + ' '; const g = new Set(); for (let i = 0; i < n.length - 1; i++) g.add(n.slice(i, i + 2)); return g; };
const sim = (a, b) => { const x = grams(a), y = grams(b); if (!x.size || !y.size) return 0; let c = 0; for (const t of x) if (y.has(t)) c++; return (2 * c) / (x.size + y.size); };
const score = (a, b) => Math.max(sim(a.homeTeam, b.homeTeam) + sim(a.awayTeam, b.awayTeam), sim(a.homeTeam, b.awayTeam) + sim(a.awayTeam, b.homeTeam)) / 2;
console.log(`Regjistra: ${list.length} | pas bashkimit: ${kept.length} | grupe te bashkuara: ${merged.length}`);

console.log('\n== A) UPCOMING qe ora e nisjes ka kaluar >10 min (twin i ngecur ose ndeshje e vonuar) ==');
const stale = kept.filter((m) => m.status === 'UPCOMING' && Date.parse(m.startTime) < now - 10 * 60 * 1000);
for (const m of stale) console.log(nm(m));
if (!stale.length) console.log('(asnje)');

console.log('\n== B) Cdo LIVE i pabashkuar me kandidatet me te ngjashem (ora +-30 min, rendit sipas ngjashmerise) ==');
const live = kept.filter((m) => m.status === 'LIVE' && !merged.some((ids) => ids.includes(m.id)));
let flagged = 0;
for (const l of live) {
  const cands = kept.filter((o) => o.id !== l.id && o.status !== 'FINISHED' && Math.abs(Date.parse(o.startTime) - Date.parse(l.startTime)) <= 30 * 60 * 1000)
    .map((o) => ({ o, s: score(l, o) })).filter((x) => x.s >= 0.35).sort((a, b) => b.s - a.s).slice(0, 3);
  if (cands.length) { flagged++; console.log(nm(l)); for (const c of cands) console.log(`   ?? ${c.s.toFixed(2)}  ${nm(c.o)}`); }
}
console.log(`LIVE pa twin: ${live.length} | me kandidat te dyshimte: ${flagged}`);

console.log('\n== C) LIVE pa asnje twin dhe pa kandidat (te rinj ose twin me emer krejt tjeter) ==');
for (const l of live) {
  const has = kept.some((o) => o.id !== l.id && o.status !== 'FINISHED' && Math.abs(Date.parse(o.startTime) - Date.parse(l.startTime)) <= 30 * 60 * 1000 && score(l, o) >= 0.35);
  if (!has) console.log(nm(l));
}
