import express from 'express';
import pool from '../db.js';
import { requireAuth } from './auth.js';

const router = express.Router();
router.use(requireAuth);

const VALID_TYPES = new Set(['TEAM', 'LEAGUE']);

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT type, value FROM favorites WHERE user_id = $1 ORDER BY created_at ASC',
    [req.user.id]
  );
  res.json({ favorites: rows });
});

// Idempotent toggle: favorites it if not already favorited, unfavorites it
// if it is. Simplest contract for the frontend — one call, no need to track
// current state client-side beforehand.
router.post('/toggle', async (req, res) => {
  const { type, value } = req.body || {};
  if (!VALID_TYPES.has(type) || typeof value !== 'string' || !value.trim()) {
    return res.status(400).json({ error: 'type must be TEAM or LEAGUE, and value is required' });
  }

  const { rows: existing } = await pool.query(
    'SELECT id FROM favorites WHERE user_id = $1 AND type = $2 AND value = $3',
    [req.user.id, type, value]
  );

  if (existing[0]) {
    await pool.query('DELETE FROM favorites WHERE id = $1', [existing[0].id]);
  } else {
    await pool.query(
      'INSERT INTO favorites (user_id, type, value, created_at) VALUES ($1,$2,$3,$4)',
      [req.user.id, type, value, Date.now()]
    );
  }

  const { rows } = await pool.query(
    'SELECT type, value FROM favorites WHERE user_id = $1 ORDER BY created_at ASC',
    [req.user.id]
  );
  res.json({ favorites: rows, favorited: !existing[0] });
});

export default router;
