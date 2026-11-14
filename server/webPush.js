// Web Push (RFC 8030 + VAPID RFC 8292 + message encryption RFC 8291, aes128gcm) with Node's own crypto: no dependency.
// Staff (admins and the super admin) subscribe from their phone / browser; a player writing to Support pushes a notification that
// opens the site even when it is closed. The encryption is checked against the RFC 8291 Appendix A test vector (tests/webPush.test.js).
import crypto from 'crypto';
import pool from './db.js';
import { isSuperAdmin } from './roles.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

// ---------------------------------------------------------------- encryption (RFC 8291 section 3.4)
// `fixed` (asPrivate / salt, base64url) exists only so the RFC test vector can be reproduced.
export function encryptWebPush(payload, subscriptionKeys, fixed = {}) {
  const uaPublic = fromB64u(subscriptionKeys.p256dh);
  const authSecret = fromB64u(subscriptionKeys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length !== 16) throw new Error('invalid push subscription keys');
  const ecdh = crypto.createECDH('prime256v1');
  if (fixed.asPrivate) ecdh.setPrivateKey(fromB64u(fixed.asPrivate)); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(); // 65 bytes, uncompressed
  const ecdhSecret = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'latin1'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32));
  const salt = fixed.salt ? fromB64u(fixed.salt) : crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'latin1'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'latin1'), 12));
  const data = Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([2])]); // 0x02 = delimiter of the last (and only) record
  if (data.length > 3993) throw new Error('push payload too large');
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.concat([salt, Buffer.from([0, 0, 16, 0]), Buffer.from([asPublic.length]), asPublic]); // record size 4096
  return Buffer.concat([header, encrypted]);
}

// ---------------------------------------------------------------- VAPID keys (kept in kv_store, created on first use)
let keysPromise = null;
function jwkToKeys(jwk) {
  const publicRaw = Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]);
  return { privateKey: crypto.createPrivateKey({ key: jwk, format: 'jwk' }), publicKey: b64u(publicRaw) };
}
export async function getVapidKeys(db = pool) {
  if (!keysPromise) {
    keysPromise = (async () => {
      const read = async () => (await db.query("SELECT value FROM kv_store WHERE key = 'webpush_vapid'")).rows[0];
      let row = await read();
      if (!row) {
        const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const jwk = privateKey.export({ format: 'jwk' });
        await db.query("INSERT INTO kv_store (key, value) VALUES ('webpush_vapid', $1) ON CONFLICT (key) DO NOTHING", [JSON.stringify({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d })]);
        row = await read(); // the one that won if two processes raced
      }
      return jwkToKeys(JSON.parse(row.value));
    })().catch((err) => { keysPromise = null; throw err; });
  }
  return keysPromise;
}
export const __resetVapidForTests = () => { keysPromise = null; };

export function vapidAuthorization(endpoint, keys, { now = Date.now(), subject = process.env.VAPID_SUBJECT || 'mailto:admin@365sim.uk' } = {}) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(header + '.' + body), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}

// ---------------------------------------------------------------- subscriptions
let ready = null;
export function ensurePushTable(db = pool) {
  if (!ready) {
    ready = db.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at BIGINT NOT NULL
    ); CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions (user_id);`).catch((err) => { ready = null; throw err; });
  }
  return ready;
}
export const __resetPushTableForTests = () => { ready = null; };

export function validSubscription(sub) {
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 2000) return false;
  const k = sub.keys || {};
  try { return fromB64u(k.p256dh).length === 65 && fromB64u(k.auth).length === 16; } catch { return false; }
}

// ---------------------------------------------------------------- sending
export async function sendPush(sub, payloadObj, { db = pool, fetchImpl = globalThis.fetch, now = Date.now(), urgency = 'high' } = {}) {
  const keys = await getVapidKeys(db);
  const body = encryptWebPush(JSON.stringify(payloadObj), { p256dh: sub.p256dh, auth: sub.auth });
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: urgency, Authorization: vapidAuthorization(sub.endpoint, keys, { now }) },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 404 || res.status === 410) { // the browser dropped the subscription: forget it
    await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]).catch(() => {});
    return { ok: false, gone: true, status: res.status };
  }
  return { ok: res.ok, status: res.status };
}

// Every staff device that should hear about a player: all super admins, and the admin who owns that player.
export async function notifyStaffDevices({ adminId, payload }, { db = pool, fetchImpl = globalThis.fetch } = {}) {
  await ensurePushTable(db);
  const { rows } = await db.query('SELECT s.endpoint, s.p256dh, s.auth, s.user_id, u.role FROM push_subscriptions s JOIN users u ON u.id = s.user_id');
  const targets = rows.filter((r) => isSuperAdmin(r.role) || (adminId && r.user_id === adminId));
  let sent = 0;
  await Promise.all(targets.map(async (t) => {
    try { const r = await sendPush(t, payload, { db, fetchImpl }); if (r.ok) sent++; else if (!r.gone) console.error('[web-push] HTTP ' + r.status); }
    catch (err) { console.error('[web-push] failed:', err && err.message); }
  }));
  return { targets: targets.length, sent };
}
