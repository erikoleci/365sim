import express from 'express';
import pool from '../db.js';
import { requireAuth } from './auth.js';
import { wrap } from '../asyncHandler.js';
import { isAdminRole } from '../roles.js';
import { getVapidKeys, ensurePushTable, validSubscription } from '../webPush.js';

// Web Push for staff (admins and the super admin): the public VAPID key, subscribe / unsubscribe of THIS device.
const router = express.Router();
router.use(requireAuth);
router.use((req, res, next) => (isAdminRole(req.user?.role) ? next() : res.status(403).json({ error: 'Admin access required' })));
router.use(wrap(async (_req, _res, next) => { await ensurePushTable(); next(); }));

router.get('/key', wrap(async (_req, res) => { res.json({ publicKey: (await getVapidKeys()).publicKey }); }));

router.post('/subscribe', wrap(async (req, res) => {
  const sub = req.body?.subscription;
  if (!validSubscription(sub)) return res.status(400).json({ error: 'Invalid subscription' });
  // one device = one endpoint: it belongs to whoever subscribed last
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = excluded.created_at`,
    [sub.endpoint, req.user.id, sub.keys.p256dh, sub.keys.auth, Date.now()]);
  res.status(201).json({ ok: true });
}));

router.post('/unsubscribe', wrap(async (req, res) => {
  const endpoint = String(req.body?.endpoint || '');
  if (endpoint) await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.user.id]);
  res.json({ ok: true });
}));

export default router;
