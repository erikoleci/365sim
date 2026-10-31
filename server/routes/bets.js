import { noteOddsRefusal, isAcceptedRetry, forgetOddsRefusal } from '../oddsAcceptance.js';
import express from 'express';
import { randomUUID } from 'crypto';
import pool from '../db.js';
import { requireAuth } from './auth.js';
import { resolveCurrentSelection, mapEventToMatch, isStaleLive } from '../oddsUtils.js';
import { getBetBlockReason, describeBlockReason, nextEventKind, eventOrderOrdinal, isLiveCornerMarket, isLiveCardMarket } from '../marketRules.js';
import { readNextEventCounters, readLiveCorners, readLiveCards } from '../matchSettlement.js';
import { findCorrelatedSelections } from '../ticketCorrelation.js';
import { findConflictingSelection, validateStakeAmount, getCancelBlockReason, isLiveEventLocked } from '../betValidation.js';
import { getLiveRisk, riskPolicy } from '../liveRisk.js';
import { getLiveDetailAgeMs, isLiveDetailStale } from '../liveDetailPlan.js';
import { wrap } from '../asyncHandler.js';
import { noteBetOnMatches } from '../oddsHistoryPolicy.js';
import { walletColumn, normalizeCurrency } from '../ledger.js';

// Pool pressure (live import/socket writes share the same few connections) or a dropped idle
// connection used to surface as "503 Service temporarily unavailable" on ticket placement.
// These errors are transient and, before COMMIT, safe to retry: nothing was booked.
const TRANSIENT_DB_CODES = new Set([
  'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN',
  '57P01', '53300', '53400', '40001', '40P01', '57014', '08006', '08003', '08001',
]);
function isTransientDbErr(err) {
  if (!err) return false;
  if (TRANSIENT_DB_CODES.has(err.code)) return true;
  const msg = String(err.message || '');
  return msg.includes('timeout exceeded when trying to connect')
    || msg.includes('Connection terminated')
    || msg.includes('connection is not open')
    || msg.includes('remaining connection slots')
    || msg.includes('canceling statement due to statement timeout');
}
async function withDbRetry(fn, { retries = 2, delayMs = 300 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (!isTransientDbErr(err) || attempt === retries) throw err;
      console.warn(`[bets] transient db error (attempt ${attempt + 1}/${retries + 1}), retrying:`, err.message);
      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}
const dbq = (text, params) => withDbRetry(() => pool.query(text, params));

// After a goal / red card on a LIVE match, bets on it are refused for this long so
// nobody can bet on prices that have not caught up with what just happened. 0 = off.
// After a corner, bets on the corner TOTALS wait this long (the counter and the odds need to catch up).
const LIVE_CORNER_LOCK_MS = Math.max(0, Number(process.env.LIVE_BET_CORNER_LOCK_MS ?? 15000));
// Yellow cards do not lock the whole match (only goals / red cards do), but the card totals are re-priced
// by the provider right after each card, so betting on them pauses briefly after any card.
const LIVE_CARD_LOCK_MS = Math.max(0, Number(process.env.LIVE_BET_CARD_LOCK_MS ?? 15000));
const LIVE_EVENT_LOCK_MS = Math.max(0, Number(process.env.LIVE_BET_EVENT_LOCK_MS ?? 30000));
// After the delay the ticket is booked at the WORSE of the price seen before and after the delay.
// If the price fell by more than this share the ticket is not booked: the player must re-confirm the new price.
const LIVE_REPRICE_TOLERANCE = Math.max(0, Number(process.env.LIVE_REPRICE_TOLERANCE ?? 0.10));
const LIVE_BET_DELAY_MS = Math.max(0, Number(process.env.LIVE_BET_DELAY_MS ?? 5000));
// High-stake tickets are held for the same delay and re-verified, even when prematch
// (must match PENDING_STAKE_THRESHOLD in components/BetSlip.tsx).
const HIGH_STAKE_DELAY = { ALL: Number(process.env.HIGH_STAKE_DELAY_ALL ?? 5000), EUR: Number(process.env.HIGH_STAKE_DELAY_EUR ?? 50) };
// Anti-abuse for live betting (people who play live all the time trying to beat the feed delay):
//  - a lower max stake on live tickets (0 = off)
//  - a cap on how many live tickets one user can place per minute (0 = off)
//  - a cap on live tickets per user on the same match per 10 minutes (0 = off)
const LIVE_MAX_STAKE = { ALL: Number(process.env.LIVE_MAX_STAKE_ALL ?? 100000), EUR: Number(process.env.LIVE_MAX_STAKE_EUR ?? 1000) };
const LIVE_MAX_TICKETS_PER_MIN = Math.max(0, Number(process.env.LIVE_MAX_TICKETS_PER_MIN ?? 6));
const LIVE_MAX_TICKETS_PER_MATCH = Math.max(0, Number(process.env.LIVE_MAX_TICKETS_PER_MATCH ?? 8));

// Markets other than 1X2 on a LIVE match come from the budgeted full-market refresh
// (liveDetailPlan.js). If that refresh is older than this, the prices may be stale
// and bets on them are refused until it catches up. 0 = off.
const LIVE_ODDS_MAX_AGE_MS = Math.max(0, Number(process.env.LIVE_BET_ODDS_MAX_AGE_MS ?? 120000));

const CANCEL_WINDOW_MS = 10 * 60 * 1000; // must match the window shown in BetSlip.tsx

const router = express.Router();

router.use(requireAuth);

// --- Ticket rules (kept simple & proportional to a play-money simulator,
// not a full enterprise risk-limits system) ---
const MIN_STAKE = 10;
// Max stake per ticket; the payout is additionally bounded by
// MAX_POTENTIAL_RETURN and the per-selection exposure cap below.
const MAX_STAKE = 1000000; // must match MAX_STAKE in components/BetSlip.tsx
const MAX_SELECTIONS_PER_TICKET = 20;
const MAX_POTENTIAL_RETURN = 1000000;
// Risk Management: max total liability the house will carry on a single
// outcome (sum of potential_return across all PENDING tickets backing that
// exact selection). Prevents one popular pick from exposing the operator
// to unbounded payout if it hits — a real trading desk would hedge/adjust
// odds instead; this is the simplest safety net for a simulator.
const MAX_SELECTION_EXPOSURE = 5000000;
// Euro tickets use their own limits (must match components/BetSlip.tsx). For the shared risk cap below a euro
// counts as RISK_EUR_TO_ALL lek, so euro and lek tickets add up on the same scale.
const MIN_STAKE_EUR = 1;
const MAX_STAKE_EUR = 10000;
const MAX_POTENTIAL_RETURN_EUR = 10000;
const RISK_EUR_TO_ALL = 100;
// How much worse the current odds are allowed to be vs. what the user saw
// when they built the slip, before we reject instead of silently accepting
// a worse price. 2% tolerance absorbs normal rounding/timing noise.
const ODDS_WORSENING_TOLERANCE = 0.02;
// "Prano Ndryshimet & Vendos": the player accepted the prices shown on the slip. If the price moved
// again by less than this share while they pressed, the ticket is still booked at the price they
// accepted (a bigger drop asks them again). See server/oddsAcceptance.js.
const ACCEPTED_RETRY_TOLERANCE = Math.max(0, Number(process.env.ACCEPTED_RETRY_TOLERANCE ?? 0.25));

// "Special Offers" boost: a fixed, server-verified uplift applied only when
// the client explicitly flags a selection as boosted AND that selection is
// legitimately eligible (see isBoostEligible below). Deliberately narrow —
// single-bet only, favorite-only, one flat multiplier — so it can't be
// combined with accumulators/SGM to inflate payouts beyond what the boost
// strip actually advertises.
const BOOST_MULTIPLIER = 1.12;

function isBoostEligible(matchRow, sel) {
  if (!sel.marketId.endsWith('-h2h')) return false;
  const match = mapEventToMatch(matchRow);
  const market = match.markets.find((m) => m.id === sel.marketId);
  if (!market) return false;
  const priced = market.options.filter((o) => o.odds > 0);
  if (priced.length === 0) return false;
  const favorite = priced.reduce((min, o) => (o.odds < min.odds ? o : min), priced[0]);
  return favorite.id === sel.selectionId;
}

router.get('/', wrap(async (req, res) => {
  const { rows: bets } = await pool.query('SELECT * FROM bets WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
  // Fetch all selections for every bet in a single round trip instead of one
  // query per bet (N+1), then group them in memory.
  const betIds = bets.map((b) => b.id);
  const selectionsByBet = new Map();
  if (betIds.length) {
    const { rows: selections } = await pool.query('SELECT * FROM bet_selections WHERE bet_id = ANY($1::text[])', [betIds]);
    for (const sel of selections) {
      if (!selectionsByBet.has(sel.bet_id)) selectionsByBet.set(sel.bet_id, []);
      selectionsByBet.get(sel.bet_id).push(sel);
    }
  }
  // Server-side verdict on whether each open ticket can still be cancelled
  // (never placed live, match not started) so the UI hides the button for
  // exactly the tickets the cancel route would reject.
  const pendingMatchIds = [...new Set(
    bets.filter((b) => b.status === 'PENDING').flatMap((b) => (selectionsByBet.get(b.id) || []).map((x) => x.match_id))
  )];
  const matchById = new Map();
  if (pendingMatchIds.length) {
    const { rows: ms } = await pool.query(
      'SELECT id, start_time, status, live_status FROM matches_cache WHERE id = ANY($1::text[])', [pendingMatchIds]
    );
    for (const m of ms) matchById.set(m.id, m);
  }
  const withSelections = bets.map((b) => {
    const selections = selectionsByBet.get(b.id) || [];
    const matches = selections.map((x) => matchById.get(x.match_id)).filter(Boolean);
    const cancellable = matches.length === selections.length &&
      getCancelBlockReason(b, matches, { windowMs: CANCEL_WINDOW_MS }) === null;
    return { ...b, selections, cancellable };
  });
  res.json({ bets: withSelections });
}));

router.post('/', wrap(async (req, res) => {
  const { stake, selections } = req.body || {};
  // The ticket is placed, refunded and paid out in ONE wallet: lek ('ALL', default) or euro ('EUR').
  const currency = normalizeCurrency((req.body || {}).currency);
  const wallet = walletColumn(currency);
  // Ticket type is derived from the selections, never trusted from the client.
  const ticketType = Array.isArray(selections) && selections.length > 1 ? 'ACCUMULATOR' : 'SINGLE';

  if (!Array.isArray(selections) || selections.length === 0) {
    return res.status(400).json({ error: 'At least one selection is required' });
  }
  if (selections.length > MAX_SELECTIONS_PER_TICKET) {
    return res.status(400).json({ error: `Maximum ${MAX_SELECTIONS_PER_TICKET} selections per ticket` });
  }
  const stakeError = currency === 'EUR'
    ? validateStakeAmount(stake, { min: MIN_STAKE_EUR, max: MAX_STAKE_EUR })
    : validateStakeAmount(stake, { min: MIN_STAKE, max: MAX_STAKE });
  if (stakeError) {
    return res.status(400).json({ error: stakeError });
  }

  // --- Conflict detection: reject mutually exclusive / duplicate selections
  // from the same market on the same match (e.g. Home + Draw from the same
  // 1X2 market, or Over 2.5 + Under 2.5 from the same totals market — both
  // share the same marketId, just a different selectionId). A single ticket
  // backing two outcomes of the same market on the same match is either a
  // mistake or a guaranteed-outcome exploit; either way, reject it clearly
  // rather than silently accepting it. ---
  const conflict = findConflictingSelection(selections);
  if (conflict) {
    return res.status(400).json({
      error: `Conflicting selections: "${conflict.existingSelectionId}" and "${conflict.newSelectionId}" are both from the same market on the same match.`,
    });
  }

  const { rows: userRows } = await dbq('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const user = userRows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (Number(user[wallet]) < stake) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  // Re-verify each selection's odds against the current cache instead of
  // trusting the client, and reject if odds moved unfavorably beyond
  // tolerance (odds protection) instead of silently booking a worse price.
  const fail = (status, body) => ({ fail: { status, body } });
  const verifySelections = async (tolerance = ODDS_WORSENING_TOLERANCE, { bookAtSent = false } = {}) => {
  let totalOdds = 1;
  let inPlay = false;
  const verifiedSelections = [];
  const correlationInput = [];
  // Collected across ALL selections instead of returning on the first one
  // found (the previous behavior): for an accumulator, if 2-3 prices moved
  // at once, a client that resubmits after fixing selection #1 would just
  // immediately hit selection #2's change next, then #3 — a multi-round-trip
  // loop the person feels as "it keeps rejecting my bet". Collecting every
  // change and returning them together in one 409 lets the frontend show a
  // single "odds changed — accept new price?" prompt with the whole updated
  // ticket at once, matching the one-shot re-offer flow real bookmakers use,
  // instead of a live-fire-by-fire retry loop.
  const oddsChanges = [];
  // True when any selection is on a match that is already running: live tickets earn the lower agent commission.
  let isLiveTicket = false;

  // Boost is only ever honored for true single bets (one selection) — this
  // keeps liability predictable and matches what the Special Offers strip
  // actually shows (a single boosted favorite), never stacked with an SGM/accumulator.
  const boostRequested = selections.length === 1 && selections[0]?.boosted === true;

  for (const sel of selections) {
    const { rows: matchRows } = await dbq('SELECT * FROM matches_cache WHERE id = $1', [sel.matchId]);
    const matchRow = matchRows[0];
    if (!matchRow) {
      return fail(400, { error: `Match ${sel.matchId} not found or no longer available` });
    }
    if (matchRow.status === 'FINISHED' || isStaleLive(matchRow.start_time, matchRow.status)) {
      return fail(400, {
        error: `Match ${matchRow.home_team} vs ${matchRow.away_team} has already finished — betting is closed.`,
        code: 'MATCH_FINISHED',
        closed: [{ matchId: sel.matchId, marketId: sel.marketId, selectionId: sel.selectionId }],
      });
    }
    if (LIVE_EVENT_LOCK_MS > 0 && (matchRow.status === 'LIVE' || matchRow.live_status != null)) {
      const { rows: evRows } = await dbq(
        "SELECT MAX(created_at) AS last_at FROM match_events WHERE match_id = $1 AND type IN ('GOAL','RED_CARD')",
        [matchRow.id]
      );
      if (isLiveEventLocked(matchRow, evRows[0]?.last_at, { lockMs: LIVE_EVENT_LOCK_MS })) {
        return fail(409, {
          error: `Betting on ${matchRow.home_team} vs ${matchRow.away_team} is paused for a few seconds after a goal or red card — odds are updating.`,
          code: 'LIVE_EVENT_LOCK',
        });
      }
    }
    if (LIVE_ODDS_MAX_AGE_MS > 0 && (matchRow.status === 'LIVE' || matchRow.live_status != null) && !String(sel.marketId).endsWith('-h2h')) {
      const stale = isLiveDetailStale({
        ageMs: getLiveDetailAgeMs(matchRow.id),
        maxAgeMs: LIVE_ODDS_MAX_AGE_MS,
        uptimeMs: process.uptime() * 1000,
      });
      if (stale) {
        return fail(409, {
          error: `Odds for ${matchRow.home_team} vs ${matchRow.away_team} are being refreshed — please try again in a moment.`,
          code: 'LIVE_ODDS_STALE',
        });
      }
    }
    const current = resolveCurrentSelection(matchRow, sel.marketId, sel.selectionId);
    if (current === null) {
      return fail(400, { error: `Selection ${sel.selectionId} in market ${sel.marketId} not found in current odds — it may have closed or moved` });
    }
    if (matchRow.status === 'LIVE' || matchRow.live_status != null) {
      isLiveTicket = true;
      if (isLiveCornerMarket(current.marketName)) {
        matchRow.live_corners = await readLiveCorners(pool, matchRow.id);
        if (LIVE_CORNER_LOCK_MS > 0) {
          const { rows: cRows } = await dbq("SELECT MAX(created_at) AS last_at FROM match_events WHERE match_id = $1 AND type = 'CORNER'", [matchRow.id]);
          if (isLiveEventLocked(matchRow, cRows[0]?.last_at, { lockMs: LIVE_CORNER_LOCK_MS })) {
            return fail(409, {
              error: `Betting on corner markets for ${matchRow.home_team} vs ${matchRow.away_team} is paused for a few seconds after a corner — odds are updating.`,
              code: 'LIVE_EVENT_LOCK',
            });
          }
        }
      }
      if (isLiveCardMarket(current.marketName)) {
        matchRow.live_cards = await readLiveCards(pool, matchRow.id);
        if (LIVE_CARD_LOCK_MS > 0) {
          const { rows: kRows } = await dbq("SELECT MAX(created_at) AS last_at FROM match_events WHERE match_id = $1 AND type IN ('YELLOW_CARD','RED_CARD')", [matchRow.id]);
          if (isLiveEventLocked(matchRow, kRows[0]?.last_at, { lockMs: LIVE_CARD_LOCK_MS })) {
            return fail(409, {
              error: `Betting on card markets for ${matchRow.home_team} vs ${matchRow.away_team} is paused for a few seconds after a card — odds are updating.`,
              code: 'LIVE_EVENT_LOCK',
            });
          }
        }
      }
    }
    // Period rule, enforced here (not just by locking the button): a first-half
    // market takes no bets once the first half is over, even if a stale client
    // or a cached price still offers it.
    // Same rule for EVERY market type (marketRules.js): decided outcomes and markets we
    // cannot verify against live data are refused while the match is in play.
    const closedReason = getBetBlockReason(
      matchRow,
      { id: sel.marketId, name: current.marketName },
      { id: sel.selectionId, name: current.selectionName || sel.selectionName }
    );
    if (matchRow.status === 'LIVE' || matchRow.live_status != null) inPlay = true;
    // first corner / first card in play: only while none has happened yet (live counters)
    let ordinalReason = null;
    const ordinal = eventOrderOrdinal(current.marketName);
    if (!closedReason && inPlay && ordinal && ordinal.kind !== 'goal' && !ordinal.last) {
      const counters = await readNextEventCounters(pool, sel.matchId, ordinal.kind);
      const total = counters ? counters.home + counters.away : NaN;
      // first corner / card: only while none has happened; the Nth corner: while fewer than N have
      ordinalReason = !counters ? 'NOT_VERIFIABLE_LIVE'
        : ((ordinal.kind === 'corner' ? total >= ordinal.n : total !== ordinal.n - 1) ? 'OUTCOME_DECIDED' : null);
    }
    if (closedReason || ordinalReason) {
      const why = closedReason || ordinalReason;
      console.log('[bets] rejected bet: match=' + matchRow.id + ' market=' + sel.marketId + ' selection=' + sel.selectionId + ' reason=' + why + ' user=' + req.user.id);
      return fail(409, {
        error: `Betting on "${current.marketName}" is closed — ${describeBlockReason(why)}.`,
        code: 'MARKET_CLOSED',
        reason: why,
        closed: [{ matchId: sel.matchId, marketId: sel.marketId, selectionId: sel.selectionId }],
      });
    }
    if (closedReason) {
      console.log('[bets] rejected bet: match=' + matchRow.id + ' market=' + sel.marketId + ' selection=' + sel.selectionId + ' reason=' + closedReason + ' user=' + req.user.id);
      return fail(409, {
        error: `Betting on "${current.marketName}" is closed — ${describeBlockReason(closedReason)}.`,
        code: 'MARKET_CLOSED',
        reason: closedReason,
        closed: [{ matchId: sel.matchId, marketId: sel.marketId, selectionId: sel.selectionId }],
      });
    }
    let currentOdds = current.odds;
    // A price this low is never a genuine quote — it's the provider's
    // "market suspended" placeholder (see isSuspendedPrice in oddsUtils.js).
    // Betting must be rejected here even if a stale client somehow still
    // sent the selection, since the frontend disabling the button is only
    // a UX nicety, not the actual guard. Unlike an odds change, a suspended
    // market can't be "re-offered" at a new price — there is no price right
    // now — so this still fails the whole ticket immediately.
    if (currentOdds <= 1.01) {
      return fail(409, {
        error: `Betting on ${sel.selectionName} is temporarily suspended — please try again in a moment.`,
        code: 'SELECTION_SUSPENDED',
      });
    }
    if (boostRequested) {
      if (!isBoostEligible(matchRow, sel)) {
        return fail(400, { error: 'This selection is not eligible for the odds boost.' });
      }
      currentOdds = Number((currentOdds * BOOST_MULTIPLIER).toFixed(2));
    }
    if (typeof sel.odds === 'number' && currentOdds < sel.odds * (1 - tolerance)) {
      oddsChanges.push({
        matchId: sel.matchId,
        marketId: sel.marketId,
        selectionId: sel.selectionId,
        selectionName: sel.selectionName,
        oldOdds: sel.odds,
        newOdds: currentOdds,
      });
    }
    // Accepted retry: book at the price the player accepted when the live price slipped a little since
    // (never above what they sent, and never when it fell past the tolerance: that was refused above).
    const bookedOdds = bookAtSent && typeof sel.odds === 'number' && Number.isFinite(sel.odds) && sel.odds > currentOdds
      ? sel.odds : currentOdds;
    totalOdds *= bookedOdds;
    verifiedSelections.push({ ...sel, odds: bookedOdds });
    correlationInput.push({ matchId: sel.matchId, marketId: sel.marketId, marketName: current.marketName, optionName: current.selectionName || sel.selectionName, home: matchRow.home_team, away: matchRow.away_team, startTime: matchRow.start_time });
  }

  // Same-match selections with the same logic (4+ with 1+/2+/3+, 1 & 2+ with 0-3, 1 with 1X ...)
  // are refused: one outcome decides or overlaps the other.
  const correlated = findCorrelatedSelections(correlationInput);
  if (correlated) {
    return fail(400, {
      error: `Këto zgjedhje janë të lidhura me njëra-tjetrën (e njëjta logjikë) dhe nuk lejohen në të njëjtin kupon: "${correlated.first.marketName} - ${correlated.first.optionName}" dhe "${correlated.second.marketName} - ${correlated.second.optionName}". Zgjidh vetëm njërën.`,
      code: 'CORRELATED_SELECTIONS',
    });
  }

  if (oddsChanges.length > 0) {
    noteOddsRefusal(req.user.id, selections);
    return fail(409, {
      error: oddsChanges.length === 1
        ? `Odds for ${oddsChanges[0].selectionName} changed (was ${oddsChanges[0].oldOdds}, now ${oddsChanges[0].newOdds}).`
        : `Odds changed on ${oddsChanges.length} selections in your ticket.`,
      code: 'ODDS_CHANGED',
      changes: oddsChanges,
      // Kept for older clients that only read a single top-level newOdds.
      newOdds: oddsChanges[0].newOdds,
    });
  }

  return { totalOdds, verifiedSelections, inPlay, isLiveTicket };
  };

  const betStartedAt = Date.now();
  // Where the time goes for one ticket (logged once it is booked): see the [bets] timing line below.
  const phase = { verify1: 0, risk: 0, hold: 0, verify2: 0, tx: 0 };
  // Exact retry of a ticket just refused for moved prices = the player pressed "accept & place".
  const acceptedCandidate = isAcceptedRetry(req.user.id, selections);
  let verified = acceptedCandidate
    ? await verifySelections(ACCEPTED_RETRY_TOLERANCE, { bookAtSent: true })
    : await verifySelections();
  phase.verify1 = Date.now() - betStartedAt;
  if (verified.fail) return res.status(verified.fail.status).json(verified.fail.body);
  // Live bet delay: when any leg is in play, hold the ticket for a few seconds and
  // verify everything again against the freshest data, so a goal/card/half-time that
  // happened while the player was clicking cannot slip through.
  let risk = { level: 'NORMAL', hits: 0 };
  let policy = riskPolicy('NORMAL', LIVE_BET_DELAY_MS);
  if (verified.inPlay) {
    // Risk detection is an extra safety net: if it fails (e.g. a column of migration 0015 is
    // missing on this database) the ticket is still placed with the normal policy instead of a 503.
    try {
      risk = await getLiveRisk(pool, user.id);
    } catch (err) {
      console.error('[bets] live risk check failed, using NORMAL:', err && err.message);
    }
    policy = riskPolicy(risk.level, LIVE_BET_DELAY_MS);
    const liveCap = LIVE_MAX_STAKE[currency] * policy.stakeFactor;
    if (liveCap > 0 && stake > liveCap) {
      return res.status(400).json({
        error: `Maximum stake on a live ticket is ${liveCap} ${currency === 'EUR' ? '€' : 'L'}.`,
        code: 'LIVE_STAKE_LIMIT',
      });
    }
    if (LIVE_MAX_TICKETS_PER_MIN > 0) {
      const { rows: recent } = await dbq(
        'SELECT COUNT(*)::int AS n FROM bets WHERE user_id = $1 AND is_live = true AND created_at > $2',
        [user.id, Date.now() - 60000],
      );
      if (recent[0].n >= LIVE_MAX_TICKETS_PER_MIN) {
        return res.status(429).json({ error: 'Too many live tickets in a short time. Please wait a moment.', code: 'LIVE_RATE_LIMIT' });
      }
    }
    if (LIVE_MAX_TICKETS_PER_MATCH > 0) {
      const matchIds = [...new Set(selections.map((x) => String(x.matchId)))];
      const { rows: perMatch } = await dbq(
        `SELECT COUNT(DISTINCT b.id)::int AS n FROM bets b JOIN bet_selections bs ON bs.bet_id = b.id
         WHERE b.user_id = $1 AND b.is_live = true AND b.created_at > $2 AND bs.match_id = ANY($3::text[])`,
        [user.id, Date.now() - 600000, matchIds],
      ).catch(() => ({ rows: [{ n: 0 }] }));
      if (perMatch[0].n >= LIVE_MAX_TICKETS_PER_MATCH) {
        return res.status(429).json({ error: 'Too many live tickets on this match. Please wait.', code: 'LIVE_MATCH_LIMIT' });
      }
    }
  }
  phase.risk = Date.now() - betStartedAt - phase.verify1;
  const highStake = stake >= HIGH_STAKE_DELAY[currency];
  // The player is accepting the new prices of a ticket we just refused for moved prices: book it now,
  // at the price verified a moment ago, instead of making them wait (and chase the price) again.
  // Everything above (market, match, risk, limits) was checked as usual; flagged users keep the delay.
  const acceptedRetry = acceptedCandidate && risk.level === 'NORMAL';
  if (acceptedRetry) forgetOddsRefusal(req.user.id);
  else if (acceptedCandidate) {
    // A flagged user gets no special treatment: strict price check, normal delay.
    verified = await verifySelections();
    if (verified.fail) return res.status(verified.fail.status).json(verified.fail.body);
  }
  if ((verified.inPlay || highStake) && policy.delayMs > 0 && !acceptedRetry) {
    const firstPass = verified;
    const holdStartedAt = Date.now();
    // The delay counts from the moment the request arrived: the first verification and the risk checks are part of it,
    // so the player waits the delay itself (about 5 s), not the delay PLUS the work done before it.
    await new Promise((r) => setTimeout(r, Math.max(0, policy.delayMs - (Date.now() - betStartedAt))));
    // Second look at the freshest data. A small price drop is accepted, a big one asks the player again.
    phase.hold = Date.now() - holdStartedAt;
    const verify2StartedAt = Date.now();
    verified = await verifySelections(LIVE_REPRICE_TOLERANCE);
    phase.verify2 = Date.now() - verify2StartedAt;
    if (verified.fail) return res.status(verified.fail.status).json(verified.fail.body);
    // Book every leg at the worse of: price before the delay, price after the delay.
    const repriced = verified.verifiedSelections.map((leg, i) => {
      const before = firstPass.verifiedSelections[i]?.odds;
      return typeof before === 'number' && before < leg.odds ? { ...leg, odds: before } : leg;
    });
    verified = { ...verified, verifiedSelections: repriced, totalOdds: repriced.reduce((acc, leg) => acc * leg.odds, 1) };
  }
  const { totalOdds, verifiedSelections, isLiveTicket } = verified;

  const betId = randomUUID();
  const potentialReturn = Number((stake * totalOdds).toFixed(2));
  const maxReturn = currency === 'EUR' ? MAX_POTENTIAL_RETURN_EUR : MAX_POTENTIAL_RETURN;
  if (potentialReturn > maxReturn) {
    return res.status(400).json({ error: `Maximum potential payout is ${maxReturn}. Reduce your stake or selections.` });
  }

  let balanceAfterTx = null;
  // Returns true when a response was already sent. Throws only BEFORE commit, so a retry is safe.
  const runTicketTx = async (attempt) => {
  let committed = false;
  if (attempt > 0) {
    // A previous attempt may have lost the connection exactly at COMMIT: check if the ticket exists.
    const { rows: existing } = await pool.query('SELECT 1 FROM bets WHERE id = $1', [betId]);
    if (existing.length) return false;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Re-check balance inside the transaction to close the race window
    // between the SELECT above and this UPDATE (two simultaneous requests
    // from the same user could otherwise both pass the earlier check).
    const { rows: lockedUser } = await client.query(`SELECT ${wallet} FROM users WHERE id = $1 FOR UPDATE`, [user.id]);
    if (!lockedUser[0] || Number(lockedUser[0][wallet]) < stake) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Insufficient balance' });
      return true;
    }
    const balanceBefore = Number(lockedUser[0][wallet]);
    const balanceAfter = Number((balanceBefore - stake).toFixed(2));
    balanceAfterTx = balanceAfter;

    // Risk Management: exposure check. It must run INSIDE the transaction and
    // under a per-selection advisory lock: checked before BEGIN, two
    // simultaneous tickets on the same outcome could both read the old
    // exposure, both pass, and together blow through the cap. Keys are locked
    // in sorted order so concurrent tickets can never deadlock each other.
    const lockKeys = [...new Set(verifiedSelections.map((s) => `${s.matchId}::${s.marketId}::${s.selectionId}`))].sort();
    for (const key of lockKeys) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
    }
    for (const sel of verifiedSelections) {
      const { rows: exposureRows } = await client.query(
        `SELECT COALESCE(SUM(b.potential_return * CASE WHEN b.currency = 'EUR' THEN ${RISK_EUR_TO_ALL} ELSE 1 END), 0) AS exposure
         FROM bet_selections bs JOIN bets b ON b.id = bs.bet_id
         WHERE bs.match_id = $1 AND bs.market_id = $2 AND bs.selection_id = $3 AND b.status = 'PENDING'`,
        [sel.matchId, sel.marketId, sel.selectionId]
      );
      if (Number(exposureRows[0].exposure) + potentialReturn * (currency === 'EUR' ? RISK_EUR_TO_ALL : 1) > MAX_SELECTION_EXPOSURE) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: `This selection is temporarily limited due to high exposure. Try a smaller stake.` });
        return true;
      }
    }

    await client.query(`UPDATE users SET ${wallet} = ${wallet} - $1 WHERE id = $2`, [stake, user.id]);
    await client.query(
      `INSERT INTO bets (id, user_id, type, stake, total_odds, potential_return, status, created_at, currency, is_live)
       VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$9)`,
      [betId, user.id, ticketType, stake, totalOdds, potentialReturn, Date.now(), currency, isLiveTicket]
    );
    // Audit trail: the stake debit is recorded (reference = bet id) so the money
    // movement survives even if the ticket row is later cancelled/deleted.
    await client.query(
      `INSERT INTO transactions
        (actor_id, source_id, target_id, amount, type, reference,
         source_balance_before, source_balance_after, target_balance_before, target_balance_after, created_at, currency)
       VALUES ($1,$1,$1,$2,'BET_STAKE',$3,$4,$5,$4,$5,$6,$7)`,
      [user.id, stake, betId, balanceBefore, balanceAfter, Date.now(), currency]
    );
    for (const sel of verifiedSelections) {
      // "Next goal / corner / card": remember the counter of that kind at this very moment
      const kind = nextEventKind(sel.marketName);
      const counters = kind ? await readNextEventCounters(client, sel.matchId, kind) : null;
      await client.query(
        `INSERT INTO bet_selections
          (bet_id, match_id, match_home, match_away, market_id, market_name, selection_id, selection_name, odds, status, placed_at, placed_counts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',$10,$11)`,
        [betId, sel.matchId, sel.matchHome, sel.matchAway, sel.marketId, sel.marketName, sel.selectionId, sel.selectionName, sel.odds, Date.now(), counters ? JSON.stringify(counters) : null]
      );
    }
    await client.query('COMMIT');
    committed = true;
    // From now on price moves on these matches are worth recording in
    // odds_history (see oddsHistoryPolicy.js). Best effort: the ticket is already booked.
    try {
      noteBetOnMatches(verifiedSelections.map((s) => s.matchId));
    } catch (err) {
      console.error('[bets] noteBetOnMatches failed:', err && err.message);
    }
  } catch (err) {
    if (committed) {
      console.error('[bets] error after COMMIT (ticket is booked):', err && err.message);
    } else {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  } finally {
    client.release();
  }
  return false;
  };
  const txStartedAt = Date.now();
  if (await withDbRetry(runTicketTx, { retries: 2, delayMs: 400 })) return;
  phase.tx = Date.now() - txStartedAt;

  let updatedRows;
  try {
    ({ rows: updatedRows } = await dbq('SELECT * FROM users WHERE id = $1', [user.id]));
  } catch (err) {
    // The ticket is already booked: never answer 503 here (the player would place it twice).
    console.error('[bets] balance read after commit failed, using computed balance:', err && err.message);
    updatedRows = [{ ...user, ...(balanceAfterTx != null ? { [wallet]: balanceAfterTx } : {}) }];
  }
  // One line per booked ticket: total time and the phases (verify = price/market checks, hold = the
  // live delay, tx = booking in the database). A ticket that took long shows which phase was slow.
  const totalMs = Date.now() - betStartedAt;
  (totalMs > 7000 ? console.warn : console.log)(`[bets] ticket ${betId} booked in ${totalMs}ms (verify1=${phase.verify1} risk=${phase.risk} hold=${phase.hold} verify2=${phase.verify2} tx=${phase.tx} live=${Boolean(isLiveTicket)})`);
  res.status(201).json({
    bet: { id: betId, totalOdds, potentialReturn, stake, currency },
    balance: updatedRows[0].balance,
    balanceEur: updatedRows[0].balance_eur,
  });
}));

// A user can cancel their OWN bet while it's still PENDING and within the
// cancellation window — enforced server-side (not just hidden in the UI
// after 10 minutes), since the client's clock/timer can't be trusted.
router.post('/:id/cancel', wrap(async (req, res) => {
  const { rows: betRows } = await pool.query('SELECT * FROM bets WHERE id = $1', [req.params.id]);
  const bet = betRows[0];
  if (!bet) return res.status(404).json({ error: 'Bet not found' });
  if (bet.user_id !== req.user.id) return res.status(403).json({ error: 'Not your bet' });
  const { rows: legRows } = await pool.query('SELECT match_id FROM bet_selections WHERE bet_id = $1', [bet.id]);
  const { rows: matchRows } = await pool.query(
    'SELECT id, start_time, status, live_status FROM matches_cache WHERE id = ANY($1::text[])',
    [[...new Set(legRows.map((l) => l.match_id))]]
  );
  const blocked = getCancelBlockReason(bet, matchRows, { windowMs: CANCEL_WINDOW_MS });
  if (blocked) return res.status(400).json({ error: blocked });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the bet row and re-check it INSIDE the transaction. Without this two
    // simultaneous cancel requests both passed the checks above and both
    // refunded the stake (the second DELETE just matched nothing).
    const { rows: lockedBet } = await client.query('SELECT status FROM bets WHERE id = $1 FOR UPDATE', [bet.id]);
    if (!lockedBet[0] || lockedBet[0].status !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only pending bets can be cancelled' });
    }
    const betWallet = walletColumn(bet.currency);
    const { rows: lockedUser } = await client.query(`SELECT ${betWallet} FROM users WHERE id = $1 FOR UPDATE`, [bet.user_id]);
    const balanceBefore = Number(lockedUser[0][betWallet]);
    const balanceAfter = Number((balanceBefore + Number(bet.stake)).toFixed(2));
    await client.query(`UPDATE users SET ${betWallet} = ${betWallet} + $1 WHERE id = $2`, [bet.stake, bet.user_id]);
    await client.query(
      `INSERT INTO transactions
        (actor_id, source_id, target_id, amount, type, reference,
         source_balance_before, source_balance_after, target_balance_before, target_balance_after, created_at, currency)
       VALUES ($1,$1,$1,$2,'BET_CANCEL_REFUND',$3,$4,$5,$4,$5,$6,$7)`,
      [bet.user_id, bet.stake, bet.id, balanceBefore, balanceAfter, Date.now(), normalizeCurrency(bet.currency)]
    );
    await client.query('DELETE FROM bet_selections WHERE bet_id = $1', [bet.id]);
    await client.query('DELETE FROM bets WHERE id = $1', [bet.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { rows: userRows } = await pool.query('SELECT balance, balance_eur FROM users WHERE id = $1', [req.user.id]);
  res.json({ ok: true, balance: userRows[0].balance, balanceEur: userRows[0].balance_eur });
}));

export default router;
