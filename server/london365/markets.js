// Provider markets and odds: market names, canonical market keys, outcome mapping, building the event shape.
import { sampleFeedKeys } from '../feedKeySampler.js';
import { getKV } from '../db.js';
import { slug } from './leagueKeys.js';
import { api } from './api.js';

// Packed odds string on list responses (livegames omit the market name):
// coefId | coef | option | marketId | MarketName , ...
export function parseOddString(s) {
  if (!s) return [];
  return String(s).split(',').map(function (part) {
    const f = part.split('|');
    const coefId = f[0];
    const coef = parseFloat(f[1]);
    if (!coefId || Number.isNaN(coef)) return null;
    return {
      coefId: coefId.trim(),
      coef: coef,
      option: (f[2] || '').trim(),
      marketId: (f[3] || '').trim(),
      marketName: (f[4] || '').trim() || null,
    };
  }).filter(Boolean);
}
// Decode the HTML entities the provider embeds in market names. Built with
// String.fromCharCode so no raw ampersand appears in this source file.
export function decodeMarketName(s) {
  const amp = String.fromCharCode(38);
  return String(s || '')
    .split(amp + 'amp;').join(amp)
    .split(amp + 'quot;').join(String.fromCharCode(34))
    .split(amp + '#039;').join(String.fromCharCode(39))
    .split(amp + '#39;').join(String.fromCharCode(39));
}
// Canonical keys are reserved ONLY for the exact match-level main markets
// whose settlement and Albanian translation logic we understand. Every other
// provider market gets its OWN unique key (name + provider marketId) so all
// ~100 markets and 900+ coefficients survive to the frontend instead of being
// collapsed by a loose keyword match and then deduplicated away — the old
// rules merged e.g. "Rezultati Pjeses se Pare", "Booking 1x2" and the final
// 1X2 into one h2h bucket, silently dropping most of their coefficients.
export const CANONICAL_MARKETS = {
  'rezultat final': 'h2h',
  'rezultati final': 'h2h',
  '1x2': 'h2h',
  'dopio shans': 'double_chance',
  'double chance': 'double_chance',
  'totali i golave': 'totals',
  'gol/jogol': 'btts',
  'gol-jogol': 'btts',
  'handikap': 'spreads',
  'home no bet': 'draw_no_bet',
  'away no bet': 'draw_no_bet',
};
// The set of canonical keys, used by buildEvent to detect when two DIFFERENT
// provider market ids claim the same canonical name — the second one is then
// given its own unique key instead of being merged (and deduplicated) away.
export const CANONICAL_KEYS = new Set(Object.values(CANONICAL_MARKETS));
export function mapMarketKey(name, marketId) {
  const n = decodeMarketName(name).toLowerCase().trim();
  if (CANONICAL_MARKETS[n]) return CANONICAL_MARKETS[n];
  if (!n) return 'other';
  return slug(n) + (marketId ? '_m' + marketId : '');
}
// A cached event is "sparse" when its detail fetch failed and we only have
// the few list-level markets (or unnamed "Market <id>" fallbacks). These are
// the rows the repair pass re-fetches with full detail so every market and
// coefficient finally reaches the frontend.
export function isSparseEvent(ev) {
  const markets = (ev && ev.bookmakers && ev.bookmakers[0] && ev.bookmakers[0].markets) || [];
  if (!markets.length) return true;
  let outcomes = 0;
  for (const m of markets) {
    outcomes += (m.outcomes || []).length;
    if (!m.label || /^Market \d+$/.test(m.label)) return true;
  }
  return outcomes < 10;
}
// Fetch every market of one game from the detail endpoint. Shared by the
// main import and the repair pass. Extra retries because the provider
// intermittently answers "Something went wrong" under load — a failed
// detail fetch is exactly what silently drops ~90 markets per match.
export async function fetchDetailRows(gameId) {
  const detail = await api('/ajax/prematchgame/' + gameId, { retries: 5 });
  const rows = [];
  if (Array.isArray(detail)) {
    for (const market of detail) {
      if (!Array.isArray(market)) continue;
      for (const m of market) {
        rememberMarketName(m.market_id, m.market);
        rows.push({
          coefId: String(m.id),
          coef: parseFloat(m.odd),
          option: (m.market_option || '').trim(),
          marketId: String(m.market_id),
          marketName: m.market || null,
          category: m.mainCategory ? decodeMarketName(m.mainCategory) : null,
        });
      }
    }
  }
  return rows;
}
// Live games expose their full market catalog on a different endpoint:
// /ajax/livegame/{id} returns every market (with real names, live prices,
// current minute and score) for an in-play game — /ajax/prematchgame/{id}
// returns zero rows once a game kicks off. Same row shape as
// fetchDetailRows so buildEvent, the repair pass and the live loop share it.
export async function fetchLiveRows(gameId) {
  const detail = await api('/ajax/livegame/' + gameId, { retries: 2 });
  const rows = [];
  const groups = Array.isArray(detail) ? detail : [];
  // The detail response repeats result/current_minute/api_status on every
  // single market row (confirmed against the live provider — real payload,
  // 2026-09-10). These are the ONLY reliably-populated source for live score
  // and clock; the /ajax/livegames LIST endpoint's own g.result/g.current_minute
  // (used as a fallback by callers) is not confirmed and was leaving the
  // on-screen minute/score empty. Captured once from the first row and
  // attached as rows.meta below — attaching a property to the array instead
  // of changing the return shape keeps every existing caller (which treats
  // the result as a plain array) working unmodified.
  let meta = null;
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const m of group) {
      if (!m) continue;
      if (!meta) {
        sampleFeedKeys('rest.livegame.row', m); // first row only: which fields exist (names, logos, ...)
        meta = {
          minute: m.current_minute || null,
          result: m.result || null,
          apiStatus: m.api_status != null ? String(m.api_status) : null,
        };
      }
      rememberMarketName(m.market_id, m.market);
      rows.push({
        coefId: String(m.id),
        coef: parseFloat(m.odd),
        option: (m.market_option || '').trim(),
        marketId: String(m.market_id),
        marketName: m.market || null,
        category: m.mainCategory ? decodeMarketName(m.mainCategory) : null,
      });
    }
  }
  rows.meta = meta;
  return rows;
}
export function totalsOutcome(option) {
  const m = String(option || '').trim().match(/^(mbi|over|nen|under)\s*([0-9.]+)/i);
  if (!m) return null;
  const side = /^(mbi|over)$/i.test(m[1]) ? 'Over' : 'Under';
  const point = parseFloat(m[2]);
  if (Number.isNaN(point)) return null;
  return { name: side, point: point };
}
export function outcomeFromOption(marketKey, option, ev) {
  const o = String(option || '').trim();
  if (marketKey === 'h2h') {
    if (o === '1') return { name: ev.home_team };
    if (o === 'X') return { name: 'Draw' };
    if (o === '2') return { name: ev.away_team };
    return { name: o };
  }
  if (marketKey === 'totals') {
    const t = totalsOutcome(o);
    if (t) return t;
    return { name: o };
  }
  if (marketKey === 'spreads') {
    const t = totalsOutcome(o);
    if (t) return { name: ev.home_team, point: t.point };
    return { name: o };
  }
  return { name: o };
}
// Build a canonical event object (The Odds API shape) from parsed odds rows.
export function buildEvent(gameId, homeTeam, awayTeam, commenceTime, rows) {
  const ev = {
    id: 'l365-' + gameId,
    home_team: homeTeam,
    away_team: awayTeam,
    commence_time: commenceTime,
    completed: false,
    bookmakers: [{ title: 'LondonPro365', markets: [] }],
  };
  const byKey = new Map();
  const canonicalOwner = new Map(); // canonical key -> marketId of first claim
  for (const r of rows) {
    const marketName = decodeMarketName(r.marketName || r.market || ('Market ' + r.marketId));
    let key = mapMarketKey(marketName, r.marketId);
    if (CANONICAL_KEYS.has(key)) {
      const owner = canonicalOwner.get(key);
      if (owner === undefined) canonicalOwner.set(key, r.marketId);
      else if (owner !== String(r.marketId)) key = slug(marketName) + '_m' + r.marketId;
    }
    // The card must show ONLY 1/X/2. Some provider markets named like the
    // final result also carry correct-score / HTFT options; those get their
    // own bucket instead of polluting h2h (no coefficient is lost).
    if (key === 'h2h') {
      const opt = String(r.option || '').trim();
      if (opt !== '1' && opt !== 'X' && opt !== '2') key = slug(marketName) + '_m' + r.marketId;
    }
    if (!byKey.has(key)) byKey.set(key, { key: key, label: marketName, category: r.category || null, outcomes: [] });
    const opt = outcomeFromOption(key, r.option, ev);
    byKey.get(key).outcomes.push({ name: opt.name, price: r.coef, point: opt.point, id: r.coefId });
  }
  ev.bookmakers[0].markets = Array.from(byKey.values()).map(function (m) {
    return { key: m.key, label: m.label, category: m.category, outcomes: m.outcomes };
  });
  return ev;
}
// Count every outcome across a canonical event, used to detect an
// incomplete provider response before it can overwrite richer cached odds.
export function countOutcomes(ev) {
  let n = 0;
  const bookmakers = (ev && ev.bookmakers) || [];
  for (const bm of bookmakers) {
    const markets = bm.markets || [];
    for (const mk of markets) n += (mk.outcomes || []).length;
  }
  return n;
}
// Merge a (usually partial) live event into the richer cached event:
// outcomes are matched by provider coefId, prices updated, unknown markets
// appended, everything else left untouched.
export function mergeEvents(oldEv, newEv) {
  const merged = JSON.parse(JSON.stringify(oldEv));
  const markets = (merged.bookmakers && merged.bookmakers[0] && merged.bookmakers[0].markets) || [];
  const byKey = new Map(markets.map(function (m) { return [m.key, m]; }));
  const newMarkets = (newEv.bookmakers && newEv.bookmakers[0] && newEv.bookmakers[0].markets) || [];
  for (const nm of newMarkets) {
    const old = byKey.get(nm.key);
    if (!old) { markets.push(nm); byKey.set(nm.key, nm); continue; }
    // Match by provider coefId first; the provider can issue a fresh coefId
    // for the same outcome between prematch and live, so also fall back to
    // the outcome identity (name + point) to avoid duplicate rows.
    const byId = new Map((old.outcomes || []).map(function (o) { return [String(o.id), o]; }));
    const byIdentity = new Map((old.outcomes || []).map(function (o) { return [String(o.name) + '|' + (o.point != null ? o.point : ''), o]; }));
    for (const no of nm.outcomes || []) {
      const identity = String(no.name) + '|' + (no.point != null ? no.point : '');
      const ex = byId.get(String(no.id)) || byIdentity.get(identity);
      if (ex) {
        ex.price = no.price;
        if (no.point !== undefined) ex.point = no.point;
        ex.id = no.id;
      } else {
        (old.outcomes = old.outcomes || []).push(no);
        byId.set(String(no.id), no);
        byIdentity.set(identity, no);
      }
    }
  }
  return merged;
}
// The livegames/socket packed odd strings omit the market NAME (only the
// marketId is present). Learn names from the detail responses so a live row
// for market 1 maps to the same canonical 'h2h' key as the full import
// instead of creating a duplicate 'market_1' bucket.
export let marketNamesLoaded = false;
export const marketNameById = new Map();
export async function ensureMarketNamesLoaded() {
  if (marketNamesLoaded) return;
  marketNamesLoaded = true;
  try {
    const saved = await getKV('l365_market_names', {});
    for (const entry of Object.entries(saved || {})) marketNameById.set(entry[0], entry[1]);
  } catch (err) { /* KV not ready yet; names get learned during imports */ }
}
export function rememberMarketName(marketId, name) {
  const key = String(marketId || '');
  if (key && name && !marketNameById.has(key)) marketNameById.set(key, decodeMarketName(name));
}
export function hydrateRowNames(rows) {
  for (const r of rows) {
    if (!r.marketName && r.marketId) r.marketName = marketNameById.get(String(r.marketId)) || null;
  }
  return rows;
}
