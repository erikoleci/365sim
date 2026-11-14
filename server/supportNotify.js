import { notifyStaffDevices } from './webPush.js';

// Phone notification for the owner when a player writes to Support. Channels (any or both): ntfy.sh topic (NTFY_TOPIC, optional NTFY_SERVER) and
// Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID). Nothing configured = nothing is sent. Never blocks or fails the request that triggered it.
const IMPORTANT = /terheq|tërheq|terhiq|dalje|\bdil(?:ni|ush|je)?\b|pages|pagës|\bpare\b|paratë|kerkes|kërkes|urgjent|urgjenc|ndihm|problem|gabim|mashtr|bllok|humb|anul|rimburs|depozit|deposit|withdraw|help|urgent/i;

export const isImportantMessage = (text) => IMPORTANT.test(String(text || '').normalize('NFC'));

const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

export function buildSupportNotice({ player, ticketNo, matchLabel, body, isNew }) {
  const important = isImportantMessage(body);
  const who = (player && (player.name || player.username)) ? `${player.name || player.username}${player.username && player.name ? ' (@' + player.username + ')' : ''}` : 'Një lojtar';
  const bits = [];
  if (ticketNo != null) bits.push('bileta #' + ticketNo);
  if (matchLabel) bits.push(clip(matchLabel, 60));
  const title = (important ? '⚠ ' : '') + (isNew ? 'Support: kërkesë e re' : 'Support: mesazh i ri') + ' nga ' + who;
  const text = (bits.length ? '[' + bits.join(' · ') + '] ' : '') + clip(body, 300);
  return { title, text, important };
}

export async function notifySupport(notice, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!fetchImpl) return { sent: [] };
  const sent = [];
  const jobs = [];
  if (env.NTFY_TOPIC) {
    const server = (env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
    jobs.push(fetchImpl(`${server}/${encodeURIComponent(env.NTFY_TOPIC)}`, {
      method: 'POST',
      headers: { Title: '=?UTF-8?B?' + Buffer.from(notice.title, 'utf8').toString('base64') + '?=', Priority: notice.important ? 'urgent' : 'high', Tags: notice.important ? 'warning' : 'speech_balloon' },
      body: notice.text,
      signal: AbortSignal.timeout(8000),
    }).then((r) => { if (r.ok) sent.push('ntfy'); else console.error('[support-notify] ntfy HTTP ' + r.status); }));
  }
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    jobs.push(fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: notice.title + '\n' + notice.text }),
      signal: AbortSignal.timeout(8000),
    }).then((r) => { if (r.ok) sent.push('telegram'); else console.error('[support-notify] telegram HTTP ' + r.status); }));
  }
  await Promise.all(jobs.map((j) => j.catch((e) => console.error('[support-notify] failed:', e && e.message))));
  return { sent };
}

let warned = false;
// Fire and forget from a route: looks the player up, builds the notice and sends it (Web Push to the staff devices, ntfy / Telegram when
// configured); any problem is only logged and never reaches the player.
export function notifySupportInBackground(pool, { userId, ticketNo, matchLabel, body, isNew }) {
  const env = process.env;
  (async () => {
    let player = null;
    try { player = (await pool.query('SELECT username, name, admin_id FROM users WHERE id = $1', [userId])).rows[0] || null; } catch { /* the notice goes without the name */ }
    const notice = buildSupportNotice({ player, ticketNo, matchLabel, body, isNew });
    const jobs = [notifyStaffDevices({ adminId: player && player.admin_id, payload: { title: notice.title, body: notice.text, tag: 'support', url: '/', important: notice.important } })
      .catch((e) => console.error('[support-notify] web push failed:', e && e.message))];
    if (env.NTFY_TOPIC || (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID)) jobs.push(notifySupport(notice));
    else if (!warned) { warned = true; console.log('[support-notify] no NTFY_TOPIC / TELEGRAM_* set: only Web Push reaches the staff phones'); }
    await Promise.all(jobs);
  })().catch((e) => console.error('[support-notify] failed:', e && e.message));
}
