import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const store = vi.hoisted(() => ({ kv: new Map(), subs: [] }));
vi.mock('../server/db.js', () => {
  const pool = {
    query: vi.fn(async (sql, params = []) => {
      const s = String(sql);
      if (s.includes("FROM kv_store WHERE key = 'webpush_vapid'")) { const v = store.kv.get('webpush_vapid'); return { rows: v ? [{ value: v }] : [] }; }
      if (s.startsWith('INSERT INTO kv_store')) { if (!store.kv.has('webpush_vapid')) store.kv.set('webpush_vapid', params[0]); return { rows: [] }; }
      if (s.startsWith('CREATE TABLE IF NOT EXISTS push_subscriptions')) return { rows: [] };
      if (s.startsWith('SELECT s.endpoint')) return { rows: store.subs.map((x) => ({ ...x })) };
      if (s.startsWith('DELETE FROM push_subscriptions')) { store.subs = store.subs.filter((x) => x.endpoint !== params[0]); return { rows: [] }; }
      throw new Error('unmocked query: ' + s);
    }),
  };
  return { default: pool, pool };
});

const wp = await import('../server/webPush.js');

describe('Web Push encryption (RFC 8291 Appendix A test vector)', () => {
  it('reproduces the RFC body byte for byte', () => {
    const body = wp.encryptWebPush('When I grow up, I want to be a watermelon', {
      p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    }, { asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: 'DGv6ra1nlYgDCS1FRnbzlw' });
    // the RFC prints the 86-byte header and the ciphertext as two separately encoded segments
    expect(body.subarray(0, 86).toString('base64url')).toBe('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
    expect(body.subarray(86).toString('base64url')).toBe('8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ');
  });
  it('a fresh message (random key and salt) is decryptable with the subscriber\'s private key', () => {
    const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
    const auth = crypto.randomBytes(16);
    const body = wp.encryptWebPush('{"title":"ë"}', { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') });
    const salt = body.subarray(0, 16); const idlen = body[20]; const asPub = body.subarray(21, 21 + idlen); const enc = body.subarray(21 + idlen);
    const secret = ua.computeSecret(asPub);
    const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
    const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
    const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(enc.subarray(enc.length - 16));
    const plain = Buffer.concat([d.update(enc.subarray(0, enc.length - 16)), d.final()]);
    expect(plain.subarray(0, plain.length - 1).toString('utf8')).toBe('{"title":"ë"}');
    expect(plain[plain.length - 1]).toBe(2);
  });
  it('refuses broken subscription keys and oversize payloads', () => {
    expect(() => wp.encryptWebPush('x', { p256dh: 'AAAA', auth: 'BTBZMqHH6r4Tts7J_aSIgg' })).toThrow();
    expect(wp.validSubscription({ endpoint: 'http://x', keys: {} })).toBe(false);
  });
});

describe('VAPID', () => {
  beforeEach(() => { store.kv.clear(); wp.__resetVapidForTests(); });
  it('creates the keys once, keeps them, and signs a JWT that verifies with the public key', async () => {
    const k1 = await wp.getVapidKeys();
    wp.__resetVapidForTests();
    const k2 = await wp.getVapidKeys(); // read back from the store, not regenerated
    expect(k2.publicKey).toBe(k1.publicKey);
    const auth = wp.vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', k1, { now: Date.parse('2026-11-14T12:00:00Z'), subject: 'mailto:a@b.c' });
    const m = auth.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
    expect(m).toBeTruthy();
    expect(JSON.parse(Buffer.from(m[2], 'base64url'))).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:a@b.c' });
    const pub = Buffer.from(m[4], 'base64url');
    const publicKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
    expect(crypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url'))).toBe(true);
  });
});

describe('notifyStaffDevices', () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const sub = (endpoint, user_id, role) => ({ endpoint, user_id, role, p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') });
  beforeEach(() => { store.kv.clear(); wp.__resetVapidForTests(); wp.__resetPushTableForTests(); });
  it('reaches the super admin and the player\'s own admin only, and forgets a subscription the browser dropped (410)', async () => {
    store.subs = [sub('https://push.example/super', 's1', 'SUPER_ADMIN'), sub('https://push.example/admin-own', 'a1', 'ADMIN'), sub('https://push.example/admin-other', 'a2', 'ADMIN'), sub('https://push.example/gone', 's1', 'SUPER_ADMIN')];
    const fetchImpl = vi.fn(async (url) => ({ ok: !url.endsWith('/gone'), status: url.endsWith('/gone') ? 410 : 201 }));
    const r = await wp.notifyStaffDevices({ adminId: 'a1', payload: { title: 't', body: 'b' } }, { fetchImpl });
    const urls = fetchImpl.mock.calls.map((c) => c[0]).sort();
    expect(urls).toEqual(['https://push.example/admin-own', 'https://push.example/gone', 'https://push.example/super']);
    expect(r).toEqual({ targets: 3, sent: 2 });
    expect(store.subs.map((x) => x.endpoint)).not.toContain('https://push.example/gone');
    const h = fetchImpl.mock.calls[0][1].headers;
    expect(h['Content-Encoding']).toBe('aes128gcm');
    expect(h.Authorization).toMatch(/^vapid t=/);
  });
});
