// READ-ONLY diagnostic. Lists every sport the provider exposes and, for each, what its live games
// and markets look like (score format, clock, status codes, market names). Nothing is written.
// Run:  docker compose --env-file .env.local -f docker-compose.local.yml exec -T app node server/discoverSports.js
import { api } from './london365/api.js';

const short = (v, n = 70) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : String(s); };
const nameOf = (s) => s.name || s.title || s.sport || s.label || short(s, 30);

const sports = await api('/ajax/sports');
if (!Array.isArray(sports)) { console.log('unexpected /ajax/sports answer:', short(sports, 300)); process.exit(0); }
console.log('SPORTS: ' + sports.map((s) => s.id + '=' + nameOf(s)).join(' | '));

for (const s of sports) {
  const sid = Number(s.id);
  console.log('\n=== sport ' + sid + ' ' + nameOf(s) + ' ===');
  try {
    const countries = await api('/ajax/countries/' + sid, { retries: 1 });
    console.log('countries: ' + (Array.isArray(countries) ? countries.length : short(countries)));
  } catch (e) { console.log('countries failed: ' + e.message); }
  let games = [];
  try {
    games = await api('/ajax/livegames', { method: 'POST', body: { sport: sid, market_type: 1 }, retries: 1 });
    if (!Array.isArray(games)) games = [];
  } catch (e) { console.log('livegames failed: ' + e.message); continue; }
  console.log('live games: ' + games.length);
  const g = games[0];
  if (!g) continue;
  console.log('game keys: ' + Object.keys(g).slice(0, 40).join(','));
  console.log('sample: ' + short({ id: g.id, home: g.home_team || g.home, away: g.away_team || g.away, league: g.league, status: g.api_status, minute: g.current_minute, result: g.result }, 220));
  try {
    const detail = await api('/ajax/livegame/' + g.id, { retries: 1 });
    const rows = (Array.isArray(detail) ? detail : []).flatMap((grp) => (Array.isArray(grp) ? grp : []));
    const first = rows[0];
    if (!first) { console.log('detail: no rows'); continue; }
    console.log('detail: ' + rows.length + ' rows; result=' + short(first.result, 40) + ' minute=' + short(first.current_minute, 20) + ' status=' + short(first.api_status, 10));
    const markets = new Map();
    for (const r of rows) {
      const k = r.market_id + ' ' + r.market;
      if (!markets.has(k)) markets.set(k, []);
      markets.get(k).push(r.market_option + '@' + r.odd);
    }
    console.log('markets: ' + markets.size);
    let n = 0;
    for (const [k, opts] of markets) { if (n++ >= 12) break; console.log('  ' + short(k, 50) + ' -> ' + short(opts.slice(0, 4).join(' / '), 70)); }
  } catch (e) { console.log('detail failed: ' + e.message); }
}
process.exit(0);
