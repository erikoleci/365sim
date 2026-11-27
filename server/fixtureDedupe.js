// Fixture de-duplication safety net (moved out of routes/matches.js so it can be
// unit-tested and reused by the audit script).
//
// LondonPro365 is the ONLY match source. Every row's id is 'l365-<gameId>', which
// is unique per provider record -- but the SAME real fixture can exist under two
// provider ids (e.g. the pre-match catalogue record with the full market list and
// the in-play record that actually receives the score/minute). A pre-match record
// whose kickoff has passed is reported as LIVE by normalizeStatus() even though it
// never receives live data, so both rows look "LIVE" and must be merged.
//
// Two rules matter here:
//   1. The merged match keeps the richer odds (and its id), but its LIVE fields
//      (score, minute, status code, "estimated" flag) must come from whichever
//      duplicate really has provider live data -- never from the empty duplicate.
//      Before this, an equal-status duplicate with a stale/empty score could win
//      and the list showed 0-0 / "~40:19" while the other record had 5-1 / 75:39.
//   2. Teams that differ by a qualifier (U21, Women, II, Reserves...) are NOT the
//      same fixture even though their names are textually close ("Chelsea" vs
//      "Chelsea W"), otherwise a men's match would absorb a women's/youth match.

function outcomeCount(m) {
  let n = 0;
  for (const mk of m.markets || []) n += (mk.options || []).length;
  return n;
}

// Options that can actually be bet on right now (not locked/suspended). A pre-match catalogue row of a
// game that already started keeps every market at 1.00 (locked), while the in-play row carries the real
// prices -- the locked row must not win just because it lists as many (or more) markets.
function openOutcomeCount(m) {
  let n = 0;
  for (const mk of m.markets || []) for (const o of mk.options || []) if (!o.suspended) n++;
  return n;
}

// The same city written in the local language by one feed and in English by the other.
const CITY_ALIAS = { praha: 'prague', muenchen: 'munich', munchen: 'munich', wien: 'vienna', kobenhavn: 'copenhagen', bruxelles: 'brussels', brussel: 'brussels', antwerpen: 'antwerp', lisboa: 'lisbon', cologne: 'koln' };
function normTeamRaw(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss').replace(/ł/g, 'l').replace(/đ/g, 'd').replace(/ı/g, 'i') // letters NFD does not decompose
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^1\.?\s/, '') // "1. FC Koeln" / "FC Koeln"
    .replace(/\b(praha|muenchen|munchen|wien|kobenhavn|bruxelles|brussel|antwerpen|lisboa|cologne)\b/g, (w) => CITY_ALIAS[w]) // the same city, written differently by the two providers
    .replace(/\bsint\b/g, 'st') // Dutch / Belgian "Sint-Truidense" = "St. Truidense"
    .replace(/\b(fc|cf|sc|ac|afc|fk|if|bk|sk|cd|sd|ud|club|hnk|nk|vv)\b/g, ' ') // legal tags: Croatian HNK / NK, Dutch VV
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
// These helpers are pure and run millions of times per list refresh on the same few thousand names (the profile of the
// busy server put normTeam and the name comparison at ~35% of all CPU), so each result is remembered.
const NAME_MEMO_MAX = 50000;
const normMemo = new Map();
export function normTeam(s) {
  const key = String(s || '');
  let v = normMemo.get(key);
  if (v === undefined) {
    v = normTeamRaw(key);
    if (normMemo.size >= NAME_MEMO_MAX) normMemo.clear();
    normMemo.set(key, v);
  }
  return v;
}

// Qualifier tokens that make two similar names DIFFERENT teams.
const QUALIFIER_RE = /\b(u\s?\d{2}|women|womens|ladies|w|ii|iii|b|c|reserves?|youth|juniors?|jr)\b/g;
function teamQualifierRaw(name) {
  const norm = normTeam(name).replace(/\bu\s(\d{2})\b/g, 'u$1');
  const found = norm.match(QUALIFIER_RE) || [];
  return Array.from(new Set(found.map((q) => (q === 'womens' || q === 'ladies' ? 'women' : q.replace(/^juniors?$/, 'jr'))))).sort().join('|');
}
const qualMemo = new Map();
export function teamQualifier(name) {
  const key = String(name || '');
  let v = qualMemo.get(key);
  if (v === undefined) {
    v = teamQualifierRaw(key);
    if (qualMemo.size >= NAME_MEMO_MAX) qualMemo.clear();
    qualMemo.set(key, v);
  }
  return v;
}
function stripQualifier(norm) {
  return norm.replace(/\bu\s(\d{2})\b/g, 'u$1').replace(QUALIFIER_RE, ' ').replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
function teamSim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

// The provider names the same club differently per record ("Manchester City" / "Man City",
// "Man Utd" / "Manchester United"). Plain letter similarity scores those ~0.5, so the two records
// of one match were never merged and the list showed the fixture twice. Same number of words,
// every word equal or an abbreviation (prefix of 3+ letters) of the other, at least one equal.
const TOKEN_ALIASES = { utd: 'united', nottm: 'nottingham', wolves: 'wolverhampton', spurs: 'tottenham' };
function abbrevEqual(a, b) {
  const ta = a.split(' ').filter(Boolean).map((t) => TOKEN_ALIASES[t] || t);
  const tb = b.split(' ').filter(Boolean).map((t) => TOKEN_ALIASES[t] || t);
  if (ta.length !== tb.length) {
    // "Tottenham" / "Tottenham Hotspur", "Newcastle" / "Newcastle United": the shorter name is
    // the first word(s) of the longer one, spelled exactly (and long enough not to be "Inter").
    const [s, l] = ta.length < tb.length ? [ta, tb] : [tb, ta];
    return s.join(' ').length >= 6 && s.every((t, i) => t === l[i]);
  }
  if (ta.length < 2) return false;
  let exact = 0;
  for (let i = 0; i < ta.length; i++) {
    if (ta[i] === tb[i]) { exact++; continue; }
    const [s, l] = ta[i].length <= tb[i].length ? [ta[i], tb[i]] : [tb[i], ta[i]];
    if (s.length < 3 || !l.startsWith(s)) return false;
  }
  return exact >= 1;
}

// "Sheffield Utd" / "Sheffield Wed" differ by 2 letters (similarity 0.85) yet are two clubs: when two
// names have the same number of words, share all but ONE, and that word is not an abbreviation
// of the other, they are different clubs no matter how similar the letters look.
function differsByOneUnrelatedWord(a, b) {
  const ta = a.split(' ').filter(Boolean).map((t) => TOKEN_ALIASES[t] || t);
  const tb = b.split(' ').filter(Boolean).map((t) => TOKEN_ALIASES[t] || t);
  if (ta.length !== tb.length || ta.length < 2) return false;
  const diff = ta.map((t, i) => [t, tb[i]]).filter(([x, y]) => x !== y);
  if (diff.length !== 1) return false;
  const [s, l] = diff[0][0].length <= diff[0][1].length ? diff[0] : [diff[0][1], diff[0][0]];
  return !(s.length >= 3 && l.startsWith(s));
}

// Spelling variants the feeds disagree on: "Koege"/"Koge" (ø), "Koeln"/"Koln" (ö), word order ("Aarhus GF"/"GF Aarhus"), and an
// initialism glued to the city ("AGF Aarhus"/"Aarhus GF"). Only ever called AFTER the qualifier check, and a name that differs
// by one unrelated word ("Sheffield Utd"/"Sheffield Wed") still never matches.
const foldVowelE = (n) => n.replace(/([aou])e/g, '$1');
function looseSameName(a, b) {
  const fa = foldVowelE(a), fb = foldVowelE(b);
  if (fa === fb || (fa.length >= 5 && teamSim(fa, fb) >= 0.85 && !differsByOneUnrelatedWord(fa, fb))) return true;
  const ta = a.split(' ').filter(Boolean), tb = b.split(' ').filter(Boolean);
  if (ta.length >= 2 && ta.length === tb.length && [...ta].sort().join(' ') === [...tb].sort().join(' ')) return true;
  const common = ta.filter((t) => tb.includes(t) && t.length >= 4);
  if (common.length === 1) {
    const ra = ta.filter((t) => t !== common[0]), rb = tb.filter((t) => t !== common[0]);
    if (ra.length === 1 && rb.length === 1) {
      const [sh, lo] = ra[0].length <= rb[0].length ? [ra[0], rb[0]] : [rb[0], ra[0]];
      const pre = lo.slice(0, lo.length - sh.length);
      if (sh.length >= 2 && pre.length >= 1 && lo.endsWith(sh) && common[0].startsWith(pre)) return true; // agf = a + gf, city aarhus
    }
  }
  return false;
}

// One feed writes the club with its legal prefix, the other without: "SSC Napoli" / "Napoli", "AS Monaco" / "Monaco", "AJ Auxerre" /
// "Auxerre", "RC Strasbourg" / "Strasbourg". (fc / sc / ac / cf ... are already dropped by normTeam.) Only a prefix followed by a real
// name word (4+ letters) is dropped, and it is only used to compare a name that HAS a prefix with one that has none or another.
const CLUB_PREFIX_RE = /^(?:ssc|ssd|ss|asd|as|us|rc|aj|ogc|ca|ssv|tsv|vfb|vfl|tsg|fsv|scu|sl|gd|cs|bsc|sv|sg|kv|rsc|rfc)\s+(?=\S{4,})/;
// What the player sees: the club without its legal prefix ("SSC Napoli" -> "Napoli", "SL Benfica" -> "Benfica"). Display only: the stored
// name is untouched, and a ticket still finds its match because sameTeam already treats both spellings as one club.
const CLUB_PREFIX_DISPLAY_RE = new RegExp(CLUB_PREFIX_RE.source, 'i');
export function displayClubName(name) {
  const s = String(name ?? '');
  return s.replace(CLUB_PREFIX_DISPLAY_RE, '').trim() || s;
}
// A short all-letters name that is the initials of the other's words: "PSG" / "Paris Saint-Germain". The provider's live feed
// writes some clubs that way, and the two records of one match stayed apart (one with the live prices, one without).
// Only when the long name has at least three words, so "AS Roma" / "ASR" style guesses never fire on short names.
function initialsOfOther(short, long) {
  if (!/^[a-z]{2,4}$/.test(short)) return false;
  const words = long.split(' ').filter(Boolean);
  if (words.length < 3 || words.length > 5) return false;
  return words.map((w) => w[0]).join('') === short;
}
// "KuPS Kuopio" / "Kuopion Palloseura": one feed writes the club's short name + the city, the other the full name with the city in its
// Finnish form. Only this narrow shape: A = [short, city], B = [cityForm, rest], where the city is the start of B's first word, the short
// name (3-5 letters) begins like B's first word and is made of letters of B in order. Two plain different clubs do not fit it.
function shortPlusCityOfOther(a, b) {
  const ta = a.split(' ').filter(Boolean); const tb = b.split(' ').filter(Boolean);
  if (ta.length !== 2 || tb.length !== 2) return false;
  const [x, w] = ta; const [y, z] = tb;
  if (!/^[a-z]{3,5}$/.test(x) || w.length < 5 || !y.startsWith(w) || y === w) return false;
  if (x.slice(0, 2) !== y.slice(0, 2)) return false;
  let i = 0; for (const ch of y + z) if (i < x.length && ch === x[i]) i++;
  return i === x.length;
}
const dropClubPrefix = (n) => n.replace(CLUB_PREFIX_RE, '');
// The same legal tag written AFTER the name by one feed: "Lille" / "Lille OSC", "Hertha" / "Hertha BSC". Only these tags, only as the
// last word, and only when the name before it is a single real word (4+ letters), so "Lille OSC" never joins "Lille Metropole" etc.
const CLUB_SUFFIX_RE = /^(\S{4,})\s+(?:osc|hsc|bsc|ssc|rsc|tsg|vfb|vfl)$/;
function sameWithoutSuffix(nx, ny) {
  const mx = nx.match(CLUB_SUFFIX_RE), my = ny.match(CLUB_SUFFIX_RE);
  if (mx && !my) return mx[1] === ny;
  if (my && !mx) return my[1] === nx;
  return false;
}

function sameTeamRaw(x, y) {
  if (teamQualifier(x) !== teamQualifier(y)) return false;
  const nx = stripQualifier(normTeam(x));
  const ny = stripQualifier(normTeam(y));
  if (nx.length >= 4 && foldVowelE(nx) === foldVowelE(ny)) return true; // spelling only (ø / ö written oe)
  if (differsByOneUnrelatedWord(nx, ny)) return false;
  if (teamSim(nx, ny) >= 0.8 || abbrevEqual(nx, ny) || looseSameName(nx, ny)) return true;
  if (initialsOfOther(nx, ny) || initialsOfOther(ny, nx)) return true; // "PSG" = Paris Saint-Germain
  if (sameWithoutSuffix(nx, ny)) return true; // "Lille" = "Lille OSC"
  if (shortPlusCityOfOther(nx, ny) || shortPlusCityOfOther(ny, nx)) return true; // "KuPS Kuopio" = "Kuopion Palloseura"
  const px = dropClubPrefix(nx), py = dropClubPrefix(ny);
  if (px === nx && py === ny) return false;
  if (px.length < 4 || py.length < 4) return false;
  if (px.split(' ').length !== py.split(' ').length) return false; // the prefix path only joins names of the same length (SL Benfica must not join Benfica Castelo Branco)
  if (foldVowelE(px) === foldVowelE(py)) return true;
  if (differsByOneUnrelatedWord(px, py)) return false;
  return teamSim(px, py) >= 0.8 || abbrevEqual(px, py) || looseSameName(px, py);
}

export const __sameTeamRaw = sameTeamRaw; // for tests: the same answer without the memory
// Every pair of names is judged once and remembered for good. One list refresh compares ~1-2 million pairs of the same few
// thousand names (each match against every match within 3 hours of its kick-off). The old memo was a Map keyed by the two
// strings and emptied at 200 000 entries, so it was emptied again and again inside ONE refresh and every refresh recomputed
// the Levenshtein of all of them (measured on the busy server: ~80% of all CPU, and 7 s per refresh on a 2700-match list).
// Names are numbered; the answer for the pair (a, b) lives in one byte of a table: 0 not judged yet, 1 different, 2 same.
// Same answers as sameTeamRaw, only remembered. 8192 distinct names = 64 MB; past that the table starts over.
const PAIR_CAP = 8192;
const nameIds = new Map();
let pairState = null;
export const __resetPairMemoForTests = () => { nameIds.clear(); if (pairState) pairState.fill(0); };
export function sameTeam(x, y) {
  const a = String(x || ''), b = String(y || '');
  if (!pairState) pairState = new Uint8Array(PAIR_CAP * PAIR_CAP);
  if (nameIds.size >= PAIR_CAP - 1) { nameIds.clear(); pairState.fill(0); }
  let ia = nameIds.get(a);
  if (ia === undefined) { ia = nameIds.size; nameIds.set(a, ia); }
  let ib = nameIds.get(b);
  if (ib === undefined) { ib = nameIds.size; nameIds.set(b, ib); }
  const k = ia * PAIR_CAP + ib;
  let v = pairState[k];
  if (v === 0) { v = sameTeamRaw(a, b) ? 2 : 1; pairState[k] = v; }
  return v === 2;
}

export function sameFixture(a, b) {
  const direct = sameTeam(a.homeTeam, b.homeTeam) && sameTeam(a.awayTeam, b.awayTeam);
  const swapped = sameTeam(a.homeTeam, b.awayTeam) && sameTeam(a.awayTeam, b.homeTeam);
  return direct || swapped;
}

// Names the two feeds write differently, joined by what cannot differ: a club plays ONE match at a time. Kick-off within 10 minutes
// and one side is the same club (sameTeam) means the same fixture, provided the other sides are at least related names: they share
// a word, or the first three letters of a word of 4+ letters ("Man Utd" / "Manchester United"), or one is the initials of the other.
// This catches the next odd spelling without listing it. Same qualifier rules as sameTeam (women, U19, B team never join the senior side).
const LOOSE_WINDOW_MS = 10 * 60 * 1000;
const stemsCache = new Map();
function nameStems(name) {
  const key = String(name || '');
  let v = stemsCache.get(key);
  if (!v) {
    v = new Set();
    for (const w of normTeam(key).split(' ')) if (w.length >= 4) v.add(w.slice(0, 3));
    for (const w of nameWords(key)) v.add(w);
    if (stemsCache.size > 20000) stemsCache.clear();
    stemsCache.set(key, v);
  }
  return v;
}
function relatedNames(x, y) {
  if (teamQualifier(x) !== teamQualifier(y)) return false;
  const nx = stripQualifier(normTeam(x)), ny = stripQualifier(normTeam(y));
  if (nx.length < 2 || ny.length < 2) return false;
  if (initialsOfOther(nx, ny) || initialsOfOther(ny, nx)) return true;
  const sx = nameStems(x), sy = nameStems(y);
  for (const w of sx) if (sy.has(w)) return true;
  return false;
}
export function sameFixtureLoose(a, b) {
  const pairs = [[a.homeTeam, b.homeTeam, a.awayTeam, b.awayTeam], [a.homeTeam, b.awayTeam, a.awayTeam, b.homeTeam]];
  for (const [x1, y1, x2, y2] of pairs) {
    if (sameTeam(x1, y1) && relatedNames(x2, y2)) return true;
    if (sameTeam(x2, y2) && relatedNames(x1, y1)) return true;
  }
  return false;
}

// A record whose TEAM names lost their qualifier ("Serbia" / "Azerbaijan" in a women's U19 qualifier) while the other record keeps it
// ("Serbia U19 (W)"): the league still says women / U19. When both leagues name the same qualifier(s), the names are compared without
// qualifiers, at the same kick-off (10 min). Two leagues without any qualifier never take this path.
function leagueQualifier(league) {
  const l = String(league || '').toLowerCase();
  const q = [];
  if (/women|ladies|feminin/.test(l)) q.push('women');
  const u = l.match(/(?:^|[^a-z0-9])u[\s_-]?(\d{2})(?![0-9])/);
  if (u) q.push('u' + u[1]);
  return q.join('|');
}
const bareName = (n) => stripQualifier(normTeam(n));
// Spelling variants on BOTH sides ("Shortan Guzor - Olympic Mobiuz" / "PFC Shurtan - Olimpik Mobiuz"): after dropping words every club has
// (pfc, fc, united, olimpik ...) one side must be almost the same name (>= 0.9 of its letter pairs) and the other clearly related (>= 0.5).
// Measured on a real day of the feed: the real twin scored 1.00 / 0.57, every pair of different matches stayed under 0.45.
const GENERIC_WORDS = new Set(['pfc', 'fk', 'fc', 'utd', 'united', 'city', 'town', 'club', 'sc', 'ac', 'u20', 'u19', 'u21', 'w', 'women', 'real', 'sporting', 'athletic', 'atletico', 'dynamo', 'dinamo', 'olympic', 'olimpik']);
const coreGramsCache = new Map(); // name -> Set of letter pairs of its core name (null when nothing is left)
function coreGrams(name) {
  const key = String(name || '');
  let g = coreGramsCache.get(key);
  if (g === undefined) {
    const n = normTeam(key).split(' ').filter((w) => w && !GENERIC_WORDS.has(w)).join(' ');
    if (!n) g = null;
    else { const t = ' ' + n + ' '; g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); }
    if (coreGramsCache.size > 20000) coreGramsCache.clear();
    coreGramsCache.set(key, g);
  }
  return g;
}
function coreSim(x, y) {
  const ga = coreGrams(x), gb = coreGrams(y);
  if (!ga || !gb) return 0;
  let c = 0;
  for (const t of ga) if (gb.has(t)) c++;
  return (2 * c) / (ga.size + gb.size);
}
export function sameFixtureFuzzy(a, b) {
  const orient = (x1, y1, x2, y2) => {
    if (teamQualifier(x1) !== teamQualifier(y1) || teamQualifier(x2) !== teamQualifier(y2)) return false;
    const s1 = coreSim(x1, y1), s2 = coreSim(x2, y2);
    return (Math.max(s1, s2) >= 0.9 && Math.min(s1, s2) >= 0.5);
  };
  return orient(a.homeTeam, b.homeTeam, a.awayTeam, b.awayTeam) || orient(a.homeTeam, b.awayTeam, a.awayTeam, b.homeTeam);
}
export function sameFixtureByLeagueQualifier(a, b) {
  const qa = leagueQualifier(a.league);
  if (!qa || qa !== leagueQualifier(b.league)) return false;
  const ok = (x, y) => sameTeam(bareName(x), bareName(y));
  return (ok(a.homeTeam, b.homeTeam) && ok(a.awayTeam, b.awayTeam)) || (ok(a.homeTeam, b.awayTeam) && ok(a.awayTeam, b.homeTeam));
}

const STATUS_RANK = { UPCOMING: 0, LIVE: 1, FINISHED: 2 };

// How much real provider live data a row carries. An estimated minute (wall-clock
// guess from the kickoff time) is NOT provider data.
export function liveDataQuality(m) {
  let q = 0;
  if (m.currentMinute && !m.currentMinuteEstimated) q += 4;
  if (m.currentMinuteUpdatedAt != null) q += 2;
  if (m.liveHomeScore != null && m.liveAwayScore != null) q += 2;
  if (m.liveStatus != null) q += 1;
  return q;
}

export function dedupeMatches(list, onMerge) {
  const WINDOW_MS = 3 * 60 * 60 * 1000;
  const sorted = [...list].sort((x, y) => Date.parse(x.startTime) - Date.parse(y.startTime));
  const groups = []; // {rep, candidates, time}
  // Sorted by kick-off, so a group more than WINDOW_MS older than this match is older than every later one too: it is
  // skipped for good instead of being tested (and skipped) again by each of the thousands of matches that follow.
  // Only when every kick-off is a real date; otherwise the plain full scan below is kept.
  const ordered = sorted.every((m) => Number.isFinite(Date.parse(m.startTime)));
  let lo = 0;
  for (const m of sorted) {
    const t = Date.parse(m.startTime);
    let placed = false;
    if (!Number.isNaN(t)) {
      if (ordered) while (lo < groups.length && groups[lo].time < t - WINDOW_MS) lo++;
      for (let gi = ordered ? lo : 0; gi < groups.length; gi++) {
        const g = groups[gi];
        if (Math.abs(t - g.time) > WINDOW_MS) continue;
        if (sameFixture(g.rep, m) || (Math.abs(t - g.time) <= LOOSE_WINDOW_MS && (sameFixtureLoose(g.rep, m) || sameFixtureByLeagueQualifier(g.rep, m) || sameFixtureFuzzy(g.rep, m)))) {
          g.candidates.push(m);
          placed = true;
          break;
        }
      }
    }
    if (!placed) groups.push({ rep: m, candidates: [m], time: t });
  }
  return groups.map((g) => {
    let best = g.candidates[0];
    for (const c of g.candidates) {
      const co = openOutcomeCount(c);
      const bo = openOutcomeCount(best);
      if (co !== bo) { if (co > bo) best = c; continue; }
      if (outcomeCount(c) > outcomeCount(best)) best = c;
    }
    best = { ...best };
    for (const c of g.candidates) {
      if (c.id === best.id || (STATUS_RANK[c.status] || 0) <= (STATUS_RANK[best.status] || 0)) continue;
      best.status = c.status;
      best.isLive = c.isLive;
    }
    // The merged record took FINISHED from the in-play twin; the final score sits on that same twin. Without it the
    // match read FINISHED with no score ("undefined - undefined" on its page, and it never listed under Rezultate).
    if (best.status === 'FINISHED' && !(best.score && best.score.home != null && best.score.away != null)) {
      const withScore = g.candidates.find((c) => c.score && c.score.home != null && c.score.away != null);
      if (withScore) best.score = withScore.score;
    }
    if (g.candidates.length > 1) {
      // Live fields: taken together from the single duplicate with the most real
      // provider live data (so home/away score always come from the same record).
      let src = null;
      for (const c of g.candidates) {
        if (!src || liveDataQuality(c) > liveDataQuality(src)
          || (liveDataQuality(c) === liveDataQuality(src) && (c.currentMinuteUpdatedAt || 0) > (src.currentMinuteUpdatedAt || 0))) src = c;
      }
      const ownQuality = liveDataQuality({ ...best, id: best.id });
      if (src && src.id !== best.id && liveDataQuality(src) > ownQuality) {
        best.liveHomeScore = src.liveHomeScore;
        best.liveAwayScore = src.liveAwayScore;
        best.currentMinute = src.currentMinute;
        best.currentMinuteEstimated = src.currentMinuteEstimated;
        best.currentMinuteUpdatedAt = src.currentMinuteUpdatedAt;
        best.liveStatus = src.liveStatus;
        best.liveSourceId = src.id;
      }
      if (onMerge) onMerge(g.candidates.map((c) => c.id), best.id, best.liveSourceId);
    }
    return best;
  });
}

// Folded words of a team name (Koege / Køge -> "kog"), used to skip the expensive fuzzy comparison for names that
// share no word at all. Memoised: the same names come back thousands of times.
const nameWordsCache = new Map();
export function nameWords(name) {
  const key = String(name || '');
  let w = nameWordsCache.get(key);
  if (!w) {
    w = new Set(normTeam(key).replace(/oe/g, 'o').replace(/ae/g, 'a').replace(/ue/g, 'u').split(' ').filter((x) => x.length >= 3));
    if (nameWordsCache.size > 20000) nameWordsCache.clear();
    nameWordsCache.set(key, w);
  }
  return w;
}
