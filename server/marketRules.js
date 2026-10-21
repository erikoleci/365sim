// Settlement rules for every market the provider (London365) offers.
//
// Pure functions, no DB: given one bet leg and the facts about the finished match
// they return the leg's outcome:
//   'WON' | 'LOST' | 'VOID'                    (VOID = push / refund)
//   'HALF_WON' | 'HALF_LOST'                   (Asian quarter lines: half the stake wins / loses)
//   null                                       (cannot be decided -> stays PENDING for the admin)
//
// A leg only returns null when a FACT is missing (no half-time score, no goal events,
// no corner data) or the market is genuinely unknown -- never because the market is
// "complicated". Facts (ctx):
//   home, away          final score
//   htHome, htAway      half-time score (may be undefined)
//   firstGoal/lastGoal  'HOME' | 'AWAY' (team that scored the first / last goal), undefined if unknown
//   cornersTotal        total corners in the match (undefined if unknown)
//   cornersH1           corners in the first half (undefined if unknown)
//
// Names in the feed: "Pritesi" = home team, "Udhetuesi" = away team, "Po"/"Jo" = yes/no,
// "Tek"/"Cift" = odd/even, "Lart"/"Poshte" = over/under, "Gol"/"JoGol" = both teams
// to score / not, "Barazim" = draw, "Fiks" = exact number.

export function norm(str) {
  return String(str ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- primitives

const alnum = (s) => norm(s).replace(/[^a-z0-9]/g, '');

function winnerOf(h, a) {
  return h > a ? 'HOME' : a > h ? 'AWAY' : 'DRAW';
}

// "1" / "X" / "2" / "Home" / "Barazim" / "Pritesi" / the team's own name -> HOME | DRAW | AWAY
function sideOf(text, leg) {
  const raw = norm(text);
  const t = alnum(text);
  if (!t) return null;
  if (leg && leg.match_home && raw === norm(leg.match_home)) return 'HOME';
  if (leg && leg.match_away && raw === norm(leg.match_away)) return 'AWAY';
  if (t === '1' || t === 'home' || t === 'pritesi' || t === 'h') return 'HOME';
  if (t === '2' || t === 'away' || t === 'udhetuesi' || t === 'a') return 'AWAY';
  if (t === 'x' || t === 'draw' || t === 'barazim' || t === 'barazimi' || t === 'd') return 'DRAW';
  return null;
}

// "1X" / "X2" / "12" / "HomeDraw" / "DrawAway" / "HomeAway" -> '1X' | 'X2' | '12'
function dcOf(text) {
  const t = alnum(text);
  if (t === '1x' || t === 'x1' || t === 'homedraw' || t === 'drawhome') return '1X';
  if (t === 'x2' || t === '2x' || t === 'drawaway' || t === 'awaydraw') return 'X2';
  if (t === '12' || t === '21' || t === 'homeaway' || t === 'awayhome') return '12';
  return null;
}

function dcHolds(dc, winner) {
  if (dc === '1X') return winner !== 'AWAY';
  if (dc === 'X2') return winner !== 'HOME';
  return winner !== 'DRAW';
}

// "Po" / "Yes" / "Gol" / "GG" -> true ; "Jo" / "No" / "JoGol" / "JG" -> false
function ynOf(text) {
  const t = alnum(text);
  if (['po', 'yes', 'gol', 'gg', 'y'].includes(t)) return true;
  if (['jo', 'no', 'jogol', 'jg', 'ng', 'n'].includes(t)) return false;
  return null;
}

const win = (cond) => (cond ? 'WON' : 'LOST');

// "3+" "3plus" -> {min:3,max:Inf} ; "0-2" -> {0,2} ; "7" / "8Fiks" -> exact
function parseRange(text) {
  const t = norm(text).replace(/\s+/g, '');
  let m;
  if ((m = t.match(/^(\d+)(?:\+|plus|ose\+?)$/))) return { min: Number(m[1]), max: Infinity };
  if ((m = t.match(/^(\d+)-(\d+)$/))) return { min: Number(m[1]), max: Number(m[2]) };
  if ((m = t.match(/^(\d+)(?:fiks|fix|exact)?$/))) return { min: Number(m[1]), max: Number(m[1]) };
  return null;
}
const inRange = (r, n) => n >= r.min && n <= r.max;

// "Lart 1.5" / "Mbi 2,5" / "Over-2.5" / "Poshtë 3.5" / "Under 0.5"
function parseOverUnder(text) {
  const m = norm(text).match(/^(lart|mbi|over|poshte|nen|under)[\s-]*([0-9]+(?:[.,][0-9]+)?)$/);
  if (!m) return null;
  const side = m[1] === 'lart' || m[1] === 'mbi' || m[1] === 'over' ? 'Over' : 'Under';
  const point = parseFloat(m[2].replace(',', '.'));
  return Number.isNaN(point) ? null : { side, point };
}

// Two half-stake sub-bets (the two outcomes are WON/LOST/VOID) -> one outcome.
function combineHalves(a, b) {
  if (a === b) return a;
  const set = new Set([a, b]);
  if (set.has('WON') && set.has('VOID')) return 'HALF_WON';
  if (set.has('LOST') && set.has('VOID')) return 'HALF_LOST';
  return null;
}

const isQuarter = (point) => Math.abs(Math.round(point * 4) % 2) === 1;

function singleTotal(side, point, goals) {
  if (goals === point) return 'VOID';
  if (side === 'Over') return win(goals > point);
  return win(goals < point);
}

// Over/Under with whole (push), half and quarter (half-win / half-loss) lines.
function totalOutcome(side, point, goals) {
  if (isQuarter(point)) {
    return combineHalves(singleTotal(side, point - 0.25, goals), singleTotal(side, point + 0.25, goals));
  }
  return singleTotal(side, point, goals);
}

// Handicap: `own` = the picked team's handicap, `mine`/`theirs` = the goals of the
// picked team / its opponent. Whole lines push, quarter lines split.
function handicapOutcome(own, mine, theirs) {
  const one = (p) => {
    const d = mine + p - theirs;
    return d > 0 ? 'WON' : d < 0 ? 'LOST' : 'VOID';
  };
  if (isQuarter(own)) return combineHalves(one(own - 0.25), one(own + 0.25));
  return one(own);
}

// ---------------------------------------------------------------- scoping

// Which half does the market name talk about? null = the whole match.
const PERIOD_NUM_RE = /\bpjes\w*\s*(?:-\s*)?(?:(?:e|se|te|i)\s+)?(\d)(?:[-\s]?(?:re|te|r|t))?\b/;
const PERIOD_WORD_RE = /\bpjes\w*\s*(?:-\s*)?(?:(?:e|se|te|i)\s+)?(pare|dyte)\b/;
function periodOf(mn) {
  if (/\b1st half\b|\bfirst half\b|\bne pushim\b/.test(mn)) return 'H1';
  if (/\b2nd half\b|\bsecond half\b/.test(mn)) return 'H2';
  const pm = mn.match(/\bp([12])\b/);
  let m = mn.match(PERIOD_NUM_RE);
  if (m) return m[1] === '1' ? 'H1' : m[1] === '2' ? 'H2' : null;
  m = mn.match(PERIOD_WORD_RE);
  if (m) return m[1] === 'pare' ? 'H1' : 'H2';
  if (pm) return pm[1] === '1' ? 'H1' : 'H2';
  return null;
}

function stripPeriod(mn) {
  return mn
    .replace(/\b1st half\b|\bfirst half\b|\b2nd half\b|\bsecond half\b|\bne pushim\b/g, ' ')
    .replace(new RegExp(PERIOD_NUM_RE.source, 'g'), ' ')
    .replace(new RegExp(PERIOD_WORD_RE.source, 'g'), ' ')
    .replace(/\bp[12]\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Goals of (home, away) in the requested period, or null when the half-time score is missing.
function scoped(ctx, period) {
  const { home, away, htHome, htAway } = ctx;
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (!period) return { h: home, a: away };
  if (!Number.isFinite(htHome) || !Number.isFinite(htAway)) return null;
  if (period === 'H1') return { h: htHome, a: htAway };
  const h = home - htHome;
  const a = away - htAway;
  return h < 0 || a < 0 ? null : { h, a };
}

// Team a market is about (home/away), by the feed's words or the real team names.
function teamOf(mn, leg) {
  const words = mn.split(/[^a-z0-9]+/);
  if (words.includes('pritesi') || words.includes('home')) return 'HOME';
  if (words.includes('udhetuesi') || words.includes('away')) return 'AWAY';
  if (leg.match_home && mn.includes(norm(leg.match_home))) return 'HOME';
  if (leg.match_away && mn.includes(norm(leg.match_away))) return 'AWAY';
  return null;
}

// Try a parser on the selection name, then on the selection id.
function sel(leg, fn) {
  for (const t of [leg.selection_name, leg.selection_id]) {
    if (t == null || String(t).trim() === '') continue;
    const r = fn(String(t));
    if (r !== null && r !== undefined) return r;
  }
  return null;
}

const half = (ctx, p) => scoped(ctx, p);

// ---------------------------------------------------------------- combos

// "1/0-1" , "1X_0-1" , "Home / Yes" , "GG / JG" -> [left, right]
function splitPair(text, seps = ['/', '_', '|']) {
  const t = String(text);
  for (const s of seps) {
    const i = t.indexOf(s);
    if (i > 0) return [t.slice(0, i).trim(), t.slice(i + 1).trim()];
  }
  return null;
}

const and = (...parts) => {
  if (parts.some((p) => p === null || p === undefined)) return null;
  if (parts.includes('LOST')) return 'LOST';
  if (parts.includes('VOID')) return 'VOID';
  return 'WON';
};

// HT/FT token: "1/1", "X/2" -> [ht, ft]; or words "Home/Draw"
function htft(text) {
  const p = splitPair(text, ['/']);
  if (!p) return null;
  const a = sideOf(p[0]);
  const b = sideOf(p[1]);
  return a && b ? [a, b] : null;
}

// ---------------------------------------------------------------- main evaluator

const STOP = new Set(['ne', 'e', 'te', 'se', 'i', 'ndeshje', 'ndeshjes', 'the', 'of']);
const TEAM_WORDS = new Set(['pritesi', 'udhetuesi', 'home', 'away']);

function baseOf(mn, leg) {
  let b = stripPeriod(mn);
  for (const t of [leg.match_home, leg.match_away]) {
    const n = t ? norm(t) : '';
    if (n) b = b.split(n).join(' ');
  }
  return b
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w) && !TEAM_WORDS.has(w))
    .join(' ')
    .replace(/\s*-\s*$/, '')
    .trim();
}

const GOALS_BASES = new Set([
  'numri golave', 'totali golave', 'total goals', 'golat', 'sa gola shenohen', 'sa gola shenon',
  'sasia golave', 'sasia golave perfundimtare', 'shuma sakte golave', 'multigoals',
  'lart/poshte gola aziatike', 'lart/poshte gola aziatik', 'lart poshte gola aziatike',
]);

export function evaluateMarket(leg, ctx) {
  const mn = norm(leg.market_name);
  if (!mn) return null;
  const { home, away } = ctx;
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  const winner = winnerOf(home, away);
  const total = home + away;

  // ---------- HT/FT family ("45/90", "Halftime/fulltime & exact goals")
  if (mn.startsWith('halftime/fulltime')) {
    return sel(leg, (t) => {
      const m = norm(t).match(/^(\d+)(\+?)\s+(home|draw|away)\s*\/\s*(home|draw|away)$/);
      if (!m) return null;
      const h = half(ctx, 'H1');
      if (!h) return null;
      const goalsOk = m[2] ? total >= Number(m[1]) : total === Number(m[1]);
      return and(win(goalsOk), win(winnerOf(h.h, h.a) === sideOf(m[3]) && winner === sideOf(m[4])));
    });
  }
  if (mn.startsWith('45/90') || /^(pushim\/fund|pushim\/fundi|ht\/ft|half ?time\/full ?time|rezultati pjesa e (pare|1re) ?\/ ?rezultati final)$/.test(mn)) {
    const h = half(ctx, 'H1');
    if (!h) return null;
    const htW = winnerOf(h.h, h.a);
    if (!mn.startsWith('45/90') || mn === '45/90') {
      return sel(leg, (t) => { const p = htft(t); return p ? win(p[0] === htW && p[1] === winner) : null; });
    }
    // "45/90 & Numri i Golave ne Ndeshje" -> "1-1/2+" ; "... ne Pjesen e Pare" -> "X-1/0"
    const firstHalfGoals = periodOf(mn) === 'H1';
    const goals = firstHalfGoals ? h.h + h.a : total;
    return sel(leg, (t) => {
      const p = splitPair(t, ['/']);
      if (!p) return null;
      const left = p[0].split('-');
      const range = parseRange(p[1]);
      if (left.length !== 2 || !range) return null;
      const a = sideOf(left[0]);
      const b = sideOf(left[1]);
      if (!a || !b) return null;
      return and(win(a === htW && b === winner), win(inRange(range, goals)));
    });
  }

  // ---------- "Rezultat i Sakte Pjesa 1/Final" -> "0-0 1-0", "1-0 4plus", "4plus 4plus"
  if (/rezultat i sakte pjesa 1\/final/.test(mn)) {
    const h = half(ctx, 'H1');
    if (!h) return null;
    return sel(leg, (t) => {
      const parts = norm(t).split(' ');
      if (parts.length !== 2) return null;
      const side = (tok, gh, ga, goalsInPeriod) => {
        if (/^4\s*plus$|^4\+$/.test(tok)) return goalsInPeriod >= 4;
        const m = tok.match(/^(\d+)-(\d+)$/);
        return m ? Number(m[1]) === gh && Number(m[2]) === ga : null;
      };
      const a = side(parts[0], h.h, h.a, h.h + h.a);
      const b = side(parts[1], home, away, total);
      return a === null || b === null ? null : win(a && b);
    });
  }

  // ---------- result & total goals ("Rezultat Final & Numri i Golave ne Ndeshje": "1/0-1")
  if (/^rezultat final & numri i golave/.test(mn)) {
    return sel(leg, (t) => {
      const p = splitPair(t, ['/']);
      const r = p && parseRange(p[1]);
      const s = p && sideOf(p[0], leg);
      return s && r ? win(s === winner && inRange(r, total)) : null;
    });
  }
  // ---------- double chance & total goals ("Dopio Shans me Kombinime": "1X_0-1", "2X_2+")
  if (/^dopio shans me kombinime/.test(mn)) {
    return sel(leg, (t) => {
      const p = splitPair(t, ['_', '/']);
      const dc = p && dcOf(p[0]);
      const r = p && parseRange(p[1]);
      return dc && r ? win(dcHolds(dc, winner) && inRange(r, total)) : null;
    });
  }
  // ---------- double chance & BTTS ("Dopio Shans & Gol/JGol": "1X_Gol")
  if (/^dopio shans & gol/.test(mn)) {
    return sel(leg, (t) => {
      const p = splitPair(t, ['_', '/']);
      const dc = p && dcOf(p[0]);
      const y = p && ynOf(p[1]);
      return dc && y !== null ? win(dcHolds(dc, winner) && (home > 0 && away > 0) === y) : null;
    });
  }
  // ---------- BTTS & total goals ("Lart-Poshte/Gol-Jo Gol": "Gol/3+")
  if (/^lart-poshte\/gol-jo gol/.test(mn)) {
    return sel(leg, (t) => {
      const p = splitPair(t, ['/']);
      const y = p && ynOf(p[0]);
      const r = p && parseRange(p[1]);
      return y !== null && r ? win((home > 0 && away > 0) === y && inRange(r, total)) : null;
    });
  }
  // ---------- 1X2 & BTTS ("Rezultat Final/Gol-Jo Gol": "1/Gol"; "1st half - 1x2 & both teams to score": "Home / Yes")
  if (/(^rezultat final\/gol|1x2 & both teams to score)/.test(mn)) {
    const g = half(ctx, periodOf(mn));
    if (!g) return null;
    return sel(leg, (t) => {
      const p = splitPair(t, ['/']);
      const s = p && sideOf(p[0], leg);
      const y = p && ynOf(p[1]);
      return s && y !== null ? win(winnerOf(g.h, g.a) === s && (g.h > 0 && g.a > 0) === y) : null;
    });
  }
  // ---------- double chance & BTTS, per half
  if (/double chance.*& (1st half |2nd half )?both teams/.test(mn)) {
    // "Double chance (match) & 1st half both teams score": DC on the match, BTTS on the half.
    // "1st half - double chance & both teams to score": both on the half.
    const dcOnMatch = /double chance \(match\)/.test(mn);
    const bttsPeriod = /& 1st half|^1st half/.test(mn) ? 'H1' : /& 2nd half|^2nd half/.test(mn) ? 'H2' : null;
    const dcScope = dcOnMatch ? { h: home, a: away } : half(ctx, bttsPeriod);
    const bt = half(ctx, bttsPeriod);
    if (!dcScope || !bt) return null;
    return sel(leg, (t) => {
      const p = splitPair(t, ['/']);
      const dc = p && dcOf(p[0]);
      const y = p && ynOf(p[1]);
      return dc && y !== null ? win(dcHolds(dc, winnerOf(dcScope.h, dcScope.a)) && (bt.h > 0 && bt.a > 0) === y) : null;
    });
  }
  // ---------- BTTS in 1st half / BTTS in 2nd half ("RP1/RP2 & Gol/JoGol": "GG / JG")
  if (/^rp1\/rp2/.test(mn)) {
    const h1 = half(ctx, 'H1');
    const h2 = half(ctx, 'H2');
    if (!h1 || !h2) return null;
    return sel(leg, (t) => {
      const p = splitPair(t, ['/']);
      const a = p && ynOf(p[0]);
      const b = p && ynOf(p[1]);
      return a !== null && b !== null && p ? win((h1.h > 0 && h1.a > 0) === a && (h2.h > 0 && h2.a > 0) === b) : null;
    });
  }
  // ---------- generic "<x> & <y>" selections ("1 & Lart 2.5")
  if (mn.includes('&')) {
    const g = half(ctx, periodOf(mn));
    if (!g) return null;
    return sel(leg, (t) => {
      const parts = t.split('&').map((s) => s.trim());
      if (parts.length < 2) return null;
      const outs = parts.map((part) => {
        const ou = parseOverUnder(part);
        if (ou) return totalOutcome(ou.side, ou.point, g.h + g.a);
        const s = sideOf(part, leg);
        if (s) return win(winnerOf(g.h, g.a) === s);
        const dc = dcOf(part);
        if (dc) return win(dcHolds(dc, winnerOf(g.h, g.a)));
        const y = ynOf(part);
        if (y !== null) return win((g.h > 0 && g.a > 0) === y);
        return null;
      });
      return and(...outs);
    });
  }

  // ---------- "<winner> or <something>" ("Fiton Pritesi ose 3+", "Barazim ose Gol/JoGol")
  let m = mn.match(/^(fiton pritesi|fiton udhetuesi|barazim) ose (.+)$/);
  if (m) {
    const who = m[1] === 'fiton pritesi' ? 'HOME' : m[1] === 'fiton udhetuesi' ? 'AWAY' : 'DRAW';
    const compact = m[2].replace(/\s+/g, '');
    let second;
    if (/^gol\/jo|^gol-jo|^goljo/.test(compact)) second = home > 0 && away > 0;
    else {
      const r = parseRange(compact.replace(/gola?/g, ''));
      if (!r) return null;
      second = inRange(r, total);
    }
    return sel(leg, (t) => { const y = ynOf(t); return y === null ? null : win((winner === who || second) === y); });
  }
  // "Home or any clean sheet" / "Draw or ..." / "Away or ..."
  m = mn.match(/^(home|draw|away) or any clean sheet$/);
  if (m) {
    const who = m[1].toUpperCase();
    const cond = winner === who || home === 0 || away === 0;
    return sel(leg, (t) => { const y = ynOf(t); return y === null ? null : win(cond === y); });
  }
  // "Home to win" ("1" / "X2") and "Away to win" ("2" / "1X")
  m = mn.match(/^(home|away) to win$/);
  if (m) {
    return sel(leg, (t) => {
      const s = sideOf(t, leg);
      const dc = dcOf(t);
      if (dc) return win(dcHolds(dc, winner));
      return s ? win(winner === s) : null;
    });
  }
  // "Any team to win": "X" = nobody wins, "12" = somebody wins
  if (mn === 'any team to win') {
    return sel(leg, (t) => {
      const x = alnum(t);
      if (x === 'x') return win(winner === 'DRAW');
      if (dcOf(t) === '12') return win(winner !== 'DRAW');
      return null;
    });
  }

  // ---------- clean sheets ("Home clean sheet", "1st half - Away clean sheet")
  if (/clean sheet/.test(mn)) {
    const g = half(ctx, periodOf(mn));
    const team = teamOf(mn, leg);
    if (!g || !team) return null;
    const conceded = team === 'HOME' ? g.a : g.h;
    return sel(leg, (t) => { const y = ynOf(t); return y === null ? null : win((conceded === 0) === y); });
  }
  // ---------- win to nil
  m = mn.match(/^(pritesi|udhetuesi) fiton me zero$/);
  if (m) {
    const cond = m[1] === 'pritesi' ? home > away && away === 0 : away > home && home === 0;
    return sel(leg, (t) => { const y = ynOf(t); return y === null ? null : win(cond === y); });
  }
  // ---------- win both halves / either half / score in both halves / highest scoring half
  m = mn.match(/^(pritesi|udhetuesi) (fiton te dy pjeset|shenon ne te dy pjeset)$|^(home|away) to win either half$/);
  if (m) {
    const h1 = half(ctx, 'H1');
    const h2 = half(ctx, 'H2');
    if (!h1 || !h2) return null;
    const isHome = (m[1] || m[3]) === 'pritesi' || (m[1] || m[3]) === 'home';
    const mine = (g) => (isHome ? g.h : g.a);
    const theirs = (g) => (isHome ? g.a : g.h);
    let cond;
    if (m[2] === 'fiton te dy pjeset') cond = mine(h1) > theirs(h1) && mine(h2) > theirs(h2);
    else if (m[2] === 'shenon ne te dy pjeset') cond = mine(h1) > 0 && mine(h2) > 0;
    else cond = mine(h1) > theirs(h1) || mine(h2) > theirs(h2);
    return sel(leg, (t) => { const y = ynOf(t); return y === null ? null : win(cond === y); });
  }
  m = mn.match(/^(home|away) highest scoring half$/);
  if (m) {
    const h1 = half(ctx, 'H1');
    const h2 = half(ctx, 'H2');
    if (!h1 || !h2) return null;
    const a = m[1] === 'home' ? h1.h : h1.a;
    const b = m[1] === 'home' ? h2.h : h2.a;
    const res = a > b ? '1st' : b > a ? '2nd' : 'equal';
    return sel(leg, (t) => {
      const x = norm(t);
      if (/^(1st|1|e pare|pjesa e 1re)$/.test(x)) return win(res === '1st');
      if (/^(2nd|2|e dyta|pjesa e 2te)$/.test(x)) return win(res === '2nd');
      if (/^(equal|barazim|x)$/.test(x)) return win(res === 'equal');
      return null;
    });
  }
  // "Ne Cilen Pjese do te Shenohen me Shume Gola" -> Pjesen e 1re / Pjesen e 2te / Barazim
  if (/^ne cilen pjese do te shenohen me shume gola|^pjesa me shume gola|^pjesa me te shumten e golave/.test(mn)) {
    const h1 = half(ctx, 'H1');
    const h2 = half(ctx, 'H2');
    if (!h1 || !h2) return null;
    const a = h1.h + h1.a;
    const b = h2.h + h2.a;
    const res = a > b ? '1' : b > a ? '2' : 'X';
    return sel(leg, (t) => {
      const x = norm(t);
      if (/\b(1re|1|pare|para)\b/.test(x)) return win(res === '1');
      if (/\b(2te|2|dyte|dyta)\b/.test(x)) return win(res === '2');
      if (/barazim|^x$/.test(x)) return win(res === 'X');
      return null;
    });
  }

  // ---------- first / last goal
  if (/^cila skuader shenon golin e (1re|fundit)$/ .test(mn) || /^goli i pare ne pjese te pare$/.test(mn)) {
    const isLast = /fundit$/.test(mn);
    const inFirstHalfOnly = /pjese te pare$/.test(mn);
    let who;
    if (inFirstHalfOnly) {
      const h = half(ctx, 'H1');
      if (!h) return null;
      who = h.h + h.a === 0 ? 'NONE' : ctx.firstGoal;
    } else if (total === 0) who = 'NONE';
    else who = isLast ? ctx.lastGoal : ctx.firstGoal;
    if (!who) return null; // goals happened but the scorer order is unknown
    return sel(leg, (t) => {
      const x = norm(t);
      const token = x.split(' ')[0];
      if (/ka gol|none|pa gol|s'ka/.test(x) || token === 'none') return win(who === 'NONE');
      if (token === '1') return win(who === 'HOME');
      if (token === '2') return win(who === 'AWAY');
      return null;
    });
  }

  // ---------- corners
  if (/korne|corner/.test(mn)) {
    const t1 = ctx.cornersH1;
    const tt = ctx.cornersTotal;
    if (/p1\+p2/.test(mn)) {
      if (!Number.isFinite(t1) || !Number.isFinite(tt) || tt - t1 < 0) return null;
      return sel(leg, (t) => {
        const p = t.split('|');
        const a = p.length === 2 && parseRange(p[0]);
        const b = p.length === 2 && parseRange(p[1]);
        return a && b ? win(inRange(a, t1) && inRange(b, tt - t1)) : null;
      });
    }
    const period = periodOf(mn);
    let count;
    if (!period) count = tt;
    else if (!Number.isFinite(t1) || !Number.isFinite(tt)) return null;
    else count = period === 'H1' ? t1 : tt - t1;
    if (!Number.isFinite(count) || count < 0) return null;
    return sel(leg, (t) => {
      // "Lart 9.5" = 10+ corners, "Poshte 9.5" = 9 or fewer; whole lines push, quarter lines split
      const ou = parseOverUnder(t);
      if (ou) return totalOutcome(ou.side, ou.point, count);
      const r = parseRange(t);
      return r ? win(inRange(r, count)) : null;
    });
  }

  // ---------- correct score (match / half)
  if (/^rezultati i sakte|^rezultat i sakte/.test(mn)) {
    const g = half(ctx, periodOf(mn));
    if (!g) return null;
    const isHalf = periodOf(mn) !== null;
    return sel(leg, (t) => {
      const x = norm(t);
      const sc = x.match(/^(\d+)\s*[-:]\s*(\d+)$/);
      if (sc) return win(Number(sc[1]) === g.h && Number(sc[2]) === g.a);
      // "Te Tjera" / "other": every score the half market does not list. Its list is
      // the full 0-2 x 0-2 grid, so "other" = either side scored 3+.
      if (isHalf && /^(te tjera|tjeter|other|te tjere)$/.test(x)) return win(g.h > 2 || g.a > 2);
      return null;
    });
  }

  // ---------- handicaps
  if (/handikap|hendikep|handicap/.test(mn)) {
    const g = half(ctx, periodOf(mn));
    if (!g) return null;
    // 3-way ("Handikap Europian"): "1 0:1" = home / draw / away after adding 0:1 to the score
    if (/europian|european/.test(mn)) {
      return sel(leg, (t) => {
        const e = t.trim().match(/^([1xX2])\s+(\d+)\s*:\s*(\d+)$/);
        if (!e) return null;
        const w = winnerOf(g.h + Number(e[2]), g.a + Number(e[3]));
        return win(w === sideOf(e[1]));
      });
    }
    // Asian: "1 -0.25 (undefined)" / "2 0.25" (line is the HOME handicap) or "Team (+1)" (team's own)
    return sel(leg, (t) => {
      const text = t.replace(/\(undefined\)/g, '').trim();
      let side;
      let own;
      let a = text.match(/^([12])\s*([+-]?\d+(?:[.,]\d+)?)$/);
      if (a) {
        const line = parseFloat(a[2].replace(',', '.'));
        side = a[1] === '1' ? 'HOME' : 'AWAY';
        own = side === 'HOME' ? line : -line;
      } else if ((a = text.match(/^(.*?)\s*\(\s*([+-]?\d+(?:[.,]\d+)?)\s*\)\s*$/))) {
        own = parseFloat(a[2].replace(',', '.'));
        side = sideOf(a[1], leg);
        if (side !== 'HOME' && side !== 'AWAY') return null;
      } else return null;
      if (Number.isNaN(own)) return null;
      return side === 'HOME' ? handicapOutcome(own, g.h, g.a) : handicapOutcome(own, g.a, g.h);
    });
  }

  // ---------- from here on: markets over the goals of one period (and maybe one team)
  const period = periodOf(mn);
  const g = half(ctx, period);
  const base = baseOf(mn, leg);

  // draw no bet ("Fitore/Fitore", "Draw no bet") and half variants
  if (/^fitore\s*[-/]\s*fitore$|^fitore fitore$|draw no bet|barazimi = rimbursim/.test(base) || /^fitore\/fitore/.test(mn) || /^fitore - fitore/.test(mn)) {
    if (!g) return null;
    const w = winnerOf(g.h, g.a);
    return sel(leg, (t) => {
      const s = sideOf(t, leg);
      if (s !== 'HOME' && s !== 'AWAY') return null;
      return w === 'DRAW' ? 'VOID' : win(w === s);
    });
  }
  // "Home no bet" (X / 2: home refunded) and "Away no bet" (1 / X: away refunded)
  m = mn.match(/^(home|away) no bet$/);
  if (m) {
    const refunded = m[1] === 'home' ? 'HOME' : 'AWAY';
    return sel(leg, (t) => {
      const s = sideOf(t, leg);
      if (!s) return null;
      return winner === refunded ? 'VOID' : win(winner === s);
    });
  }
  // double chance (match / half)
  if (/^dopio shans$|^double chance$|^shans i dyfishte$/.test(base) || /^dopio shans\b/.test(mn)) {
    if (!g) return null;
    return sel(leg, (t) => { const dc = dcOf(t); return dc ? win(dcHolds(dc, winnerOf(g.h, g.a))) : null; });
  }
  // 1X2 (match / half)
  if (/^(rezultat final|rezultati final|1x2|rezultati|fituesi|fituesi i ndeshjes|rezultati i ndeshjes)$/.test(base)
      || /^rezultati\b/.test(mn) || /^rezultat final$/.test(mn)) {
    if (!g) return null;
    return sel(leg, (t) => { const s = sideOf(t, leg); return s ? win(winnerOf(g.h, g.a) === s) : null; });
  }
  // both teams to score (match / half)
  if (/^gol\/jogol$|^gol-jo gol$|^gol jo gol$|^te dy skuadrat shenojne$|^both teams to score$/.test(base)) {
    if (!g) return null;
    return sel(leg, (t) => { const y = ynOf(t); return y === null ? null : win((g.h > 0 && g.a > 0) === y); });
  }
  // odd / even ("Tek/Cift", "Pritesi Tek/Cift", "Tek/Cift Pjesa e 1re")
  if (/^tek\/cift$|^tek cift$|^odd\/even$/.test(base)) {
    if (!g) return null;
    const team = teamOf(mn, leg);
    const goals = team === 'HOME' ? g.h : team === 'AWAY' ? g.a : g.h + g.a;
    return sel(leg, (t) => {
      const x = norm(t);
      if (x === 'tek' || x === 'odd') return win(goals % 2 === 1);
      if (x === 'cift' || x === 'even') return win(goals % 2 === 0);
      return null;
    });
  }

  // number of goals: over/under (whole, half, quarter lines), ranges, exact
  if (GOALS_BASES.has(base) || /^lart\/poshte gola aziatik/.test(base)) {
    if (!g) return null;
    const team = teamOf(mn, leg);
    const goals = team === 'HOME' ? g.h : team === 'AWAY' ? g.a : g.h + g.a;
    return sel(leg, (t) => {
      const ou = parseOverUnder(t);
      if (ou) return totalOutcome(ou.side, ou.point, goals);
      const r = parseRange(t);
      return r ? win(inRange(r, goals)) : null;
    });
  }

  return null;
}
