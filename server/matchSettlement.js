import pool from './db.js';

// ---- first / second half markets ------------------------------------------
// "Rezultati Pjesa e Parë", "Numri i Golave në Pjesën e Dytë", "1X2 1st Half" ...
// The period phrase is cut out of the (normalised) market name and what is left
// must be one of the known base markets, otherwise the leg stays PENDING for
// manual review (HT/FT doubles, "which half has more goals" etc. never match).
// First half uses the stored half-time score (matches_cache.ht_home/ht_away,
// captured at the whistle); second half is final score minus half-time score.
const FIRST_HALF_RE = /(?:\bne\s+)?(?:\bpjes(?:a|en|e)\s+(?:e\s+)?(?:pare|1)\b|\b1\.?\s*pjes(?:a|en|e)\b|\b(?:1st|first)\s+half\b|\bne\s+pushim\b)/;
const SECOND_HALF_RE = /(?:\bne\s+)?(?:\bpjes(?:a|en|e)\s+(?:e\s+)?(?:dyte|2)\b|\b2\.?\s*pjes(?:a|en|e)\b|\b(?:2nd|second)\s+half\b)/;
// Names that only make sense WITH a period phrase around them.
const PERIOD_BASE_ALIASES = {
  rezultati: 'rezultati final',
  fituesi: 'rezultati final',
  golat: 'numri i golave',
  'mbi/nen': 'numri i golave',
  'lart/poshte': 'numri i golave',
};

function splitPeriod(name) {
  for (const [re, period] of [[FIRST_HALF_RE, 'H1'], [SECOND_HALF_RE, 'H2']]) {
    if (re.test(name)) {
      const base = name.replace(re, ' ').replace(/[-:()]/g, ' ').replace(/\s+/g, ' ').trim();
      return { period, base };
    }
  }
  return { period: null, base: name };
}

// Pure decision logic for a single bet leg given the final match result.
// Kept separate from settleMatch (which is DB-coupled) so it can be unit
// tested without a database. Returns 'WON' | 'LOST' | null (null = leave
// PENDING for manual review — used for markets/lines we don't auto-settle).
// Lowercase + strip diacritics + collapse whitespace so "Poshtë", "Nën",
// "Numri i Golave ne Ndeshje" all compare reliably.
function norm(str) {
  return String(str ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Provider markets that are NOT in CANONICAL_MARKETS (london365.js) get a
// unique market_id like "numri_i_golave_ne_ndeshje_m123" and their
// selection_id is the raw option text ("Lart 1.5"). Those never matched the
// "-xyz" suffix checks, so e.g. "Numri i Golave ne Ndeshje -> Lart 1.5" stayed
// PENDING forever. Every market that can be decided from the FINAL SCORE
// alone is therefore also recognised by its (normalised) market NAME.
// Half-time / period markets, combos ("&") and quarter-handicaps are never
// auto-settled from the final score: they stay PENDING for manual review
// instead of being settled wrongly.
const TOTAL_GOALS_PREFIXES = ['numri i golave ne ndeshje', 'numri i golave', 'totali i golave', 'total goals', 'golat ne ndeshje'];
const H2H_NAMES = new Set(['rezultat final', 'rezultati final', '1x2', 'rezultati i ndeshjes', 'fituesi i ndeshjes']);
const BTTS_NAMES = new Set(['gol/jogol', 'gol-jogol', 'gol / jogol', 'te dy skuadrat shenojne', 'both teams to score']);
const DOUBLE_CHANCE_NAMES = new Set(['dopio shans', 'double chance', 'shans i dyfishte']);
const CORRECT_SCORE_NAMES = new Set(['rezultati i sakte', 'rezultati ekzakt', 'correct score']);
const HANDICAP_NAMES = new Set(['handikap', 'hendikep', 'handicap', 'handikap ne ndeshje', 'hendikep ne ndeshje']);
const PERIOD_OR_COMBO = /(pjes|pjese|half|1st|2nd|\bht\b|\bft\b|&| dhe |\+|minut|kend|korner|karton|faull|corner|card)/;

// Parses "Lart 1.5" / "Mbi 2,5" / "Over-2.5" / "Poshtë 3.5" / "Under 0.5".
function parseOverUnder(text) {
  const m = norm(text).match(/^(lart|mbi|over|poshte|nen|under)[\s-]*([0-9]+(?:[.,][0-9]+)?)$/);
  if (!m) return null;
  const side = m[1] === 'lart' || m[1] === 'mbi' || m[1] === 'over' ? 'Over' : 'Under';
  const point = parseFloat(m[2].replace(',', '.'));
  return Number.isNaN(point) ? null : { side, point };
}

// Whole-number line landing exactly on the total is a push -> stake refunded.
function overUnderOutcome(side, point, goals) {
  if (Number.isNaN(point)) return null;
  if (point === goals) return 'VOID';
  if (side === 'Over') return goals > point ? 'WON' : 'LOST';
  if (side === 'Under') return goals < point ? 'WON' : 'LOST';
  return null;
}

// "1X" / "x2" / "1-2" / "1/X" -> canonical "1X" | "X2" | "12" | null
function normDoubleChance(text) {
  const t = String(text ?? '').toUpperCase().replace(/[\s/\-_]/g, '');
  if (t === '1X' || t === 'X1') return '1X';
  if (t === 'X2' || t === '2X') return 'X2';
  if (t === '12' || t === '21') return '12';
  return null;
}

// Which side a "home / away" style selection refers to, or null.
function sideOfSelection(leg) {
  const id = String(leg.selection_id ?? '').toUpperCase();
  const name = norm(leg.selection_name);
  if (id === 'HOME' || id === '1' || name === '1' || (leg.match_home && name === norm(leg.match_home))) return 'HOME';
  if (id === 'AWAY' || id === '2' || name === '2' || (leg.match_away && name === norm(leg.match_away))) return 'AWAY';
  if (id === 'DRAW' || id === 'X' || name === 'x') return 'DRAW';
  return null;
}

function parseHandicap(leg) {
  const text = String(leg.selection_name || leg.selection_id || '');
  const m = text.trim().match(/^(.*?)\s*\(\s*([+-]?\d+(?:[.,]\d+)?)\s*\)\s*$/);
  if (!m) return null;
  const point = parseFloat(m[2].replace(',', '.'));
  if (Number.isNaN(point) || (point * 2) % 1 !== 0) return null; // quarter lines: manual
  const who = norm(m[1]);
  let side = null;
  if (who === '1' || (leg.match_home && who === norm(leg.match_home))) side = 'HOME';
  else if (who === '2' || (leg.match_away && who === norm(leg.match_away))) side = 'AWAY';
  return side ? { side, point } : null;
}

// Pure decision logic for a single bet leg given the final match result.
// Kept separate from settleMatch (which is DB-coupled) so it can be unit
// tested without a database. Returns 'WON' | 'LOST' | 'VOID' (stake
// refunded, e.g. a push) | null (null = leave PENDING for manual review).
export function determineLegOutcome(leg, { winner, totalGoals, bothScored, homeScore, awayScore, htHome, htAway }) {
  const marketId = String(leg.market_id ?? '');
  const hasScore = Number.isFinite(homeScore) && Number.isFinite(awayScore);

  // ---- canonical keys ----
  if (marketId.endsWith('-h2h')) {
    return leg.selection_id === winner ? 'WON' : 'LOST';
  }
  if (marketId.endsWith('-totals')) {
    const idx = leg.selection_id.lastIndexOf('-');
    return overUnderOutcome(leg.selection_id.slice(0, idx), parseFloat(leg.selection_id.slice(idx + 1)), totalGoals);
  }
  if (marketId.endsWith('-btts')) {
    if (leg.selection_id === 'Yes') return bothScored ? 'WON' : 'LOST';
    if (leg.selection_id === 'No') return !bothScored ? 'WON' : 'LOST';
  }

  // ---- name-based (also covers canonical keys with unusual option text) ----
  const marketName = norm(leg.market_name);
  if (!marketName) return null;

  const { period, base } = splitPeriod(marketName);
  if (period) {
    // Needs the half-time score; without it (e.g. the server was down at HT) the
    // leg is left PENDING rather than guessed.
    if (!hasScore || !Number.isFinite(htHome) || !Number.isFinite(htAway)) return null;
    const h = period === 'H1' ? htHome : homeScore - htHome;
    const a = period === 'H1' ? htAway : awayScore - htAway;
    if (h < 0 || a < 0) return null;
    return determineLegOutcome(
      { ...leg, market_id: '', market_name: PERIOD_BASE_ALIASES[base] || base },
      { winner: h > a ? 'HOME' : a > h ? 'AWAY' : 'DRAW', totalGoals: h + a, bothScored: h > 0 && a > 0, homeScore: h, awayScore: a }
    );
  }
  if (PERIOD_OR_COMBO.test(marketName)) return null;

  if (H2H_NAMES.has(marketName)) {
    const side = sideOfSelection(leg);
    return side ? (side === winner ? 'WON' : 'LOST') : null;
  }

  if (BTTS_NAMES.has(marketName) || marketId.endsWith('-btts')) {
    const sel = norm(leg.selection_name || leg.selection_id);
    if (sel === 'po' || sel === 'yes' || sel === 'gol') return bothScored ? 'WON' : 'LOST';
    if (sel === 'jo' || sel === 'no' || sel === 'jogol') return !bothScored ? 'WON' : 'LOST';
    return null;
  }

  if (DOUBLE_CHANCE_NAMES.has(marketName) || marketId.endsWith('-double_chance')) {
    const dc = normDoubleChance(leg.selection_id) || normDoubleChance(leg.selection_name);
    if (!dc) return null;
    const ok = dc === '1X' ? winner !== 'AWAY' : dc === 'X2' ? winner !== 'HOME' : winner !== 'DRAW';
    return ok ? 'WON' : 'LOST';
  }

  if (marketId.endsWith('-draw_no_bet') || /\b(no bet|draw no bet)\b|barazimi = rimbursim/.test(marketName)) {
    const side = sideOfSelection(leg);
    if (side !== 'HOME' && side !== 'AWAY') return null;
    if (winner === 'DRAW') return 'VOID';
    return side === winner ? 'WON' : 'LOST';
  }

  // Total goals of the whole match
  if (TOTAL_GOALS_PREFIXES.includes(marketName)) {
    const parsed = parseOverUnder(leg.selection_id) || parseOverUnder(leg.selection_name);
    if (parsed) return overUnderOutcome(parsed.side, parsed.point, totalGoals);
  }

  // Odd / even total goals ("Tek/Çift")
  if (/\b(tek|odd)\b/.test(marketName) && /\b(cift|even)\b/.test(marketName)) {
    const sel = norm(leg.selection_name || leg.selection_id);
    const odd = totalGoals % 2 === 1;
    if (sel === 'tek' || sel === 'odd') return odd ? 'WON' : 'LOST';
    if (sel === 'cift' || sel === 'even') return !odd ? 'WON' : 'LOST';
    return null;
  }

  if (!hasScore) return null;

  // Exact final score
  if (CORRECT_SCORE_NAMES.has(marketName)) {
    const m = String(leg.selection_name || leg.selection_id).trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
    if (!m) return null; // "Tjetër" / any-other-score: manual
    return Number(m[1]) === homeScore && Number(m[2]) === awayScore ? 'WON' : 'LOST';
  }

  // Team-specific total goals: "<prefix> <team name>"
  for (const prefix of TOTAL_GOALS_PREFIXES) {
    for (const [team, goals] of [[leg.match_home, homeScore], [leg.match_away, awayScore]]) {
      if (team && marketName === `${prefix} ${norm(team)}`) {
        const parsed = parseOverUnder(leg.selection_id) || parseOverUnder(leg.selection_name);
        if (parsed) return overUnderOutcome(parsed.side, parsed.point, goals);
      }
    }
  }

  // Handicap (whole / half lines only)
  if (HANDICAP_NAMES.has(marketName) || marketId.endsWith('-spreads')) {
    const h = parseHandicap(leg);
    if (!h) return null;
    const diff = h.side === 'HOME' ? homeScore + h.point - awayScore : awayScore + h.point - homeScore;
    if (diff === 0) return 'VOID';
    return diff > 0 ? 'WON' : 'LOST';
  }

  return null;
}

// Recompute a bet's overall status from its legs, and pay out balance
// exactly once, the moment it transitions into WON (or VOID = refund).
//
// VOID legs (pushes) are dropped from the ticket: the remaining legs decide
// it and the payout is recalculated without them (stake x odds of the
// non-void legs). A ticket whose legs are ALL void is refunded its stake.
//
// `FOR UPDATE` on the bet row is what makes this safe under concurrent
// calls (e.g. the admin manual-settle route and the automatic live
// poller both reacting to the same match around the same time): it
// forces a second concurrent call for the same betId to block until the
// first one commits, then re-read the ALREADY-UPDATED status — so its
// `nextStatus === bet.status` check below correctly short-circuits
// instead of paying out a second time.
export async function recomputeBetStatus(betId, client = pool) {
  const { rows: betRows } = await client.query('SELECT * FROM bets WHERE id = $1 FOR UPDATE', [betId]);
  const bet = betRows[0];
  if (!bet) return;
  const { rows: legs } = await client.query('SELECT * FROM bet_selections WHERE bet_id = $1', [betId]);
  if (legs.length === 0) return; // [].every(...) is true — never pay a bet that has no legs

  const active = legs.filter((l) => l.status !== 'VOID');
  let nextStatus;
  if (active.some((l) => l.status === 'LOST')) nextStatus = 'LOST';
  else if (active.length === 0) nextStatus = 'VOID';
  else if (active.every((l) => l.status === 'WON')) nextStatus = 'WON';
  else nextStatus = 'PENDING';

  if (nextStatus === bet.status) return;

  if (nextStatus === 'WON' && active.length < legs.length) {
    // Some legs were refunded: pay on the remaining legs only.
    const totalOdds = active.reduce((acc, l) => acc * Number(l.odds), 1);
    const payout = Number((Number(bet.stake) * totalOdds).toFixed(2));
    await client.query('UPDATE bets SET status = $1, total_odds = $2, potential_return = $3 WHERE id = $4', [nextStatus, totalOdds, payout, betId]);
    if (bet.status !== 'WON') await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [payout, bet.user_id]);
    return;
  }

  await client.query('UPDATE bets SET status = $1 WHERE id = $2', [nextStatus, betId]);
  if (nextStatus === 'WON' && bet.status !== 'WON') {
    await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [bet.potential_return, bet.user_id]);
  }
  if (nextStatus === 'VOID' && bet.status !== 'VOID') {
    await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [bet.stake, bet.user_id]);
  }
}

// Legs the rules above cannot decide stay PENDING for manual settlement. The real
// market names come from the provider, so log each distinct one once per process:
// that tells which markets people actually bet on that still have no rule.
const loggedUnrecognized = new Set();
function noteUnrecognizedMarket(leg) {
  const key = String(leg.market_name || leg.market_id || '?');
  if (loggedUnrecognized.has(key) || loggedUnrecognized.size >= 300) return;
  loggedUnrecognized.add(key);
  console.log('[settle] no auto rule for market "' + key + '" (selection "' + (leg.selection_name || leg.selection_id) + '") -- left PENDING for manual settlement');
}

// Given a final score, automatically settles every market whose winner is
// unambiguous from the final score alone (see determineLegOutcome): 1X2,
// double chance, draw-no-bet, over/under (match and team), BTTS, odd/even,
// correct score and whole/half-line handicaps. Anything else (half-time
// markets, combos, quarter handicaps) is left PENDING for manual review.
// Returns null if the match doesn't exist or is already settled (so callers
// — both the admin route and the automatic poller — never double-pay a bet);
// settleStuckBets() below is the safety net that re-checks leftovers.
export async function settleMatch(matchId, homeScore, awayScore, { force = false } = {}) {
  const client = await pool.connect();
  try {
    const { rows: matchRows } = await client.query('SELECT * FROM matches_cache WHERE id = $1', [matchId]);
    const match = matchRows[0];
    if (!match) return null;
    if (!force && match.status === 'FINISHED' && match.settled_at) return null; // already settled, don't redo

    const totalGoals = homeScore + awayScore;
    const bothScored = homeScore > 0 && awayScore > 0;
    const winner = homeScore > awayScore ? 'HOME' : awayScore > homeScore ? 'AWAY' : 'DRAW';

    const { rows: legs } = await client.query(
      `SELECT * FROM bet_selections WHERE match_id = $1 AND status = 'PENDING'`,
      [matchId]
    );

    const affectedBetIds = new Set();
    let autoSettledCount = 0;
    let leftPendingCount = 0;

    await client.query('BEGIN');
    try {
      for (const leg of legs) {
        affectedBetIds.add(leg.bet_id);
        const outcome = determineLegOutcome(leg, {
          winner, totalGoals, bothScored, homeScore, awayScore,
          htHome: match.ht_home == null ? undefined : Number(match.ht_home),
          htAway: match.ht_away == null ? undefined : Number(match.ht_away),
        });

        if (outcome) {
          await client.query('UPDATE bet_selections SET status = $1 WHERE id = $2', [outcome, leg.id]);
          autoSettledCount++;
        } else {
          leftPendingCount++;
          noteUnrecognizedMarket(leg);
        }
      }

      await client.query(
        `UPDATE matches_cache SET status = 'FINISHED', result_home = $1, result_away = $2, settled_at = $3 WHERE id = $4`,
        [homeScore, awayScore, Date.now(), matchId]
      );

      for (const betId of affectedBetIds) await recomputeBetStatus(betId, client);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    return { autoSettledLegs: autoSettledCount, leftPendingForManualReview: leftPendingCount, affectedBets: affectedBetIds.size };
  } finally {
    client.release();
  }
}

// Safety net / verification pass. Walks every PENDING leg whose match is
// already FINISHED with a stored score and settles it from that score, then
// recomputes the affected tickets (and any ticket whose legs are all decided
// but whose own status is still PENDING). This is what closes tickets that
// were left "HAPUR" because settleMatch() had already run (and then refuses
// to run again) before the market type was understood, or a leg was missed.
// Idempotent: recomputeBetStatus locks the bet row and only pays on the
// transition into WON, so running it repeatedly never double-pays.
export async function settleStuckBets() {
  const client = await pool.connect();
  try {
    const { rows: legs } = await client.query(
      `SELECT bs.*, m.result_home, m.result_away, m.ht_home, m.ht_away
         FROM bet_selections bs
         JOIN matches_cache m ON m.id = bs.match_id
        WHERE bs.status = 'PENDING'
          AND m.status = 'FINISHED'
          AND m.result_home IS NOT NULL AND m.result_away IS NOT NULL`
    );
    const { rows: undecided } = await client.query(
      `SELECT b.id FROM bets b
        WHERE b.status = 'PENDING'
          AND EXISTS (SELECT 1 FROM bet_selections x WHERE x.bet_id = b.id)
          AND NOT EXISTS (SELECT 1 FROM bet_selections x WHERE x.bet_id = b.id AND x.status = 'PENDING')`
    );

    const affectedBetIds = new Set(undecided.map((r) => r.id));
    let settledLegs = 0;

    await client.query('BEGIN');
    try {
      for (const leg of legs) {
        const home = Number(leg.result_home);
        const away = Number(leg.result_away);
        const outcome = determineLegOutcome(leg, {
          winner: home > away ? 'HOME' : away > home ? 'AWAY' : 'DRAW',
          totalGoals: home + away,
          bothScored: home > 0 && away > 0,
          homeScore: home,
          awayScore: away,
          htHome: leg.ht_home == null ? undefined : Number(leg.ht_home),
          htAway: leg.ht_away == null ? undefined : Number(leg.ht_away),
        });
        if (!outcome) { noteUnrecognizedMarket(leg); continue; }
        await client.query('UPDATE bet_selections SET status = $1 WHERE id = $2', [outcome, leg.id]);
        affectedBetIds.add(leg.bet_id);
        settledLegs++;
      }
      for (const betId of affectedBetIds) await recomputeBetStatus(betId, client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    return { settledLegs, recomputedBets: affectedBetIds.size };
  } finally {
    client.release();
  }
}

// ---- closure guarantee ------------------------------------------------------
// A ticket is either still open because its match has not finished yet, or it is
// closed. It must never sit "HAPUR" for good. Two kinds of leg can still get stuck
// after everything above: a market no rule can decide (the provider's own naming,
// manual settlement never done) and a match that never produces a result
// (postponed, abandoned, dropped by the feed). Once the match is more than
// UNSETTLED_BET_VOID_AFTER_HOURS (default 24h) past kickoff, such a leg is VOIDed:
// it drops out of the ticket (a single bet is refunded, an accumulator is paid on
// its remaining legs) -- the same treatment a bookmaker gives a postponed match.
// 0 disables it. Admins can still settle any of these by hand before the deadline.
const UNSETTLED_VOID_AFTER_MS = Math.max(0, Number(process.env.UNSETTLED_BET_VOID_AFTER_HOURS ?? 24)) * 3600 * 1000;

export function isLegOverdue({ matchStart, betCreatedAt }, now, olderThanMs) {
  if (!(olderThanMs > 0)) return false;
  const start = Date.parse(matchStart);
  // No match row any more (cleaned up): fall back to when the ticket was placed.
  const ref = Number.isFinite(start) ? start : Number(betCreatedAt);
  return Number.isFinite(ref) && now - ref > olderThanMs;
}

export async function voidOverdueLegs({ olderThanMs = UNSETTLED_VOID_AFTER_MS, now = Date.now() } = {}) {
  if (!(olderThanMs > 0)) return { voidedLegs: 0, recomputedBets: 0, disabled: true };
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT bs.id, bs.bet_id, bs.match_id, bs.market_name, bs.selection_name,
              m.start_time AS match_start, b.created_at AS bet_created_at
         FROM bet_selections bs
         JOIN bets b ON b.id = bs.bet_id AND b.status = 'PENDING'
         LEFT JOIN matches_cache m ON m.id = bs.match_id
        WHERE bs.status = 'PENDING'`
    );
    const overdue = rows.filter((r) => isLegOverdue({ matchStart: r.match_start, betCreatedAt: r.bet_created_at }, now, olderThanMs));
    if (overdue.length === 0) return { voidedLegs: 0, recomputedBets: 0 };

    const betIds = new Set();
    await client.query('BEGIN');
    try {
      for (const leg of overdue) {
        await client.query(`UPDATE bet_selections SET status = 'VOID' WHERE id = $1 AND status = 'PENDING'`, [leg.id]);
        betIds.add(leg.bet_id);
      }
      for (const betId of betIds) await recomputeBetStatus(betId, client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    for (const leg of overdue) {
      console.log('[settle] voided overdue leg (no result/rule ' + Math.round(olderThanMs / 3600000) + 'h after kickoff): match ' + leg.match_id + ' / "' + (leg.market_name || '?') + '" / "' + (leg.selection_name || '?') + '"');
    }
    return { voidedLegs: overdue.length, recomputedBets: betIds.size };
  } finally {
    client.release();
  }
}
