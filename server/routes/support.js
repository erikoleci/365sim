import express from 'express';
import { randomUUID } from 'crypto';
import pool from '../db.js';
import { requireAuth } from './auth.js';
import { wrap } from '../asyncHandler.js';
import { isAdminRole, isSuperAdmin } from '../roles.js';
import { scopeOf } from '../adminScope.js';
import { notifySupportInBackground } from '../supportNotify.js';

// Support: a player writes a problem (optionally tagging one of his own tickets), his admin and the super admin read and
// answer it. The player never learns who answered: every staff message reaches him as plain "Support".
// Visibility for staff: an admin sees the threads of the players he owns (users.admin_id), the super admin sees all of them
// and, for each, which admin the player belongs to.
const router = express.Router();
router.use(requireAuth);

const MAX_BODY = 2000;
const MAX_LABEL = 160;

// The tables also come from migrations/0023_support.sql; creating them here as well (idempotent) means a deploy never
// depends on the order in which the migration runner and the first request happen.
let ready = null;
function ensureTables() {
  if (!ready) {
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS support_threads (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), bet_id TEXT, ticket_no BIGINT, match_label TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN', created_at BIGINT NOT NULL, last_message_at BIGINT NOT NULL,
        last_from TEXT NOT NULL DEFAULT 'USER', user_seen_at BIGINT NOT NULL DEFAULT 0, staff_seen_at BIGINT NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_support_threads_user ON support_threads (user_id, last_message_at DESC);
      CREATE INDEX IF NOT EXISTS idx_support_threads_status ON support_threads (status, last_message_at DESC);
      CREATE TABLE IF NOT EXISTS support_messages (
        id SERIAL PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
        from_role TEXT NOT NULL, sender_id TEXT, body TEXT NOT NULL, created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages (thread_id, id);
    `).catch((err) => { ready = null; throw err; });
  }
  return ready;
}
router.use(wrap(async (_req, _res, next) => { await ensureTables(); next(); }));

const cleanBody = (v) => String(v ?? '').trim().slice(0, MAX_BODY);

// What a player sees of a thread: no sender ids, staff messages are labelled "Support".
function playerMessage(m) {
  return { id: m.id, from: m.from_role === 'USER' ? 'me' : 'support', body: m.body, at: Number(m.created_at) };
}

function threadSummary(t) {
  return {
    id: t.id, status: t.status, ticketNo: t.ticket_no == null ? null : Number(t.ticket_no), matchLabel: t.match_label || null,
    createdAt: Number(t.created_at), lastMessageAt: Number(t.last_message_at), lastFrom: t.last_from,
  };
}

// ---------------------------------------------------------------- player
// All of these are for the logged-in account's OWN threads (an account that is not a player simply has none).

router.get('/threads', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.*, (SELECT body FROM support_messages WHERE thread_id = t.id ORDER BY id DESC LIMIT 1) AS last_body
       FROM support_threads t WHERE t.user_id = $1 ORDER BY t.last_message_at DESC LIMIT 100`, [req.user.id]);
  res.json({
    threads: rows.map((t) => ({ ...threadSummary(t), lastBody: t.last_body, unread: t.last_from === 'STAFF' && Number(t.last_message_at) > Number(t.user_seen_at) })),
  });
}));

router.get('/unread', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM support_threads WHERE user_id = $1 AND last_from = 'STAFF' AND last_message_at > user_seen_at`, [req.user.id]);
  res.json({ unread: rows[0].n });
}));

router.get('/threads/:id', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM support_threads WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  const { rows: msgs } = await pool.query('SELECT id, from_role, body, created_at FROM support_messages WHERE thread_id = $1 ORDER BY id', [rows[0].id]);
  await pool.query('UPDATE support_threads SET user_seen_at = $2 WHERE id = $1', [rows[0].id, Date.now()]);
  res.json({ thread: threadSummary(rows[0]), messages: msgs.map(playerMessage) });
}));

// New problem. `betId` (optional) tags one of the player's OWN tickets: the number comes from the database, the match
// label is the text the player picked (one match of that ticket) and is cut to a sane length.
router.post('/threads', wrap(async (req, res) => {
  const body = cleanBody(req.body?.message);
  if (!body) return res.status(400).json({ error: 'Message is empty' });
  let betId = null; let ticketNo = null;
  if (req.body?.betId) {
    const { rows } = await pool.query('SELECT id, ticket_no FROM bets WHERE id = $1 AND user_id = $2', [String(req.body.betId), req.user.id]);
    if (!rows[0]) return res.status(400).json({ error: 'Ticket not found' });
    betId = rows[0].id; ticketNo = rows[0].ticket_no;
  }
  const matchLabel = req.body?.matchLabel ? String(req.body.matchLabel).trim().slice(0, MAX_LABEL) : null;
  const id = randomUUID(); const now = Date.now();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO support_threads (id, user_id, bet_id, ticket_no, match_label, status, created_at, last_message_at, last_from, user_seen_at, staff_seen_at)
       VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $6, 'USER', $6, 0)`, [id, req.user.id, betId, ticketNo, matchLabel, now]);
    await client.query('INSERT INTO support_messages (thread_id, from_role, sender_id, body, created_at) VALUES ($1, \'USER\', $2, $3, $4)', [id, req.user.id, body, now]);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
  notifySupportInBackground(pool, { userId: req.user.id, ticketNo, matchLabel, body, isNew: true }); // phone notification for the owner
  res.status(201).json({ id });
}));

router.post('/threads/:id/messages', wrap(async (req, res) => {
  const body = cleanBody(req.body?.message);
  if (!body) return res.status(400).json({ error: 'Message is empty' });
  const { rows } = await pool.query('SELECT id FROM support_threads WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  const now = Date.now();
  await pool.query('INSERT INTO support_messages (thread_id, from_role, sender_id, body, created_at) VALUES ($1, \'USER\', $2, $3, $4)', [req.params.id, req.user.id, body, now]);
  // A new message from the player re-opens a closed thread and is unread for the staff.
  await pool.query(`UPDATE support_threads SET last_message_at = $2, last_from = 'USER', status = 'OPEN', user_seen_at = $2 WHERE id = $1`, [req.params.id, now]);
  notifySupportInBackground(pool, { userId: req.user.id, ticketNo: null, matchLabel: null, body, isNew: false });
  res.status(201).json({ ok: true });
}));

// ---------------------------------------------------------------- staff (admin + super admin)

function requireStaff(req, res, next) {
  if (!isAdminRole(req.user?.role)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Threads this staff member may see: super admin = all, admin = players he owns.
const SCOPE_SQL = `($1::text IS NULL OR u.admin_id = $1)`;

router.get('/inbox', requireStaff, wrap(async (req, res) => {
  const scope = scopeOf(req.user);
  const status = req.query.status === 'CLOSED' ? 'CLOSED' : 'OPEN';
  const { rows } = await pool.query(
    `SELECT t.*, u.username, u.name AS user_name, u.role AS user_role, a.username AS admin_username, a.name AS admin_name,
            ag.username AS agent_username, ag.name AS agent_name,
            (SELECT body FROM support_messages WHERE thread_id = t.id ORDER BY id DESC LIMIT 1) AS last_body
       FROM support_threads t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN users a ON a.id = u.admin_id
       LEFT JOIN users ag ON ag.id = u.agent_id
      WHERE ${SCOPE_SQL} AND t.status = $2
      ORDER BY t.last_message_at DESC LIMIT 200`, [scope, status]);
  const superView = isSuperAdmin(req.user.role);
  res.json({
    threads: rows.map((t) => ({
      ...threadSummary(t), lastBody: t.last_body,
      user: { username: t.username, name: t.user_name, role: t.user_role },
      // The agent (if any) who looks after the player: staff need to know who is writing.
      agent: t.agent_username ? { username: t.agent_username, name: t.agent_name } : null,
      // Only the super admin is told which admin the player belongs to.
      admin: superView ? { username: t.admin_username || null, name: t.admin_name || null } : undefined,
      unread: t.last_from === 'USER' && Number(t.last_message_at) > Number(t.staff_seen_at),
    })),
  });
}));

router.get('/inbox-unread', requireStaff, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM support_threads t JOIN users u ON u.id = t.user_id
      WHERE ${SCOPE_SQL} AND t.status = 'OPEN' AND t.last_from = 'USER' AND t.last_message_at > t.staff_seen_at`, [scopeOf(req.user)]);
  res.json({ unread: rows[0].n });
}));

async function loadStaffThread(req) {
  const { rows } = await pool.query(
    `SELECT t.*, u.username, u.name AS user_name, u.role AS user_role, a.username AS admin_username, a.name AS admin_name,
            ag.username AS agent_username, ag.name AS agent_name
       FROM support_threads t JOIN users u ON u.id = t.user_id LEFT JOIN users a ON a.id = u.admin_id LEFT JOIN users ag ON ag.id = u.agent_id
      WHERE t.id = $2 AND ${SCOPE_SQL}`, [scopeOf(req.user), req.params.id]);
  return rows[0] || null;
}

router.get('/inbox/:id', requireStaff, wrap(async (req, res) => {
  const t = await loadStaffThread(req);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const { rows: msgs } = await pool.query('SELECT id, from_role, body, created_at FROM support_messages WHERE thread_id = $1 ORDER BY id', [t.id]);
  await pool.query('UPDATE support_threads SET staff_seen_at = $2 WHERE id = $1', [t.id, Date.now()]);
  // The tagged ticket, as it is right now, so the answer does not need a trip to another screen.
  let ticket = null;
  if (t.bet_id) {
    const { rows: bets } = await pool.query('SELECT id, ticket_no, status, stake, total_odds, potential_return, currency, created_at FROM bets WHERE id = $1', [t.bet_id]);
    if (bets[0]) {
      const { rows: legs } = await pool.query('SELECT match_home, match_away, market_name, selection_name, odds, status FROM bet_selections WHERE bet_id = $1 ORDER BY id', [t.bet_id]);
      ticket = {
        id: bets[0].id, ticketNo: bets[0].ticket_no == null ? null : Number(bets[0].ticket_no), status: bets[0].status,
        stake: Number(bets[0].stake), totalOdds: Number(bets[0].total_odds), potentialReturn: Number(bets[0].potential_return), currency: bets[0].currency,
        createdAt: Number(bets[0].created_at),
        legs: legs.map((l) => ({ match: `${l.match_home} - ${l.match_away}`, market: l.market_name, selection: l.selection_name, odds: Number(l.odds), status: l.status })),
      };
    }
  }
  const superView = isSuperAdmin(req.user.role);
  res.json({
    thread: { ...threadSummary(t), user: { username: t.username, name: t.user_name, role: t.user_role }, agent: t.agent_username ? { username: t.agent_username, name: t.agent_name } : null, admin: superView ? { username: t.admin_username || null, name: t.admin_name || null } : undefined },
    messages: msgs.map((m) => ({ id: m.id, from: m.from_role === 'USER' ? 'player' : 'staff', body: m.body, at: Number(m.created_at) })),
    ticket,
  });
}));

router.post('/inbox/:id/messages', requireStaff, wrap(async (req, res) => {
  const body = cleanBody(req.body?.message);
  if (!body) return res.status(400).json({ error: 'Message is empty' });
  const t = await loadStaffThread(req);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const now = Date.now();
  await pool.query('INSERT INTO support_messages (thread_id, from_role, sender_id, body, created_at) VALUES ($1, \'STAFF\', $2, $3, $4)', [t.id, req.user.id, body, now]);
  await pool.query(`UPDATE support_threads SET last_message_at = $2, last_from = 'STAFF', staff_seen_at = $2 WHERE id = $1`, [t.id, now]);
  res.status(201).json({ ok: true });
}));

router.post('/inbox/:id/status', requireStaff, wrap(async (req, res) => {
  const t = await loadStaffThread(req);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const status = req.body?.status === 'CLOSED' ? 'CLOSED' : 'OPEN';
  await pool.query('UPDATE support_threads SET status = $2 WHERE id = $1', [t.id, status]);
  res.json({ ok: true, status });
}));

export default router;
