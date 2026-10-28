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

export function normTeam(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(fc|cf|sc|ac|afc|fk|if|bk|sk|cd|sd|ud|club)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Qualifier tokens that make two similar names DIFFERENT teams.
const QUALIFIER_RE = /\b(u\s?\d{2}|women|womens|ladies|w|ii|iii|b|reserves?|youth|juniors?|jr)\b/g;
export function teamQualifier(name) {
  const norm = normTeam(name).replace(/\bu\s(\d{2})\b/g, 'u$1');
  const found = norm.match(QUALIFIER_RE) || [];
  return Array.from(new Set(found.map((q) => (q === 'womens' || q === 'ladies' ? 'women' : q.replace(/^juniors?$/, 'jr'))))).sort().join('|');
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

function sameTeam(x, y) {
  if (teamQualifier(x) !== teamQualifier(y)) return false;
  const nx = stripQualifier(normTeam(x));
  const ny = stripQualifier(normTeam(y));
  if (differsByOneUnrelatedWord(nx, ny)) return false;
  return teamSim(nx, ny) >= 0.8 || abbrevEqual(nx, ny);
}

export function sameFixture(a, b) {
  const direct = sameTeam(a.homeTeam, b.homeTeam) && sameTeam(a.awayTeam, b.awayTeam);
  const swapped = sameTeam(a.homeTeam, b.awayTeam) && sameTeam(a.awayTeam, b.homeTeam);
  return direct || swapped;
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
  for (const m of sorted) {
    const t = Date.parse(m.startTime);
    let placed = false;
    if (!Number.isNaN(t)) {
      for (const g of groups) {
        if (Math.abs(t - g.time) > WINDOW_MS) continue;
        if (sameFixture(g.rep, m)) {
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
