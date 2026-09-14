import express from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import pool from '../db.js';
import { requireAuth } from './auth.js';
import { logAudit } from '../auditLog.js';
import { transferBalance } from '../ledger.js';

const router = express.Router();

// Only AGENT accounts may use these routes. ADMIN (Owner) keeps using the
// existing /api/admin/* routes untouched — this file is entirely new and
// additive, it does not replace or intercept any existing route.
function requireAgent(req, res, next) {
  if (req.user?.role !== 'AGENT') return res.status(403).json({ error: 'Agent access required' });
  next();
}

router.use(requireAuth, requireAgent);

function toPublicUser(row) {
  return {
    id: row.id, name: row.name, username: row.username,
    balance: row.balance, role: row.role, avatar: row.avatar,
    isActive: row.is_active, agentId: row.agent_id,
  };
}

// Loads the caller's own row FOR ownership checks below, always fresh
// (never trust the JWT payload for balance/role changes made after login).
async function loadSelf(req) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  return rows[0] || null;
}

// --- SELF ---

router.get('/me', async (req, res) => {
  const self = await loadSelf(req);
  if (!self) return res.status(404).json({ error: 'Agent not found' });
  res.json({ agent: toPublicUser(self) });
});

// --- MY USERS ---
// Ownership is enforced server-side on every route below via
// `agent_id = req.user.id` in the SQL, never by trusting a client-supplied
// agentId — this is what stops Agent A from reading/editing Agent B's users
// by guessing an id in the URL (IDOR).

router.get('/users', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE agent_id = $1 ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json({ users: rows.map(toPublicUser) });
});

router.post('/users', async (req, res) => {
  const { name, username, password, initialBalance } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'name, username, and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const startBalance = Number(initialBalance) || 0;
  if (startBalance < 0) return res.status(400).json({ error: 'initialBalance cannot be negative' });

  const self = await loadSelf(req);
  if (startBalance > 0 && self.balance < startBalance) {
    return res.status(400).json({ error: 'Insufficient agent balance to fund initial balance' });
  }

  const { rows: existingRows } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existingRows[0]) return res.status(409).json({ error: 'Username already taken' });

  const id = randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  await pool.query(
    `INSERT INTO users (id, name, username, password_hash, balance, role, avatar, agent_id, created_at)
     VALUES ($1,$2,$3,$4,0,'USER',$5,$6,$7)`,
    [id, name, username, hash, '', req.user.id, Date.now()]
  );

  if (startBalance > 0) {
    await transferBalance({
      actorId: req.user.id, sourceId: req.user.id, targetId: id,
      amount: startBalance, type: 'AGENT_CREATE_USER_FUND', reference: username,
    });
  }

  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  await logAudit(req.user, 'AGENT_USER_CREATE', id, { username, initialBalance: startBalance });
  res.status(201).json({ user: toPublicUser(rows[0]) });
});

router.patch('/users/:id/active', async (req, res) => {
  const { active } = req.body || {};
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'active must be a boolean' });

  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1 AND agent_id = $2', [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });

  await pool.query('UPDATE users SET is_active = $1 WHERE id = $2', [active, req.params.id]);
  await logAudit(req.user, active ? 'AGENT_USER_ENABLE' : 'AGENT_USER_DISABLE', req.params.id, { username: rows[0].username });
  res.json({ ok: true });
});

// Delete a user of mine. Refuses if the user still has a non-zero balance
// or any bets on record -- money/history must never silently vanish; the
// agent has to debit the balance to zero and there is no bet-deletion path
// at all, so this can only ever remove a genuinely empty, unused account.
router.delete('/users/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1 AND agent_id = $2', [req.params.id, req.user.id]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (Number(user.balance) !== 0) {
    return res.status(400).json({ error: 'Terheq balancen e userit ne zero para se ta fshish' });
  }
  const { rows: betRows } = await pool.query('SELECT id FROM bets WHERE user_id = $1 LIMIT 1', [req.params.id]);
  if (betRows[0]) {
    return res.status(400).json({ error: 'Ky user ka histori kuponash, nuk mund te fshihet' });
  }
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  await logAudit(req.user, 'AGENT_USER_DELETE', req.params.id, { username: user.username });
  res.json({ ok: true });
});

// Credit: Agent -> User (moves out of the agent's own balance).
router.post('/users/:id/credit', async (req, res) => {
  const { amount } = req.body || {};
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1 AND agent_id = $2', [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });

  try {
    const result = await transferBalance({
      actorId: req.user.id, sourceId: req.user.id, targetId: req.params.id,
      amount, type: 'AGENT_TO_USER', reference: rows[0].username,
    });
    await logAudit(req.user, 'AGENT_USER_CREDIT', req.params.id, { amount, username: rows[0].username });
    res.json({ balance: result.targetAfter, agentBalance: result.sourceAfter });
  } catch (err) {
    if (err.message === 'Insufficient balance') return res.status(400).json({ error: 'Insufficient agent balance' });
    throw err;
  }
});

// Debit: User -> Agent (withdraw funds back from a user into the agent's balance).
router.post('/users/:id/debit', async (req, res) => {
  const { amount } = req.body || {};
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1 AND agent_id = $2', [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });

  try {
    const result = await transferBalance({
      actorId: req.user.id, sourceId: req.params.id, targetId: req.user.id,
      amount, type: 'USER_TO_AGENT', reference: rows[0].username,
    });
    await logAudit(req.user, 'AGENT_USER_DEBIT', req.params.id, { amount, username: rows[0].username });
    res.json({ balance: result.sourceAfter, agentBalance: result.targetAfter });
  } catch (err) {
    if (err.message === 'Insufficient balance') return res.status(400).json({ error: 'Insufficient user balance' });
    throw err;
  }
});

// --- MY USERS' TICKETS / PERFORMANCE ---
// Read-only, scoped strictly to users belonging to this agent via a JOIN
// on agent_id — a user_id in the URL/body that belongs to another agent's
// user simply returns no rows, it can never leak another agent's data.

router.get('/users/:id/tickets', async (req, res) => {
  const { rows: owned } = await pool.query('SELECT id FROM users WHERE id = $1 AND agent_id = $2', [req.params.id, req.user.id]);
  if (!owned[0]) return res.status(404).json({ error: 'User not found' });

  const { rows: bets } = await pool.query(
    'SELECT * FROM bets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500',
    [req.params.id]
  );
  if (bets.length === 0) return res.json({ tickets: [] });

  // Pull every selection (match, market, pick, odds, won/lost) for those
  // tickets in one query, then group in JS — this is what lets the Agent
  // actually see WHICH matches a user bet on and whether each leg won or
  // lost, not just the ticket-level stake/status.
  const betIds = bets.map((b) => b.id);
  const { rows: selections } = await pool.query(
    'SELECT * FROM bet_selections WHERE bet_id = ANY($1) ORDER BY id ASC',
    [betIds]
  );
  const selectionsByBet = new Map();
  for (const sel of selections) {
    if (!selectionsByBet.has(sel.bet_id)) selectionsByBet.set(sel.bet_id, []);
    selectionsByBet.get(sel.bet_id).push({
      matchId: sel.match_id, matchHome: sel.match_home, matchAway: sel.match_away,
      marketId: sel.market_id, marketName: sel.market_name,
      selectionId: sel.selection_id, selectionName: sel.selection_name,
      odds: sel.odds, status: sel.status,
    });
  }

  res.json({
    tickets: bets.map((b) => ({
      id: b.id, type: b.type, stake: b.stake, totalOdds: b.total_odds,
      potentialReturn: b.potential_return, status: b.status, createdAt: b.created_at,
      selections: selectionsByBet.get(b.id) || [],
    })),
  });
});

// Summary performance per user (turnover, wins, losses, pending) — powers
// the "My Users" table (Balance/Tickets/Turnover/Wins/Losses/Pending/Net).
router.get('/performance', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.username, u.balance, u.is_active,
            COALESCE(COUNT(b.id), 0)::int AS tickets,
            COALESCE(SUM(b.stake), 0) AS turnover,
            COALESCE(SUM(CASE WHEN b.status = 'WON' THEN b.potential_return - b.stake ELSE 0 END), 0) AS wins,
            COALESCE(SUM(CASE WHEN b.status = 'LOST' THEN b.stake ELSE 0 END), 0) AS losses,
            COALESCE(SUM(CASE WHEN b.status = 'PENDING' THEN b.stake ELSE 0 END), 0) AS pending
     FROM users u
     LEFT JOIN bets b ON b.user_id = u.id
     WHERE u.agent_id = $1
     GROUP BY u.id
     ORDER BY u.created_at DESC`,
    [req.user.id]
  );
  res.json({ users: rows });
});

// Pure, independently-testable month-boundary calculation — the part most
// likely to have an off-by-one bug (December rollover, month padding).
// Exported so tests/agent.test.js can verify it directly without spinning
// up Express or a DB.
export function monthRange(monthParam) {
  const valid = typeof monthParam === 'string' && /^\d{4}-\d{2}$/.test(monthParam);
  const now = new Date();
  const [year, month] = valid
    ? monthParam.split('-').map(Number)
    : [now.getUTCFullYear(), now.getUTCMonth() + 1];

  const rangeStart = Date.UTC(year, month - 1, 1);
  const rangeEnd = Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1);
  return { year, month, rangeStart, rangeEnd, label: `${year}-${String(month).padStart(2, '0')}` };
}

// Monthly summary across ALL of this agent's users combined, plus a
// per-user breakdown for the same month (spec: "AGENT MONTHLY SUMMARY" +
// "User Breakdown"). `month` is 'YYYY-MM'; defaults to the current month.
router.get('/reports/monthly', async (req, res) => {
  const { year, month, rangeStart, rangeEnd, label } = monthRange(req.query.month);

  const { rows: totalsRows } = await pool.query(
    `SELECT COUNT(DISTINCT u.id)::int AS total_users,
            COALESCE(COUNT(b.id), 0)::int AS total_tickets,
            COALESCE(SUM(b.stake), 0) AS turnover,
            COALESCE(SUM(CASE WHEN b.status = 'WON' THEN b.potential_return - b.stake ELSE 0 END), 0) AS wins,
            COALESCE(SUM(CASE WHEN b.status = 'LOST' THEN b.stake ELSE 0 END), 0) AS losses,
            COALESCE(SUM(CASE WHEN b.status = 'PENDING' THEN b.stake ELSE 0 END), 0) AS pending
     FROM users u
     LEFT JOIN bets b ON b.user_id = u.id AND b.created_at >= $2 AND b.created_at < $3
     WHERE u.agent_id = $1`,
    [req.user.id, rangeStart, rangeEnd]
  );

  const { rows: perUser } = await pool.query(
    `SELECT u.id, u.name, u.username,
            COALESCE(COUNT(b.id), 0)::int AS tickets,
            COALESCE(SUM(b.stake), 0) AS turnover,
            COALESCE(SUM(CASE WHEN b.status = 'WON' THEN b.potential_return - b.stake ELSE 0 END), 0) AS wins,
            COALESCE(SUM(CASE WHEN b.status = 'LOST' THEN b.stake ELSE 0 END), 0) AS losses,
            COALESCE(SUM(CASE WHEN b.status = 'PENDING' THEN b.stake ELSE 0 END), 0) AS pending
     FROM users u
     LEFT JOIN bets b ON b.user_id = u.id AND b.created_at >= $2 AND b.created_at < $3
     WHERE u.agent_id = $1
     GROUP BY u.id
     ORDER BY turnover DESC`,
    [req.user.id, rangeStart, rangeEnd]
  );

  const t = totalsRows[0];
  res.json({
    month: label,
    totals: {
      totalUsers: t.total_users, totalTickets: t.total_tickets, turnover: t.turnover,
      wins: t.wins, losses: t.losses, pending: t.pending,
      netResult: Number(t.losses) - Number(t.wins),
    },
    users: perUser,
  });
});

export default router;
