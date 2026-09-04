// LondonPro365 data provider for 365sim.
//
// Pulls every match, market, and coefficient from the londonpro365.com
// backend API (real host: eccoplay365.com) and stores it in matches_cache
// using the canonical The-Odds-API event shape the rest of the app consumes,
// so listing, match detail, bet verification, odds history, and settlement
// all work on this data without changes. A background loop syncs in-play
// scores and real-time odds movement from the livegames endpoint.
//
// Env:
//   LONDON365_ENABLED            1 (default) or 0
//   LONDON365_API                default https://eccoplay365.com
//   LONDON365_ORIGIN             default https://londonpro365.com
//   LONDON365_SPORTS             csv sport ids, or 'all' (default) to
//                                discover every sport the provider exposes
//   LONDON365_LEAGUES            league cap per sport, 0 = all
//   LONDON365_FULL               1 = fetch every market via detail endpoint
//   LONDON365_LIVE_INTERVAL_MS   default 30000 (min 10000)
//   LONDON365_IMPORT_THROTTLE_MS default 600000

import pool, { getKV, setKV } from './db.js';
import { diffOddsChanges } from './oddsUtils.js';
import { pushOddsChanged, pushGoal } from './ws.js';
import { settleMatch } from './matchSettlement.js';

const ENABLED = (process.env.LONDON365_ENABLED || '1') === '1';
const API_BASE = process.env.LONDON365_API || 'https://eccoplay365.com';
const SITE_ORIGIN = process.env.LONDON365_ORIGIN || 'https://londonpro365.com';
// 'all' (default) discovers every sport the provider exposes so no match is
// hidden; a csv like "1,2,5" restricts the import to those sport ids.
const SPORTS_RAW = (process.env.LONDON365_SPORTS || 'all').trim();
let resolvedSports = null;

export async function resolveSports() {
  if (resolvedSports) return resolvedSports;
  if (SPORTS_RAW !== 'all') {
    resolvedSports = SPORTS_RAW.split(',').map(Number).filter(Boolean);
    return resolvedSports;
  }
  try {
    const sports = await api('/ajax/sports');
    const ids = Array.isArray(sports) ? sports.map((s) => Number(s.id)).filter(Boolean) : [];
    resolvedSports = ids.length ? ids : [1];
  } catch (err) {
    console.error('[london365] sports discovery failed, falling back to Soccer:', err.message);
    resolvedSports = [1];
  }
  return resolvedSports;
}
const LEAGUE_LIMIT = Number(process.env.LONDON365_LEAGUES || 0);
const FULL_DETAIL = (process.env.LONDON365_FULL || '1') === '1';
const LIVE_INTERVAL_MS = Math.max(10000, Number(process.env.LONDON365_LIVE_INTERVAL_MS || 30000));
const IMPORT_THROTTLE_MS = Number(process.env.LONDON365_IMPORT_THROTTLE_MS || 600000);
const DETAIL_DELAY_MS = Math.max(0, Number(process.env.LONDON365_DETAIL_DELAY_MS || 150));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Origin: SITE_ORIGIN,
  Referer: SITE_ORIGIN + '/',
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

export function isLondon365Enabled() {
  return ENABLED;
}

// HTTP with gentle retry; the API intermittently answers "Something went wrong".
async function api(pathname, opts) {
  opts = opts || {};
  const retries = opts.retries || 3;
  let lastErr = null;
  for (let attempt = 1; attempt !== retries + 1; attempt++) {
    try {
      const resp = await fetch(API_BASE + pathname, {
        method: opts.method || 'GET',
        headers: HEADERS,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      const text = await resp.text();
      if (resp.ok === false) throw new Error('HTTP ' + resp.status);
      if (text.trim().toLowerCase().indexOf('something went wrong') === 0) throw new Error('API transient error');
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
      if (attempt !== retries) await new Promise(function (r) { setTimeout(r, 500 * attempt); });
    }
  }
  throw new Error('london365 api ' + pathname + ' failed: ' + (lastErr ? lastErr.message : 'unknown'));
}

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

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
// Same as slug() but joins words with a dash — used ONLY for the country
// segment of a league key, so a multi-word country ("Costa Rica", "Hong
// Kong", "Czech Republic") survives intact. leagueKey() then separates the
// country segment from the competition slug with a DOUBLE underscore, so
// the frontend can recover the full country name (dashes -> spaces)
// instead of a single-underscore split that only ever grabbed the first
// word and silently truncated every multi-word country to something like
// "Costa" or "Czech".
function slugDash(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// League name -> country token, using the SAME vocabulary as App.tsx's
// COUNTRY_TOKEN_LABELS/COUNTRY_TOKEN_ISO so a LondonPro365 league gets the
// correct flag and sidebar grouping instead of falling into "Të tjera".
//
// LondonPro365 (like most odds-feed scrapers) names leagues "Country:
// Competition" (e.g. "England: Premier League", "Egypt: Premier League").
// We now parse that country prefix directly instead of relying only on a
// short hand-picked list of competition-name keywords — the old approach
// only recognised ~18 well-known leagues and dumped EVERY other country
// (the huge majority of what this provider actually covers) into one
// generic "Të tjera" bucket. The keyword list below is kept as a fallback
// for names with no "Country:" prefix, and to catch continental
// competitions (Champions League, World Cup, etc.) even when they DO have
// a "Europe:"/"World:" style prefix.
const LEAGUE_COUNTRY_HINTS = [
  [/champions league|europa league|conference league|uefa|super cup/, 'uefa'],
  [/world cup|fifa|nations league/, 'fifa'],
  [/copa america|conmebol|libertadores|sudamericana/, 'conmebol'],
  [/premier league|championship|league one|league two|fa cup|efl/, 'england'],
  [/la liga|copa del rey|segunda/, 'spain'],
  [/serie a|serie b|coppa italia/, 'italy'],
  [/bundesliga|dfb.?pokal/, 'germany'],
  [/ligue 1|ligue 2|coupe de france/, 'france'],
  [/eredivisie/, 'netherlands'],
  [/primeira liga|liga portugal/, 'portugal'],
  [/jupiler|belgi/, 'belgium'],
  [/super lig|turk/, 'turkey'],
  [/super league.*greece|greek/, 'greece'],
  [/scottish|premiership/, 'scotland'],
  [/superliga.*shqip|kategoria superiore|albania/, 'albania'],
  [/mls|major league soccer/, 'usa'],
  [/liga mx/, 'mexico'],
  [/brasileirao|brazil/, 'brazil'],
];
// Raw "Country:" prefixes (as the provider writes them, lowercase) mapped
// to the SAME tokens App.tsx already knows how to label/flag. Anything not
// listed here still gets its own group (named after the raw country text)
// instead of being merged away — see leagueCountryToken() below.
const COUNTRY_NAME_TO_TOKEN = {
  england: 'england', spain: 'spain', italy: 'italy', germany: 'germany', france: 'france',
  usa: 'usa', 'united states': 'usa', brazil: 'brazil', argentina: 'argentina', portugal: 'portugal',
  netherlands: 'netherlands', holland: 'netherlands', belgium: 'belgium', turkey: 'turkey', greece: 'greece',
  scotland: 'scotland', switzerland: 'switzerland', austria: 'austria', denmark: 'denmark', sweden: 'sweden',
  norway: 'norway', russia: 'russia', poland: 'poland', mexico: 'mexico', japan: 'japan',
  'south korea': 'korea', korea: 'korea', china: 'china', australia: 'australia', chile: 'chile',
  colombia: 'colombia', albania: 'albania', croatia: 'croatia', serbia: 'serbia', romania: 'romania',
  ukraine: 'ukraine', 'saudi arabia': 'saudi', kosovo: 'kosovo',
  world: 'fifa', europe: 'uefa', international: 'uefa',
};
function leagueCountryToken(name) {
  const raw = String(name || '');
  const n = raw.toLowerCase();
  const colonIdx = raw.indexOf(':');
  if (colonIdx > 0) {
    const countryRaw = raw.slice(0, colonIdx).trim().toLowerCase();
    if (COUNTRY_NAME_TO_TOKEN[countryRaw]) return COUNTRY_NAME_TO_TOKEN[countryRaw];
    for (const [re, token] of LEAGUE_COUNTRY_HINTS) if (re.test(n)) return token;
    // Unknown country name — still give it its OWN token/group (falls back
    // to a title-cased label on the frontend) rather than merging into
    // "Të tjera" with hundreds of unrelated leagues.
    const slugged = slugDash(countryRaw);
    if (slugged) return slugged;
  }
  for (const [re, token] of LEAGUE_COUNTRY_HINTS) if (re.test(n)) return token;
  return 'other';
}

// Build the same provider_country_slug league key format The Odds API uses
// (e.g. soccer_italy_serie_a), so App.tsx's existing flag/grouping regex
// picks these up automatically with no frontend changes needed.
// Country segment first, THEN a double underscore, THEN the competition
// slug — the double underscore is the unambiguous boundary App.tsx uses to
// recover the full (possibly multi-word/dashed) country segment, instead
// of the old single-underscore format that only ever kept the country's
// first word.
export function leagueKey(name) {
  return 'l365_' + leagueCountryToken(name) + '__' + (slug(name) || 'league');
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
const CANONICAL_MARKETS = {
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
  const detail = await api('/ajax/livegame/' + gameId, { retries: 4 });
  const rows = [];
  const groups = Array.isArray(detail) ? detail : [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const m of group) {
      if (!m) continue;
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
  return rows;
}

function totalsOutcome(option) {
  const m = String(option || '').trim().match(/^(mbi|over|nen|under)\s*([0-9.]+)/i);
  if (!m) return null;
  const side = /^(mbi|over)$/i.test(m[1]) ? 'Over' : 'Under';
  const point = parseFloat(m[2]);
  if (Number.isNaN(point)) return null;
  return { name: side, point: point };
}

function outcomeFromOption(marketKey, option, ev) {
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

export function isoFromWholeDate(wholeDate, gameDate, gameTime) {
  const src = wholeDate || ((gameDate || '') + ' ' + (gameTime || ''));
  let iso = String(src).trim().replace(' ', 'T');
  // Treat naive provider timestamps as UTC so kickoff times are deterministic
  // regardless of the server's local timezone.
  if (iso && !/[zZ]$/.test(iso) && !/[+-]\d{2}:\d{2}$/.test(iso)) {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) iso += ':00';
    iso += 'Z';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

export function parseScore(result) {
  const m = String(result || '').match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  return { home: parseInt(m[1], 10), away: parseInt(m[2], 10) };
}

// UPCOMING when kickoff is in the future, LIVE otherwise. Math.sign keeps a
// literal greater-than glyph out of the source.
export function statusFromCommence(commenceTime) {
  return Math.sign(Date.parse(commenceTime) - Date.now()) === 1 ? 'UPCOMING' : 'LIVE';
}

// Persist one canonical event, recording odds movement into odds_history and
// pushing live updates over the existing WebSocket channel.
// Convert a provider minute like "48:37" or "72" into a match minute number.
export function minuteToNumber(minute) {
  if (!minute) return null;
  const m = String(minute).match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

async function upsertMatch(ev, league, status, liveScores, liveInfo) {
  return withDbLock(async () => {
    const now = Date.now();
    const { rows } = await pool.query(
      'SELECT raw_json, status, live_home_score, live_away_score, live_minute FROM matches_cache WHERE id = $1',
      [ev.id]
    );
    const existing = rows[0];

    let rawToStore = JSON.stringify(ev);
    if (existing) {
      try {
        const oldEv = JSON.parse(existing.raw_json);
        const oldCount = countOutcomes(oldEv);
        const newCount = countOutcomes(ev);
        // Live/socket payloads only carry the main markets. Instead of
        // discarding them (old behavior) or letting them clobber the full
        // catalog, merge them into the cached event: prices update for the
        // markets they carry, every other market and coefficient survives.
        let effective = ev;
        if (oldCount && Math.sign(newCount - oldCount) === -1) effective = mergeEvents(oldEv, ev);
        rawToStore = JSON.stringify(effective);
        const changes = diffOddsChanges(ev.id, oldEv, effective);
        for (const c of changes) {
          await pool.query(
            `INSERT INTO odds_history (match_id, market_id, selection_id, old_odds, new_odds, changed_by, reason, created_at)
             VALUES ($1,$2,$3,$4,$5,'SYSTEM','london365_refresh',$6)`,
            [c.matchId, c.marketId, c.selectionId, c.oldOdds, c.newOdds, now]
          );
        }
        if (changes.length) pushOddsChanged(ev.id, { changes: changes });
      } catch (err) {
        console.error('[london365] odds diff failed for ' + ev.id + ':', err.message);
      }
    }

    await pool.query(
      `INSERT INTO matches_cache (id, league, home_team, away_team, start_time, status, raw_json, fetched_at, live_home_score, live_away_score, live_minute, live_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET
         league = CASE WHEN excluded.league = '' THEN matches_cache.league ELSE excluded.league END,
         home_team = excluded.home_team,
         away_team = excluded.away_team,
         start_time = excluded.start_time,
         status = CASE WHEN matches_cache.status = 'FINISHED' THEN matches_cache.status ELSE excluded.status END,
         raw_json = excluded.raw_json,
         fetched_at = excluded.fetched_at,
         live_home_score = COALESCE(excluded.live_home_score, matches_cache.live_home_score),
         live_away_score = COALESCE(excluded.live_away_score, matches_cache.live_away_score),
         live_minute = COALESCE(excluded.live_minute, matches_cache.live_minute),
         live_status = COALESCE(excluded.live_status, matches_cache.live_status)`,
      [
        ev.id, league, ev.home_team, ev.away_team, ev.commence_time, status,
        rawToStore, now,
        liveScores ? liveScores.home : null,
        liveScores ? liveScores.away : null,
        liveInfo && liveInfo.minute ? liveInfo.minute : null,
        liveInfo && liveInfo.apiStatus != null ? String(liveInfo.apiStatus) : null,
      ]
    );
    return existing;
  });
}

// Count every outcome across a canonical event, used to detect an
// incomplete provider response before it can overwrite richer cached odds.
function countOutcomes(ev) {
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
function mergeEvents(oldEv, newEv) {
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
let marketNamesLoaded = false;
const marketNameById = new Map();

async function ensureMarketNamesLoaded() {
  if (marketNamesLoaded) return;
  marketNamesLoaded = true;
  try {
    const saved = await getKV('l365_market_names', {});
    for (const entry of Object.entries(saved || {})) marketNameById.set(entry[0], entry[1]);
  } catch (err) { /* KV not ready yet; names get learned during imports */ }
}

function rememberMarketName(marketId, name) {
  const key = String(marketId || '');
  if (key && name && !marketNameById.has(key)) marketNameById.set(key, decodeMarketName(name));
}

function hydrateRowNames(rows) {
  for (const r of rows) {
    if (!r.marketName && r.marketId) r.marketName = marketNameById.get(String(r.marketId)) || null;
  }
  return rows;
}

// Serialize DB writes across the full import, the live polling loop, and the
// Socket.IO feed so a slow import never interleaves partial odds with a
// live patch for the same match.
let dbWriteLock = Promise.resolve();
function withDbLock(fn) {
  const run = dbWriteLock.then(fn, fn);
  dbWriteLock = run.then(function () {}, function () {});
  return run;
}

// Record a goal exactly once: only when the score actually moved compared to
// what we last persisted (or when a first non-zero score appears). Repeated
// polls and socket ticks for the same score are no-ops.
async function recordGoalIfChanged(ev, score, minute, prev) {
  if (!score) return;
  const prevHome = prev ? prev.live_home_score : null;
  const prevAway = prev ? prev.live_away_score : null;
  const hadScoreBefore = prevHome != null && prevAway != null;
  const scoreChanged = hadScoreBefore
    ? (score.home !== prevHome || score.away !== prevAway)
    : Math.sign(score.home + score.away) === 1;
  if (!scoreChanged) return;
  const scoringTeam = hadScoreBefore && Math.sign(score.home - prevHome) === 1 ? ev.home_team : ev.away_team;
  const now = Date.now();
  await pool.query(
    `INSERT INTO match_events (match_id, minute, type, team, detail, created_at)
     VALUES ($1,$2,'GOAL',$3,$4,$5)`,
    [ev.id, minuteToNumber(minute), scoringTeam, score.home + '-' + score.away, now]
  );
  await pool.query(
    `INSERT INTO live_statistics (match_id, home_score, away_score, updated_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (match_id) DO UPDATE SET home_score = excluded.home_score, away_score = excluded.away_score, updated_at = excluded.updated_at`,
    [ev.id, score.home, score.away, now]
  );
  pushGoal(ev.id, { homeScore: score.home, awayScore: score.away, scoringTeam: scoringTeam, minute: minute || undefined });
}

let importRunning = false;
let socketConnected = false;

export function setLondon365SocketConnected(value) {
  socketConnected = !!value;
}

// Full import: every sport, then every league, then every match, every market.
export async function importLondon365(opts) {
  opts = opts || {};
  if (!ENABLED) throw new Error('LondonPro365 provider is disabled (LONDON365_ENABLED=0)');
  if (importRunning) return { skipped: true, reason: 'import already running' };
  importRunning = true;

  await ensureMarketNamesLoaded();
  const sports = opts.sports || (await resolveSports());
  const full = opts.full === undefined ? FULL_DETAIL : !!opts.full;
  const leagueCap = opts.leagues === undefined ? LEAGUE_LIMIT : Number(opts.leagues) || 0;
  const matchCap = Number(opts.matches) || 0;

  const leaguesSeen = new Set(await getKV('l365_leagues', []));
  let matchCount = 0;
  let coefficientCount = 0;
  let detailOkCount = 0;
  let detailFailCount = 0;

  try {
    for (const sid of sports) {
      let leagues;
      try {
        leagues = await api('/ajax/leagues/' + sid);
      } catch (err) {
        console.error('[london365] leagues sport ' + sid + ' failed:', err.message);
        continue;
      }
      if (!Array.isArray(leagues)) continue;
      if (leagueCap) leagues = leagues.slice(0, leagueCap);

      for (const league of leagues) {
        let games;
        try {
          games = await api('/ajax/gamesByLeague/' + league.id);
        } catch (err) {
          console.error('[london365] games for ' + league.name + ' failed:', err.message);
          continue;
        }
        if (!Array.isArray(games) || games.length === 0) continue;
        if (matchCap) games = games.slice(0, matchCap);

        for (const game of games) {
          let rows = [];
          if (full) {
            try {
              // Gentle pacing: hammering a real bookmaker backend with one
              // detail request per game, back-to-back, is exactly the
              // pattern anti-bot/rate-limit rules key on. A failed detail
              // fetch silently falls back to the sparse list-level odds
              // below; the periodic repairSparseEvents pass restores the
              // full market catalog for those games afterwards.
              if (DETAIL_DELAY_MS) await sleep(DETAIL_DELAY_MS);
              rows = await fetchDetailRows(game.id);
              detailOkCount++;
            } catch (err) {
              detailFailCount++;
              console.error('[london365] detail ' + game.id + ' failed (falling back to sparse list odds):', err.message);
            }
          }
          if (!rows.length) rows = parseOddString(game.odd);
          rows = hydrateRowNames(rows.filter(function (r) { return r ? !Number.isNaN(r.coef) : false; }));
          if (!rows.length) continue;

          const ev = buildEvent(
            game.id,
            game.home_team,
            game.away_team,
            isoFromWholeDate(game.whole_date, game.game_date, game.game_time),
            rows
          );
          await upsertMatch(ev, leagueKey(league.name), statusFromCommence(ev.commence_time), null);
          matchCount++;
          coefficientCount += rows.length;
          leaguesSeen.add(league.name);
        }
      }
    }
    await setKV('l365_leagues', Array.from(leaguesSeen));
    await setKV('l365_market_names', Object.fromEntries(marketNameById));
    await setKV('l365_last_import', Date.now());
    console.log(
      '[london365] import done: ' + matchCount + ' matches, ' + coefficientCount + ' coefficients, ' +
      leaguesSeen.size + ' leagues (full-detail fetch: ' + detailOkCount + ' ok / ' + detailFailCount + ' failed' +
      (full && detailFailCount > detailOkCount ? ' — MOSTLY FAILING, matches are likely showing only sparse list-level odds, not the full market catalog' : '') +
      ')'
    );
    return { matches: matchCount, coefficients: coefficientCount, leagues: leaguesSeen.size, detailOkCount, detailFailCount };
  } finally {
    importRunning = false;
  }
}

// Kick a throttled import in the background (never blocks an API request).
export function ensureLondon365Import() {
  if (!ENABLED) return;
  (async function () {
    const last = await getKV('l365_last_import', 0);
    const elapsed = Date.now() - last;
    if (Math.sign(IMPORT_THROTTLE_MS - elapsed) === 1) return;
    await setKV('l365_last_import', Date.now());
    try {
      await importLondon365();
    } catch (err) {
      console.error('[london365] background import failed:', err.message);
    }
  })();
}

// Live sync: in-play scores plus REAL-TIME FULL market catalog. The list
// endpoint (/ajax/livegames) only carries the packed 1X2 odds, but every
// live game exposes its complete market set on /ajax/livegame/{id} — same
// row shape as the prematch detail endpoint — so we fetch it per game and
// merge it into the cached event. Games that leave the live feed are
// auto-settled with their last known score so final results appear.
export async function syncLondon365Live() {
  if (!ENABLED) return { games: 0 };
  await ensureMarketNamesLoaded();
  let gamesSynced = 0;
  const liveIds = new Set();

  for (const sid of await resolveSports()) {
    let games;
    try {
      games = await api('/ajax/livegames', { method: 'POST', body: { sport: sid, market_type: 1 } });
    } catch (err) {
      console.error('[london365] livegames sport ' + sid + ' failed:', err.message);
      continue;
    }
    if (!Array.isArray(games)) continue;

    for (const g of games) {
      if (!g || !g.id) continue;
      liveIds.add('l365-' + g.id);
      let rows = [];
      try {
        if (DETAIL_DELAY_MS) await sleep(DETAIL_DELAY_MS);
        rows = await fetchLiveRows(g.id);
      } catch (err) {
        console.error('[london365] livegame detail ' + g.id + ' failed (falling back to packed list odds):', err.message);
      }
      if (!rows.length) rows = parseOddString(g.odd);
      const odds = hydrateRowNames(rows.filter(function (o) { return o ? !Number.isNaN(o.coef) : false; }));
      if (!odds.length) continue;
      const ev = buildEvent(g.id, g.home_team, g.away_team, isoFromWholeDate(g.whole_date, g.game_date, g.game_time), odds);
      const score = parseScore(g.result);
      const minute = g.current_minute || null;
      const prev = await upsertMatch(ev, g.league || '', 'LIVE', score, { minute: minute, apiStatus: g.api_status });
      await recordGoalIfChanged(ev, score, minute, prev);
      gamesSynced++;
    }
  }

  // End detection: a cached LIVE l365 match that is no longer in the live
  // feed and started >2.5h ago has finished — settle it with the last
  // known score so the final result shows on the right of the card.
  try {
    const { rows } = await pool.query(
      "SELECT id, live_home_score, live_away_score, start_time FROM matches_cache WHERE id LIKE 'l365-%' AND status = 'LIVE'"
    );
    const cutoff = Date.now() - 2.5 * 60 * 60 * 1000;
    for (const row of rows) {
      if (liveIds.has(row.id)) continue;
      if (Date.parse(row.start_time) > cutoff) continue;
      const home = row.live_home_score ?? 0;
      const away = row.live_away_score ?? 0;
      await pool.query("UPDATE matches_cache SET live_status = 'ended' WHERE id = $1", [row.id]);
      try {
        await settleMatch(row.id, home, away);
        console.log('[london365] auto-settled ' + row.id + ' ' + home + '-' + away);
      } catch (err) {
        console.error('[london365] auto-settle ' + row.id + ' failed:', err.message);
      }
    }
  } catch (err) {
    console.error('[london365] end detection failed:', err.message);
  }

  await setKV('l365_last_live_sync', Date.now());
  return { games: gamesSynced };
}

// --- Socket.IO feed handlers (called by london365Socket.js) ----------------
// The provider pushes real-time deltas over Socket.IO in addition to the REST
// snapshot the polling loop reads. These handlers patch the cached canonical
// event in place so odds move sub-second without a full re-fetch.

export async function applySocketCoefs(gameId, coefs) {
  const id = 'l365-' + gameId;
  return withDbLock(async () => {
    const { rows } = await pool.query('SELECT raw_json FROM matches_cache WHERE id = $1', [id]);
    if (!rows.length || !rows[0].raw_json) return 0;
    let ev;
    try { ev = JSON.parse(rows[0].raw_json); } catch (err) { return 0; }
    const byCoefId = new Map();
    for (const bm of ev.bookmakers || []) {
      for (const mk of bm.markets || []) {
        for (const o of mk.outcomes || []) byCoefId.set(String(o.id), { o: o, market: mk.key });
      }
    }
    const changes = [];
    for (const c of coefs || []) {
      const coefId = String(c.coef_id != null ? c.coef_id : (c.id != null ? c.id : ''));
      const price = parseFloat(c.coef != null ? c.coef : (c.odd != null ? c.odd : c.value));
      if (!coefId || Number.isNaN(price)) continue;
      const entry = byCoefId.get(coefId);
      if (!entry || entry.o.price === price) continue;
      changes.push({ matchId: id, marketId: entry.market, selectionId: coefId, oldOdds: entry.o.price, newOdds: price });
      entry.o.price = price;
    }
    if (!changes.length) return 0;
    const now = Date.now();
    for (const c of changes) {
      await pool.query(
        `INSERT INTO odds_history (match_id, market_id, selection_id, old_odds, new_odds, changed_by, reason, created_at)
         VALUES ($1,$2,$3,$4,$5,'SYSTEM','london365_socket',$6)`,
        [c.matchId, c.marketId, c.selectionId, c.oldOdds, c.newOdds, now]
      );
    }
    await pool.query('UPDATE matches_cache SET raw_json = $2, fetched_at = $3 WHERE id = $1', [id, JSON.stringify(ev), now]);
    pushOddsChanged(id, { changes: changes });
    return changes.length;
  });
}

export async function applySocketGame(g, status) {
  if (!g || !g.id) return false;
  await ensureMarketNamesLoaded();
  const odds = hydrateRowNames(parseOddString(g.odd).filter(function (o) { return o ? !Number.isNaN(o.coef) : false; }));
  if (!odds.length) return false;
  const commence = isoFromWholeDate(g.whole_date, g.game_date, g.game_time);
  const ev = buildEvent(g.id, g.home_team, g.away_team, commence, odds);
  const score = parseScore(g.result);
  const minute = g.current_minute || null;
  const resolved = status || (minute ? 'LIVE' : statusFromCommence(commence));
  const prev = await upsertMatch(ev, g.league || '', resolved, score, { minute: minute, apiStatus: g.api_status });
  await recordGoalIfChanged(ev, score, minute, prev);
  return true;
}

export async function markLondon365GameEnded(gameId) {
  const id = 'l365-' + gameId;
  return withDbLock(async () => {
    const res = await pool.query(
      `UPDATE matches_cache SET status = 'FINISHED', live_status = 'ended' WHERE id = $1 AND status = 'LIVE'`,
      [id]
    );
    return res ? res.rowCount : 0;
  });
}

export async function removeSocketCoef(gameId, coefId) {
  const id = 'l365-' + gameId;
  if (!coefId) return 0;
  return withDbLock(async () => {
    const { rows } = await pool.query('SELECT raw_json FROM matches_cache WHERE id = $1', [id]);
    if (!rows.length || !rows[0].raw_json) return 0;
    let ev;
    try { ev = JSON.parse(rows[0].raw_json); } catch (err) { return 0; }
    let removed = 0;
    for (const bm of ev.bookmakers || []) {
      for (const mk of bm.markets || []) {
        const before = (mk.outcomes || []).length;
        mk.outcomes = (mk.outcomes || []).filter(function (o) { return String(o.id) !== String(coefId); });
        removed += before - mk.outcomes.length;
      }
    }
    if (removed) await pool.query('UPDATE matches_cache SET raw_json = $2, fetched_at = $3 WHERE id = $1', [id, JSON.stringify(ev), Date.now()]);
    return removed;
  });
}

// Repair pass: the provider's detail endpoint intermittently fails on
// hosting (rate limits / transient "Something went wrong"), leaving cached
// l365 events with only the sparse list-level odds — 1-4 markets, names
// like "Market 6575". This re-fetches full detail for the OLDEST sparse
// events in bounded batches and replaces them, so the frontend eventually
// shows every LondonPro365 market and coefficient. Rotation via fetched_at
// guarantees one permanently-broken game can't block the queue.
let repairRunning = false;
export async function repairSparseEvents(opts) {
  opts = opts || {};
  if (!ENABLED || repairRunning) return { attempted: 0, repaired: 0 };
  repairRunning = true;
  const limit = Number(opts.limit) || 25;
  try {
    await ensureMarketNamesLoaded();
    const { rows } = await pool.query(
      "SELECT id, league, status, raw_json FROM matches_cache WHERE id LIKE 'l365-%' AND status != 'FINISHED' ORDER BY fetched_at ASC LIMIT $1",
      [limit * 3]
    );
    let attempted = 0;
    let repaired = 0;
    for (const row of rows) {
      if (repaired >= limit) break;
      let ev;
      try { ev = JSON.parse(row.raw_json); } catch (err) { continue; }
      if (!isSparseEvent(ev)) continue;
      const gameId = String(row.id).replace('l365-', '');
      attempted++;
      await pool.query('UPDATE matches_cache SET fetched_at = $2 WHERE id = $1', [row.id, Date.now()]);
      try {
        if (DETAIL_DELAY_MS) await sleep(DETAIL_DELAY_MS);
        // LIVE events must be repaired through the live endpoint — the
        // prematch detail returns zero rows once a game kicks off.
        const rawRows = row.status === 'LIVE' ? await fetchLiveRows(gameId) : await fetchDetailRows(gameId);
        const fresh = hydrateRowNames(rawRows.filter(function (r) { return r && !Number.isNaN(r.coef); }));
        if (fresh.length <= countOutcomes(ev)) continue;
        const newEv = buildEvent(gameId, ev.home_team, ev.away_team, ev.commence_time, fresh);
        await upsertMatch(newEv, row.league, row.status, null);
        repaired++;
      } catch (err) {
        console.error('[london365] repair ' + row.id + ' failed:', err.message);
      }
    }
    if (attempted) await setKV('l365_market_names', Object.fromEntries(marketNameById));
    if (repaired) console.log('[london365] repair pass: ' + repaired + '/' + attempted + ' sparse events restored to full detail');
    return { attempted: attempted, repaired: repaired };
  } finally {
    repairRunning = false;
  }
}

let liveTimer = null;

export function startLondon365LiveLoop() {
  if (!ENABLED || liveTimer) return;
  liveTimer = setInterval(function () {
    syncLondon365Live().catch(function (err) {
      console.error('[london365] live sync failed:', err.message);
    });
  }, LIVE_INTERVAL_MS);
  if (liveTimer.unref) liveTimer.unref();
  setTimeout(function () {
    syncLondon365Live().catch(function (err) {
      console.error('[london365] initial live sync failed:', err.message);
    });
  }, 5000);
  console.log('[london365] live loop started, every ' + LIVE_INTERVAL_MS + 'ms (sports: ' + (SPORTS_RAW === 'all' ? 'all discovered' : SPORTS_RAW) + ')');
}

export async function getLondon365Status() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS matches,
            COUNT(*) FILTER (WHERE status = 'LIVE')::int AS live
     FROM matches_cache WHERE id LIKE 'l365-%'`
  );
  return {
    enabled: ENABLED,
    socketConnected: socketConnected,
    apiBase: API_BASE,
    sports: resolvedSports || SPORTS_RAW,
    fullDetail: FULL_DETAIL,
    leagueLimit: LEAGUE_LIMIT,
    liveIntervalMs: LIVE_INTERVAL_MS,
    matches: rows[0].matches,
    liveMatches: rows[0].live,
    lastImport: await getKV('l365_last_import', 0),
    lastLiveSync: await getKV('l365_last_live_sync', 0),
    leagues: (await getKV('l365_leagues', [])).length,
  };
}
