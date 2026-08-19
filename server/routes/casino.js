import express from 'express';
import { randomUUID } from 'crypto';
import pool from '../db.js';
import { requireAuth } from './auth.js';
import { logAudit } from '../auditLog.js';

const router = express.Router();
router.use(requireAuth);

// Per-game stake bounds and the maximum legitimate payout multiplier, taken
// directly from each game's own paytable/logic (components/casino/*.tsx).
// The RNG and hand/outcome evaluation still run client-side (porting all six
// games' engines server-side is future work — see audit notes), so this is
// not a full server-authoritative rewrite. What it DOES close: casino
// balance changes are now actually persisted (they previously lived only in
// React state and vanished on refresh), and a submitted payout can no
// longer exceed what that specific game could legitimately produce for the
// stake that was actually deducted — so a tampered client can shift a
// result from loss to win, but can no longer fabricate an arbitrary amount.
const GAME_CONFIG = {
  roulette: { minStake: 1, maxStake: 5000, maxMultiplier: 36 },       // straight-up number, 35:1 + stake back
  blackjack: { minStake: 5, maxStake: 5000, maxMultiplier: 2.5 },     // blackjack pays 3:2
  slots: { minStake: 1, maxStake: 2000, maxMultiplier: 100 },         // jackpot symbol
  crash: { minStake: 1, maxStake: 5000, maxMultiplier: 50 },          // hard cap in Crash.tsx
  baccarat: { minStake: 10, maxStake: 5000, maxMultiplier: 9 },       // tie pays 8:1
  poker: { minStake: 1, maxStake: 2000, maxMultiplier: 800 },         // royal flush
};

router.post('/wager', async (req, res) => {
  const { game, stake } = req.body || {};
  const config = GAME_CONFIG[game];
  if (!config) return res.status(400).json({ error: `Unknown game '${game}'` });
  if (typeof stake !== 'number' || !Number.isFinite(stake) || stake <= 0) {
    return res.status(400).json({ error: 'stake must be a positive number' });
  }
  if (stake < config.minStake || stake > config.maxStake) {
    return res.status(400).json({ error: `Stake for ${game} must be between ${config.minStake} and ${config.maxStake}` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    if (!rows[0] || rows[0].balance < stake) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [stake, req.user.id]);
    const wagerId = randomUUID();
    await client.query(
      `INSERT INTO casino_wagers (id, user_id, game, stake, status, created_at) VALUES ($1,$2,$3,$4,'PENDING',$5)`,
      [wagerId, req.user.id, game, stake, Date.now()]
    );
    await client.query('COMMIT');
    const { rows: updated } = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
    res.status(201).json({ wagerId, balance: updated[0].balance });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.post('/settle', async (req, res) => {
  const { wagerId, multiplier } = req.body || {};
  if (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier < 0) {
    return res.status(400).json({ error: 'multiplier must be a non-negative number' });
  }

  const { rows: wagerRows } = await pool.query('SELECT * FROM casino_wagers WHERE id = $1', [wagerId]);
  const wager = wagerRows[0];
  if (!wager) return res.status(404).json({ error: 'Wager not found' });
  if (wager.user_id !== req.user.id) return res.status(403).json({ error: 'Not your wager' });
  if (wager.status !== 'PENDING') return res.status(400).json({ error: 'Wager already settled' });

  const config = GAME_CONFIG[wager.game];
  const cappedMultiplier = Math.min(multiplier, config.maxMultiplier);
  const payout = Number((wager.stake * cappedMultiplier).toFixed(2));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (payout > 0) {
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [payout, req.user.id]);
    }
    await client.query(
      `UPDATE casino_wagers SET status = $1, payout = $2, settled_at = $3 WHERE id = $4`,
      [payout > 0 ? 'WON' : 'LOST', payout, Date.now(), wagerId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (multiplier > config.maxMultiplier) {
    await logAudit(req.user, 'CASINO_MULTIPLIER_CLAMPED', wagerId, {
      game: wager.game, requested: multiplier, allowedMax: config.maxMultiplier,
    });
  }

  const { rows: updated } = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
  res.json({ balance: updated[0].balance, payout });
});

export default router;
