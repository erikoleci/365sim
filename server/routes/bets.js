import express from 'express';
import { randomUUID } from 'crypto';
import pool from '../db.js';
import { requireAuth } from './auth.js';
import { resolveCurrentOdds } from '../oddsUtils.js';

const router = express.Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { rows: bets } = await pool.query('SELECT * FROM bets WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
  const withSelections = await Promise.all(
    bets.map(async (b) => {
      const { rows: selections } = await pool.query('SELECT * FROM bet_selections WHERE bet_id = $1', [b.id]);
      return { ...b, selections };
    })
  );
  res.json({ bets: withSelections });
});

router.post('/', async (req, res) => {
  const { type, stake, selections } = req.body || {};

  if (!Array.isArray(selections) || selections.length === 0) {
    return res.status(400).json({ error: 'At least one selection is required' });
  }
  if (typeof stake !== 'number' || stake <= 0) {
    return res.status(400).json({ error: 'Stake must be a positive number' });
  }

  const { rows: userRows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const user = userRows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.balance < stake) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  // Re-verify each selection's odds against the current cache instead of trusting the client
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
    totalOdds *= currentOdds;
    verifiedSelections.push({ ...sel, odds: currentOdds });
  }

  const betId = randomUUID();
  const potentialReturn = Number((stake * totalOdds).toFixed(2));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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
