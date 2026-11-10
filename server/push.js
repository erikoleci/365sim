import webpush from 'web-push';
import pool from './db.js';

// Push notifications for the installed app: a ticket was decided (won / lost / refunded) and a match the person
// starred (or one of whose teams they starred) has finished. Only people who installed the app and pressed "Aktivizo"
// have a row in push_subscriptions, so for everyone else nothing here costs anything: the sweep returns at once.

const VAPID_KEY = 'push_vapid_keys';
const CURSOR_BETS = 'push_cursor_bets';
const CURSOR_MATCHES = 'push_cursor_matches';
const MAX_AGE_MS = 3 * 60 * 60 * 1000; // never announce something decided longer ago than this (e.g. after a long downtime)

// ---- the texts (pure, tested) ---------------------------------------------------------------
const money = (amount, currency) => `${Number(amount).toFixed(2)} ${currency === 'EUR' ? '€' : 'L'}`;
const ticketLabel = (bet) => (bet.ticket_no != null ? `#${bet.ticket_no}` : '');

export function ticketMessage(bet) {
  const label = ticketLabel(bet);
  if (bet.status === 'WON') {
    return { title: 'Bileta fitoi 🎉', body: `Bileta ${label} fitoi ${money(bet.potential_return, bet.currency)}`.replace('  ', ' ') };
  }
  if (bet.status === 'LOST') return { title: 'Bileta humbi', body: `Bileta ${label} humbi`.replace('  ', ' ') };
  if (bet.status === 'VOID') return { title: 'Bileta u anulua', body: `Bileta ${label}: stake-u u kthye ${money(bet.stake, bet.currency)}`.replace('  ', ' ') };
  return null;
}

export function matchMessage(m) {
  return { title: 'Mbaroi ndeshja', body: `${m.home_team} ${m.result_home}–${m.result_away} ${m.away_team}` };
}

// ---- VAPID keys: generated once, kept in the database (no server setup) ---------------------
let vapid = null;
export async function getVapid() {
  if (vapid) return vapid;
  const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [VAPID_KEY]);
  if (rows[0]) { vapid = JSON.parse(rows[0].value); return vapid; }
  const keys = webpush.generateVAPIDKeys();
  await pool.query('INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [VAPID_KEY, JSON.stringify(keys)]);
  const { rows: again } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [VAPID_KEY]);
  vapid = JSON.parse(again[0].value);
  return vapid;
}

async function send(sub, payload) {
  const keys = await getVapid();
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { vapidDetails: { subject: 'https://365sim.uk', publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 6 * 3600, urgency: 'high' },
    );
    return true;
  } catch (err) {
    // The phone removed the app / revoked the permission: forget it.
    if (err && (err.statusCode === 404 || err.statusCode === 410)) {
      await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]).catch(() => {});
    } else {
      console.error('[push] send failed:', err && (err.statusCode || err.message));
    }
    return false;
  }
}

// ---- cursors: "everything decided after this moment" ----------------------------------------
async function readCursor(key, fallback) {
  const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
  return rows[0] ? Number(rows[0].value) : fallback;
}
async function writeCursor(key, value) {
  await pool.query('INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, String(value)]);
}

let sweeping = false;
/** One pass: announce what was decided since the last pass. Cheap: returns at once when nobody enabled notifications. */
export async function runPushSweep(now = Date.now()) {
  if (sweeping) return { sent: 0 };
  sweeping = true;
  try {
    const { rows: any } = await pool.query('SELECT 1 FROM push_subscriptions LIMIT 1');
    if (any.length === 0) {
      // Keep the cursors current so that the first person to enable notifications is not flooded with old news.
      await writeCursor(CURSOR_BETS, now); await writeCursor(CURSOR_MATCHES, now);
      return { sent: 0 };
    }
    let sent = 0;

    const betsFrom = Math.max(await readCursor(CURSOR_BETS, now), now - MAX_AGE_MS);
    const { rows: bets } = await pool.query(
      `SELECT b.id, b.user_id, b.status, b.stake, b.potential_return, b.currency, b.ticket_no, b.settled_at
         FROM bets b
        WHERE b.settled_at > $1 AND b.settled_at <= $2 AND b.status IN ('WON','LOST','VOID')
          AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = b.user_id AND s.notify_tickets)
        ORDER BY b.settled_at ASC LIMIT 200`, [betsFrom, now]);
    for (const bet of bets) {
      const msg = ticketMessage(bet);
      if (!msg) continue;
      const { rows: subs } = await pool.query('SELECT * FROM push_subscriptions WHERE user_id = $1 AND notify_tickets', [bet.user_id]);
      for (const sub of subs) if (await send(sub, { ...msg, tag: `bet-${bet.id}`, url: '/' })) sent++;
    }
    await writeCursor(CURSOR_BETS, bets.length === 200 ? Number(bets[bets.length - 1].settled_at) : now);

    const matchesFrom = Math.max(await readCursor(CURSOR_MATCHES, now), now - MAX_AGE_MS);
    const { rows: rowsM } = await pool.query(
      `SELECT m.id, m.home_team, m.away_team, m.result_home, m.result_away, m.settled_at, s.endpoint, s.p256dh, s.auth
         FROM matches_cache m
         JOIN favorites f ON (f.type = 'MATCH' AND f.value = m.id) OR (f.type = 'TEAM' AND (f.value = m.home_team OR f.value = m.away_team))
         JOIN push_subscriptions s ON s.user_id = f.user_id AND s.notify_matches
        WHERE m.status = 'FINISHED' AND m.result_home IS NOT NULL AND m.result_away IS NOT NULL
          AND m.settled_at > $1 AND m.settled_at <= $2
        LIMIT 500`, [matchesFrom, now]);
    const done = new Set(); // a person starring the match AND a team of it still gets one notification
    for (const r of rowsM) {
      const key = `${r.id}|${r.endpoint}`;
      if (done.has(key)) continue;
      done.add(key);
      if (await send(r, { ...matchMessage(r), tag: `match-${r.id}`, url: '/' })) sent++;
    }
    await writeCursor(CURSOR_MATCHES, now);
    return { sent };
  } catch (err) {
    console.error('[push] sweep failed:', err.message);
    return { sent: 0, error: err.message };
  } finally {
    sweeping = false;
  }
}
