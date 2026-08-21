import express from 'express';
import { randomUUID } from 'crypto';
import pool from '../db.js';
import { requireAuth } from './auth.js';
import { resolveCurrentOdds } from '../oddsUtils.js';
import { findConflictingSelection, validateStakeAmount } from '../betValidation.js';

const router = express.Router();

router.use(requireAuth);

// --- Ticket rules (kept simple & proportional to a play-money simulator,
// not a full enterprise risk-limits system) ---
const MIN_STAKE = 10;
const MAX_STAKE = 50000;
const MAX_SELECTIONS_PER_TICKET = 20;
const MAX_POTENTIAL_RETURN = 1000000;
// Risk Management: max total liability the house will carry on a single
// outcome (sum of potential_return across all PENDING tickets backing that
// exact selection). Prevents one popular pick from exposing the operator
// to unbounded payout if it hits — a real trading desk would hedge/adjust
// odds instead; this is the simplest safety net for a simulator.
const MAX_SELECTION_EXPOSURE = 5000000;
// How much worse the current odds are allowed to be vs. what the user saw
// when they built the slip, before we reject instead of silently accepting
// a worse price. 2% tolerance absorbs normal rounding/timing noise.
const ODDS_WORSENING_TOLERANCE = 0.02;

router.get('/', async (req, res) => {
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
  const withSelections = bets.map((b) => ({ ...b, selections: selectionsByBet.get(b.id) || [] }));
  res.json({ bets: withSelections });
});

router.post('/', async (req, res) => {
  const { type, stake, selections } = req.body || {};

  if (!Array.isArray(selections) || selections.length === 0) {
    return res.status(400).json({ error: 'At least one selection is required' });
  }
  if (selections.length > MAX_SELECTIONS_PER_TICKET) {
    return res.status(400).json({ error: `Maximum ${MAX_SELECTIONS_PER_TICKET} selections per ticket` });
  }
  const stakeError = validateStakeAmount(stake, { min: MIN_STAKE, max: MAX_STAKE });
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

  const { rows: userRows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const user = userRows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.balance < stake) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  // Re-verify each selection's odds against the current cache instead of
  // trusting the client, and reject if odds moved unfavorably beyond
  // tolerance (odds protection) instead of silently booking a worse price.
  let totalOdds = 1;
  const verifiedSelections = [];

  for (const sel of selections) {
    const { rows: matchRows } = await pool.query('SELECT * FROM matches_cache WHERE id = $1', [sel.matchId]);
    const matchRow = matchRows[0];
    if (!matchRow) {
      return res.status(400).json({ error: `Match ${sel.matchId} not found or no longer available` });
    }
    if (matchRow.status === 'FINISHED') {
      return res.status(400).json({ error: `Match ${matchRow.home_team} vs ${matchRow.away_team} has already finished — betting is closed.` });
    }
    const currentOdds = resolveCurrentOdds(matchRow, sel.marketId, sel.selectionId);
    if (currentOdds === null) {
      return res.status(400).json({ error: `Selection ${sel.selectionId} in market ${sel.marketId} not found in current odds — it may have closed or moved` });
    }
    if (typeof sel.odds === 'number' && currentOdds < sel.odds * (1 - ODDS_WORSENING_TOLERANCE)) {
      return res.status(409).json({
        error: `Odds for ${sel.selectionName} changed (was ${sel.odds}, now ${currentOdds}). Please review and resubmit.`,
        code: 'ODDS_CHANGED',
        newOdds: currentOdds,
      });
    }
    totalOdds *= currentOdds;
    verifiedSelections.push({ ...sel, odds: currentOdds });
  }

  const betId = randomUUID();
  const potentialReturn = Number((stake * totalOdds).toFixed(2));
  if (potentialReturn > MAX_POTENTIAL_RETURN) {
    return res.status(400).json({ error: `Maximum potential payout is ${MAX_POTENTIAL_RETURN}. Reduce your stake or selections.` });
  }

  // Risk Management: exposure check — for each selection, sum the
  // potential_return already committed on PENDING tickets backing that
  // same outcome, and reject if this new ticket would push it past the
  // house-wide cap.
  for (const sel of verifiedSelections) {
    const { rows: exposureRows } = await pool.query(
      `SELECT COALESCE(SUM(b.potential_return), 0) AS exposure
       FROM bet_selections bs JOIN bets b ON b.id = bs.bet_id
       WHERE bs.match_id = $1 AND bs.market_id = $2 AND bs.selection_id = $3 AND b.status = 'PENDING'`,
      [sel.matchId, sel.marketId, sel.selectionId]
    );
    const currentExposure = Number(exposureRows[0].exposure);
    if (currentExposure + potentialReturn > MAX_SELECTION_EXPOSURE) {
      return res.status(400).json({ error: `This selection is temporarily limited due to high exposure. Try a smaller stake.` });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Re-check balance inside the transaction to close the race window
    // between the SELECT above and this UPDATE (two simultaneous requests
    // from the same user could otherwise both pass the earlier check).
    const { rows: lockedUser } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [user.id]);
    if (!lockedUser[0] || lockedUser[0].balance < stake) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [stake, user.id]);
    await client.query(
      `INSERT INTO bets (id, user_id, type, stake, total_odds, potential_return, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7)`,
      [betId, user.id, type || 'SINGLE', stake, totalOdds, potentialReturn, Date.now()]
    );
    for (const sel of verifiedSelections) {
      await client.query(
        `INSERT INTO bet_selections
          (bet_id, match_id, match_home, match_away, market_id, market_name, selection_id, selection_name, odds, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING')`,
        [betId, sel.matchId, sel.matchHome, sel.matchAway, sel.marketId, sel.marketName, sel.selectionId, sel.selectionName, sel.odds]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { rows: updatedRows } = await pool.query('SELECT * FROM users WHERE id = $1', [user.id]);
  res.status(201).json({
    bet: { id: betId, totalOdds, potentialReturn, stake },
    balance: updatedRows[0].balance,
  });
});

const CANCEL_WINDOW_MS = 10 * 60 * 1000; // must match the window shown in BetSlip.tsx

// A user can cancel their OWN bet while it's still PENDING and within the
// cancellation window — enforced server-side (not just hidden in the UI
// after 10 minutes), since the client's clock/timer can't be trusted.
router.post('/:id/cancel', async (req, res) => {
  const { rows: betRows } = await pool.query('SELECT * FROM bets WHERE id = $1', [req.params.id]);
  const bet = betRows[0];
  if (!bet) return res.status(404).json({ error: 'Bet not found' });
  if (bet.user_id !== req.user.id) return res.status(403).json({ error: 'Not your bet' });
  if (bet.status !== 'PENDING') return res.status(400).json({ error: 'Only pending bets can be cancelled' });
  if (Date.now() - Number(bet.created_at) > CANCEL_WINDOW_MS) {
    return res.status(400).json({ error: 'Cancellation window has expired' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [bet.stake, bet.user_id]);
    await client.query('DELETE FROM bet_selections WHERE bet_id = $1', [bet.id]);
    await client.query('DELETE FROM bets WHERE id = $1', [bet.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { rows: userRows } = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
  res.json({ ok: true, balance: userRows[0].balance });
});

export default router;
