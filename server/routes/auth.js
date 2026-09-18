import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { wrap } from '../asyncHandler.js';

const router = express.Router();

// In production, an unset JWT_SECRET means anyone can forge a valid admin
// token using the well-known fallback string published in this repo — so we
// refuse to start rather than silently running insecurely. Local/dev keeps
// the fallback for convenience.
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET is required when NODE_ENV=production. Set it in your environment before starting the server.');
}
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function toPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    balance: row.balance,
    role: row.role,
    avatar: row.avatar,
  };
}

// Middleware to protect routes
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // JWTs are valid for 7 days, but an account's `is_active`/`role` can
  // change at any moment (an Agent disabling a User, an Owner disabling an
  // Agent, a promotion/demotion). Without this check, a disabled account
  // could keep placing bets, crediting users, or reading data for up to 7
  // more days on an old token -- checking the DB on every request closes
  // that gap. This is one indexed primary-key lookup, so the cost is small.
  try {
    const { rows } = await pool.query('SELECT id, role, is_active FROM users WHERE id = $1', [payload.id]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Account no longer exists' });
    if (user.is_active === false) return res.status(403).json({ error: 'Account is disabled' });
    // Trust the DB for role/is_active (source of truth, can change after
    // the token was issued); keep id/username from the verified payload.
    req.user = { id: payload.id, username: payload.username, role: user.role };
    next();
  } catch (err) {
    console.error('[auth] requireAuth DB check failed:', err.message);
    res.status(500).json({ error: 'Authentication check failed' });
  }
}

// Self-service registration is intentionally not exposed: accounts are
// created by an Admin (/admin/agents) or an Agent (/admin/users) only, so
// every account has a known owner/creator from the start. If you're
// looking for the old public POST /register route, it was removed on
// purpose, not missing by accident.

router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (user.is_active === false) {
    return res.status(403).json({ error: 'Account is disabled' });
  }
  const token = signToken(user);
  res.json({ token, user: toPublicUser(user) });
}));

router.get('/me', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: toPublicUser(user) });
}));

export default router;
