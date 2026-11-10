import express from 'express';
import pool from '../db.js';
import { requireAuth } from './auth.js';
import { wrap } from '../asyncHandler.js';
import { getVapid } from '../push.js';

const router = express.Router();
router.use(requireAuth);

// The public key the phone needs to subscribe (the private half never leaves the server).
router.get('/key', wrap(async (req, res) => {
  const { publicKey } = await getVapid();
  res.json({ publicKey });
}));

const isUrl = (v) => typeof v === 'string' && /^https:\/\/[^\s]{10,1000}$/.test(v);
const isKey = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(v);

// One row per phone. The same phone signing in as another person is moved to that person.
router.post('/subscribe', wrap(async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!isUrl(endpoint) || !keys || !isKey(keys.p256dh) || !isKey(keys.auth)) {
    return res.status(400).json({ error: 'invalid subscription' });
  }
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [req.user.id, endpoint, keys.p256dh, keys.auth, Date.now()],
  );
  res.json({ ok: true });
}));

router.post('/unsubscribe', wrap(async (req, res) => {
  const { endpoint } = req.body || {};
  if (!isUrl(endpoint)) return res.status(400).json({ error: 'invalid endpoint' });
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.user.id]);
  res.json({ ok: true });
}));

export default router;
