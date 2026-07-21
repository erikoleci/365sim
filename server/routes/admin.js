import express from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import pool from '../db.js';
import { requireAuth } from './auth.js';
import { settleMatch, recomputeBetStatus } from '../matchSettlement.js';
import { logAudit } from '../auditLog.js';

const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Admin access required' });
  next();
}

router.use(requireAuth, requireAdmin);

function toPublicUser(row) {
  return {
    id: row.id, name: row.name, username: row.username,
    balance: row.balance, role: row.role, avatar: row.avatar,
  };
}

// --- USERS ---

router.get('/users', async (req, res) => {
  const { rows: users } = await pool.query('SELECT * FROM users');
  res.json({ users: users.map(toPublicUser) });
});

router.post('/users', async (req, res) => {
  const { name, username, password, balance } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'name, username, and password are required' });
  }
  const { rows: existingRows } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existingRows[0]) return res.status(409).json({ error: 'Username already taken' });

  const id = randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  await pool.query(
    `INSERT INTO users (id, name, username, password_hash, balance, role, avatar, created_at)
     VALUES ($1,$2,$3,$4,$5,'USER',$6,$7)`,
    [id, name, username, hash, Number(balance) || 0, '', Date.now()]
  );

  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  await logAudit(req.user, 'USER_CREATE', id, { username, balance: Number(balance) || 0 });
  res.status(201).json({ user: toPublicUser(rows[0]) });
});

router.delete('/users/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'ADMIN') return res.status(400).json({ error: 'Cannot delete an admin user' });
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  await logAudit(req.user, 'USER_DELETE', req.params.id, { username: user.username });
  res.json({ ok: true });
});

router.post('/users/:id/credit', async (req, res) => {
  const { amount } = req.body || {};
  if (typeof amount !== 'number' || amount === 0) {
    return res.status(400).json({ error: 'amount must be a non-zero number' });
  }
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  await pool.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, req.params.id]);
  const { rows: updated } = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  await logAudit(req.user, 'BALANCE_CREDIT', req.params.id, { amount, username: rows[0].username });
  res.json({ user: toPublicUser(updated[0]) });
});

router.post('/users/:id/reset-password', async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  }
  const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  const hash = bcrypt.hashSync(password, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
  await logAudit(req.user, 'PASSWORD_RESET', req.params.id, {});
  res.json({ ok: true });
});

// --- BETS (global view + cancel) ---

router.get('/bets', async (req, res) => {
  const { rows: bets } = await pool.query('SELECT * FROM bets ORDER BY created_at DESC');
  const withDetails = await Promise.all(
    bets.map(async (b) => {
      const { rows: selections } = await pool.query('SELECT * FROM bet_selections WHERE bet_id = $1', [b.id]);
      const { rows: userRows } = await pool.query('SELECT id, username, name, avatar FROM users WHERE id = $1', [b.user_id]);
      return { ...b, selections, user: userRows[0] || null };
    })
  );
  res.json({ bets: withDetails });
});

router.post('/bets/:id/cancel', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM bets WHERE id = $1', [req.params.id]);
  const bet = rows[0];
  if (!bet) return res.status(404).json({ error: 'Bet not found' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Refund stake only if it hasn't already been paid out as a win
    if (bet.status !== 'WON') {
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [bet.stake, bet.user_id]);
    } else {
      // Was a win already credited (stake + winnings) — claw back the net winnings paid out
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [bet.potential_return - bet.stake, bet.user_id]);
    }
    await client.query('DELETE FROM bet_selections WHERE bet_id = $1', [bet.id]);
    await client.query('DELETE FROM bets WHERE id = $1', [bet.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await logAudit(req.user, 'BET_CANCEL', bet.id, { userId: bet.user_id, stake: bet.stake, wasStatus: bet.status });
  res.json({ ok: true });
});

// Manually override a single bet leg's outcome. Needed for markets where
// automatic settlement can't safely infer the winner from just the final
// score (double chance, draw-no-bet, handicaps) — see settle-match comment.
router.patch('/bet-selections/:id', async (req, res) => {
  const { status } = req.body || {};
  if (!['WON', 'LOST'].includes(status)) {
    return res.status(400).json({ error: "status must be 'WON' or 'LOST'" });
  }
  const { rows } = await pool.query('SELECT * FROM bet_selections WHERE id = $1', [req.params.id]);
  const selection = rows[0];
  if (!selection) return res.status(404).json({ error: 'Selection not found' });

  await pool.query('UPDATE bet_selections SET status = $1 WHERE id = $2', [status, selection.id]);
  await recomputeBetStatus(selection.bet_id);
  await logAudit(req.user, 'SELECTION_OVERRIDE', String(selection.id), { betId: selection.bet_id, status, matchId: selection.match_id });
  res.json({ ok: true });
});

// --- MATCH SETTLEMENT ---
// Given a final score, automatically settles the markets where the winner
// is unambiguous from the score alone: 1X2 (h2h), Over/Under (totals),
// and Both Teams To Score (btts). Double chance / draw-no-bet / handicap
// legs are intentionally left PENDING here because their exact outcome
// naming/semantics depend on the bookmaker feed and should be confirmed
// via the manual override endpoint above rather than guessed.
// force:true lets an admin re-settle a match the automatic scores poller
// already closed, e.g. to correct a wrong final score.
router.post('/matches/:id/settle', async (req, res) => {
  const { homeScore, awayScore } = req.body || {};
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) {
    return res.status(400).json({ error: 'homeScore and awayScore must be non-negative integers' });
  }
  const { rows } = await pool.query('SELECT * FROM matches_cache WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Match not found' });

  const result = await settleMatch(req.params.id, homeScore, awayScore, { force: true });
  await logAudit(req.user, 'MATCH_SETTLE', req.params.id, { homeScore, awayScore, ...result });
  res.json({ ok: true, ...result });
});

// --- AUDIT LOG ---
router.get('/audit-log', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1', [limit]);
  res.json({ entries: rows });
});

export default router;
