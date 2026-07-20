import express from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import db from '../db.js';
import { requireAuth } from './auth.js';
import { settleMatch, recomputeBetStatus } from '../matchSettlement.js';

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

router.get('/users', (req, res) => {
  const users = db.prepare('SELECT * FROM users').all();
  res.json({ users: users.map(toPublicUser) });
});

router.post('/users', (req, res) => {
  const { name, username, password, balance } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'name, username, and password are required' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  const id = randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO users (id, name, username, password_hash, balance, role, avatar, created_at)
    VALUES (?, ?, ?, ?, ?, 'USER', ?, ?)
  `).run(id, name, username, hash, Number(balance) || 0, '', Date.now());

  res.status(201).json({ user: toPublicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});

router.delete('/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'ADMIN') return res.status(400).json({ error: 'Cannot delete an admin user' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/users/:id/credit', (req, res) => {
  const { amount } = req.body || {};
  if (typeof amount !== 'number' || amount === 0) {
    return res.status(400).json({ error: 'amount must be a non-zero number' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, req.params.id);
  res.json({ user: toPublicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)) });
});

router.post('/users/:id/reset-password', (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  }
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ ok: true });
});

// --- BETS (global view + cancel) ---

router.get('/bets', (req, res) => {
  const bets = db.prepare('SELECT * FROM bets ORDER BY created_at DESC').all();
  const selStmt = db.prepare('SELECT * FROM bet_selections WHERE bet_id = ?');
  const userStmt = db.prepare('SELECT id, username, name, avatar FROM users WHERE id = ?');
  res.json({
    bets: bets.map((b) => ({
      ...b,
      selections: selStmt.all(b.id),
      user: userStmt.get(b.user_id) || null,
    })),
  });
});

router.post('/bets/:id/cancel', (req, res) => {
  const bet = db.prepare('SELECT * FROM bets WHERE id = ?').get(req.params.id);
  if (!bet) return res.status(404).json({ error: 'Bet not found' });

  const tx = db.transaction(() => {
    // Refund stake only if it hasn't already been paid out as a win
    if (bet.status !== 'WON') {
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(bet.stake, bet.user_id);
    } else {
      // Was a win already credited (stake + winnings) — claw back the net winnings paid out
      db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(bet.potential_return - bet.stake, bet.user_id);
    }
    db.prepare('DELETE FROM bet_selections WHERE bet_id = ?').run(bet.id);
    db.prepare('DELETE FROM bets WHERE id = ?').run(bet.id);
  });
  tx();
  res.json({ ok: true });
});

// Manually override a single bet leg's outcome. Needed for markets where
// automatic settlement can't safely infer the winner from just the final
// score (double chance, draw-no-bet, handicaps) — see settle-match comment.
router.patch('/bet-selections/:id', (req, res) => {
  const { status } = req.body || {};
  if (!['WON', 'LOST'].includes(status)) {
    return res.status(400).json({ error: "status must be 'WON' or 'LOST'" });
  }
  const selection = db.prepare('SELECT * FROM bet_selections WHERE id = ?').get(req.params.id);
  if (!selection) return res.status(404).json({ error: 'Selection not found' });

  db.prepare('UPDATE bet_selections SET status = ? WHERE id = ?').run(status, selection.id);
  recomputeBetStatus(selection.bet_id);
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
router.post('/matches/:id/settle', (req, res) => {
  const { homeScore, awayScore } = req.body || {};
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) {
    return res.status(400).json({ error: 'homeScore and awayScore must be non-negative integers' });
  }
  const match = db.prepare('SELECT * FROM matches_cache WHERE id = ?').get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const result = settleMatch(req.params.id, homeScore, awayScore, { force: true });
  res.json({ ok: true, ...result });
});

export default router;
