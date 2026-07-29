import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import pool from '../db.js';

const router = express.Router();

// SECURITY: no insecure fallback secret. If JWT_SECRET is missing, any
// route that needs to sign/verify a token fails loudly instead of silently
// using a guessable default that lets anyone forge an admin token.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error(
    'FATAL: JWT_SECRET is not set. Refusing to start with an insecure default — ' +
    'set JWT_SECRET in your environment (a long random string) before starting the server.'
  );
  process.exit(1);
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { id: user.id, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: '30d' }
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
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

router.post('/register', async (req, res) => {
  const { name, username, password } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'name, username, and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const { rows: existingRows } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existingRows[0]) return res.status(409).json({ error: 'Username already taken' });

  const id = randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  await pool.query(
    `INSERT INTO users (id, name, username, password_hash, balance, role, avatar, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, name, username, hash, 1000, 'USER', '', Date.now()]
  );

  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  const user = rows[0];
  const token = signToken(user);
  const refreshToken = signRefreshToken(user);
  res.status(201).json({ token, refreshToken, user: toPublicUser(user) });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = signToken(user);
  const refreshToken = signRefreshToken(user);
  res.json({ token, refreshToken, user: toPublicUser(user) });
});

// Exchanges a valid, still-unexpired refresh token for a new short-lived
// access token, without requiring the user to log in again every 15 minutes.
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken is required' });
  let payload;
  try {
    payload = jwt.verify(refreshToken, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
  if (payload.type !== 'refresh') return res.status(401).json({ error: 'Not a refresh token' });

  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [payload.id]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const token = signToken(user);
  res.json({ token });
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: toPublicUser(user) });
});

export default router;
