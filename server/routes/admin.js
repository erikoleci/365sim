import { findProviderLabels } from '../providerLabels.js';
import { getVcSamples } from '../vcSampler.js';
import express from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import pool from '../db.js';
import { requireAuth } from './auth.js';
import { readLiveCorners, readLiveCards } from '../matchSettlement.js';
import { settleMatch, recomputeBetStatus, settleStuckBets, voidOverdueLegs, recoverFinishedWithoutResult, explainSettleBlock } from '../matchSettlement.js';
import { missedLiveCycles } from '../london365/liveState.js';
import { logAudit } from '../auditLog.js';
import { buildCoverageReport, formatCoverageText } from '../marketCoverage.js';
import { settlementRuleRequired, getBetBlockReason } from '../marketRules.js';
import { getFeedKeySamples } from '../feedKeySampler.js';
import { getRecentErrors } from '../recentErrors.js';
import { getUnmappedVcReport } from '../vcDeltaSampler.js';
import { mapEventToMatch } from '../oddsUtils.js';

import { transferBalance, transferBalances, amountParts, readWallet, walletColumn } from '../ledger.js';
import { getTicketDeletionAllowed, setTicketDeletionAllowed } from '../appSettings.js';
import { getCasinoAccess, setCasinoAccess, CASINO_MODES } from '../casinoAccess.js';
import { isAdminRole, isSuperAdmin, ROLE_ADMIN } from '../roles.js';
import { scopeOf, ownsRow } from '../adminScope.js';
import { importLondon365, getLondon365Status, getLondon365CountryDebug } from '../london365.js';
import { monthRange } from './agent.js';
import { userMetrics, buildCommissionReport, periodRange } from '../commission.js';
import { buildCreditLedger, feeRateFromEnv } from '../creditLedger.js';
import { deleteUserIfUnused, deleteBlockedMessage, forceDeleteUser } from '../userDeletion.js';

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!isAdminRole(req.user?.role)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Super admin only: crediting admins, creating / deleting admins, erasing any ticket.
function requireSuperAdmin(req, res, next) {
  if (!isSuperAdmin(req.user?.role)) return res.status(403).json({ error: 'Super admin access required' });
  next();
}

router.use(requireAuth, requireAdmin);

// Markets, the odds feed and every settlement tool belong to the super admin only. A normal admin keeps users,
// agents, credit, the profit / loss figures and the ticket list; everything below answers him 403.
// (requireSuperAdmin is a function declaration, so it is available here.)
for (const path of [
  '/london365', '/bet-selections', '/matches', '/pending-legs', '/legs', '/market-coverage', '/unmapped-vc',
  '/corner-diagnose', '/recent-errors', '/vc-codes', '/provider-labels', '/feed-keys', '/settle-diagnose',
  '/bets/settle-stuck', '/risk',
]) router.use(path, requireSuperAdmin);

// Every agent and user belongs to one admin (users.admin_id). A normal admin only sees and manages his own;
// the super admin sees everything. scopeOf() is the SQL parameter ("$n::text IS NULL OR admin_id = $n"),
// ownsRow() the check on one row. A row that is not his answers 404, so nothing leaks about other admins' accounts.

// What to add to the player's balance so the ticket is as if it had never been placed:
// open / lost -> the stake comes back; won -> the winnings are taken back; void (already refunded) -> nothing.
export function betBalanceReversal(bet) {
  const stake = Number(bet.stake) || 0;
  const ret = Number(bet.potential_return) || 0;
  switch (bet.status) {
    case 'PENDING': case 'LOST': return stake;
    case 'WON': return -(ret - stake);
    default: return 0; // VOID, cash-out ...: the money already moved back, nothing to reverse
  }
}

// An admin account can only be deleted by the super admin; a super admin is never deleted
// (and nobody deletes their own account).
function canDeleteAccount(actor, target) {
  if (target.id === actor.id || target.role === 'SUPER_ADMIN') return false;
  if (target.role === ROLE_ADMIN) return isSuperAdmin(actor.role);
  return true;
}

function toPublicUser(row) {
  return {
    id: row.id, name: row.name, username: row.username,
    balance: row.balance, balanceEur: row.balance_eur ?? 0, role: row.role, avatar: row.avatar,
    isActive: row.is_active, agentId: row.agent_id, adminId: row.admin_id ?? null,
    // Only meaningful for AGENT rows; present (as 0) for USER/ADMIN too so
    // the shape is consistent, since the frontend types this as a single
    // PublicUser regardless of role.
    commissionRate: row.commission_rate != null ? Number(row.commission_rate) : 0,
  };
}

// --- LONDONPRO365 DATA PROVIDER ---

// Manually trigger a full import of every LondonPro365 sport, league, match,
// market, and coefficient into matches_cache (the throttle guard is inside).
// Fire-and-forget: a full import can take several minutes (one HTTP request
// per league + per game when full detail is on), which is longer than
// Render's own reverse-proxy timeout — waiting for it here would always end
// in a 502 to the browser even though the import keeps running fine in the
// background. So we kick it off and respond immediately; check progress via
// GET /london365/status (matches count + lastImport timestamp) instead.
router.post('/london365/import', async (req, res) => {
  const body = req.body || {};
  importLondon365({
    sports: body.sports,
    leagues: body.leagues,
    matches: body.matches,
    full: body.full,
  }).then((result) => {
    logAudit(req.user, 'LONDON365_IMPORT', 'london365', result).catch(() => {});
  }).catch((err) => {
    console.error('[admin] london365 import failed:', err.message);
  });
  res.json({ started: true, note: 'Import running in the background — poll GET /api/admin/london365/status for progress (matches count, lastImport timestamp).' });
});

router.get('/london365/status', async (req, res) => {
  res.json(await getLondon365Status());
});

// Shows exactly how every real league name we've seen gets classified into
// a country (or "other") — open this in the browser while logged in as
// admin to see/paste the real mapping instead of guessing at it.
router.get('/london365/countries-debug', async (req, res) => {
  res.json(await getLondon365CountryDebug());
});

// --- USERS ---

router.get('/users', async (req, res) => {
  // Capped like /audit-log — prevents an unbounded SELECT * as the user
  // base grows; 1000 is comfortably above anything this demo needs today.
  // `offset` is additive/optional: existing callers that only pass `limit`
  // (or nothing) keep getting page 1 exactly as before. `total` lets a
  // caller that DOES want real pagination render "page X of Y" instead of
  // guessing whether more rows exist past the 1000-row cap.
  const limit = Math.min(Number(req.query.limit) || 1000, 1000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const scope = scopeOf(req.user);
  // A normal admin sees his own account plus the agents and users that belong to him, nobody else's.
  const [{ rows: users }, { rows: countRows }] = await Promise.all([
    pool.query(
      'SELECT * FROM users WHERE ($3::text IS NULL OR admin_id = $3 OR id = $3) ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset, scope]
    ),
    pool.query('SELECT COUNT(*)::int AS count FROM users WHERE ($1::text IS NULL OR admin_id = $1 OR id = $1)', [scope]),
  ]);
  // A normal admin never sees the super admin account (nor its balance).
  const visible = isSuperAdmin(req.user.role) ? users : users.filter((u) => u.role !== 'SUPER_ADMIN');
  res.json({ users: visible.map(toPublicUser), total: countRows[0].count - (users.length - visible.length), limit, offset });
});

router.post('/users', async (req, res) => {
  const { name, username, password, balance } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'name, username, and password are required' });
  }
  const { rows: existingRows } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existingRows[0]) return res.status(409).json({ error: 'Username already taken' });

  const id = randomUUID();
  const hash = await bcrypt.hash(password, 10);
  // The new user belongs to the admin who creates him (the super admin's own users stay unowned).
  await pool.query(
    `INSERT INTO users (id, name, username, password_hash, balance, role, avatar, admin_id, created_at)
     VALUES ($1,$2,$3,$4,$5,'USER',$6,$7,$8)`,
    [id, name, username, hash, isSuperAdmin(req.user.role) ? (Number(balance) || 0) : 0, '', isSuperAdmin(req.user.role) ? null : req.user.id, Date.now()]
  );
  if (!isSuperAdmin(req.user.role) && Number(balance) > 0) {
    try {
      await transferBalance({ actorId: req.user.id, sourceId: req.user.id, targetId: id, amount: Number(balance), type: 'ADMIN_TO_USER', reference: username });
    } catch (err) {
      await pool.query('DELETE FROM users WHERE id = $1', [id]);
      if (err.message === 'Insufficient balance') return res.status(400).json({ error: 'Kredia jote ka mbaruar: prit që super admini të të shtojë kredi' });
      throw err;
    }
  }

  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  await logAudit(req.user, 'USER_CREATE', id, { username, balance: Number(balance) || 0 });
  res.status(201).json({ user: toPublicUser(rows[0]) });
});

// --- AGENTS (Owner manages the Agent tier; existing /users endpoints above
// are untouched and keep creating plain USER rows exactly as before) ---

// Snapshot for the dashboard: counts + money totals only (no per-user drill-down here — that's
// /agents/:id/performance below, or the existing GET /users for a flat list). A normal admin gets the
// numbers of HIS agents and their users; the super admin gets the whole system.
router.get('/overview', async (req, res) => {
  const scope = [scopeOf(req.user)];
  const [agentsCount, usersCount, betsAgg] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active,
                        COALESCE(SUM(balance), 0) AS total_balance, COALESCE(SUM(balance_eur), 0) AS total_balance_eur
                 FROM users WHERE role = 'AGENT' AND ($1::text IS NULL OR admin_id = $1)`, scope),
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active,
                        COALESCE(SUM(balance), 0) AS total_balance, COALESCE(SUM(balance_eur), 0) AS total_balance_eur
                 FROM users WHERE role = 'USER' AND ($1::text IS NULL OR admin_id = $1)`, scope),
    pool.query(`SELECT ${TICKET_SUMS}
                 FROM bets b WHERE b.status <> 'CANCELLED' AND ($1::text IS NULL OR b.user_id IN (SELECT id FROM users WHERE admin_id = $1))`, scope),
  ]);
  const t = withNet(betsAgg.rows[0]);
  res.json({
    agents: { total: agentsCount.rows[0].total, active: agentsCount.rows[0].active, totalBalance: agentsCount.rows[0].total_balance, totalBalanceEur: agentsCount.rows[0].total_balance_eur },
    users: { total: usersCount.rows[0].total, active: usersCount.rows[0].active, totalBalance: usersCount.rows[0].total_balance, totalBalanceEur: usersCount.rows[0].total_balance_eur },
    tickets: {
      total: t.tickets,
      turnover: t.turnover, wins: t.wins, losses: t.losses, pending: t.pending,
      turnoverEur: t.turnover_eur, winsEur: t.wins_eur, lossesEur: t.losses_eur, pendingEur: t.pending_eur,
      pendingCount: t.pending_tickets,
    },
    netResult: t.netResult,
    netResultEur: t.netResultEur,
  });
});

router.get('/agents', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE role = 'AGENT' AND ($1::text IS NULL OR admin_id = $1) ORDER BY created_at DESC`,
    [scopeOf(req.user)]
  );
  res.json({ agents: rows.map(toPublicUser) });
});

// Monthly report: totals across the agents+users in scope combined (all of them for the super admin, only
// the admin's own for a normal admin), plus a per-agent breakdown for that month (spec: "OWNER MONTHLY SUMMARY"
// + "Agent Breakdown"). Reuses the same month-boundary helper as the Agent's own monthly report for consistency.
// How the money columns are counted (all over the tickets PLACED in the month, void tickets left out):
//   turnover = sum of the stakes of every ticket            wins   = what the WON tickets paid beyond the stake
//   losses   = the stakes of the LOST tickets               pending = stakes still on open tickets
//   netResult = losses - wins  -> the house's profit (positive) or loss (negative) on the settled tickets
// Lek and euro are NEVER added together: every money column exists twice, once for the tickets staked in lek
// (bets.currency = 'ALL', plain column names) and once for the tickets staked in euro (suffix _eur).
const sumsIn = (cur, sfx) => `COALESCE(SUM(b.stake) FILTER (WHERE b.currency = '${cur}'), 0) AS turnover${sfx},
            COALESCE(SUM(b.potential_return - b.stake) FILTER (WHERE b.currency = '${cur}' AND b.status = 'WON'), 0) AS wins${sfx},
            COALESCE(SUM(b.stake) FILTER (WHERE b.currency = '${cur}' AND b.status = 'LOST'), 0) AS losses${sfx},
            COALESCE(SUM(b.stake) FILTER (WHERE b.currency = '${cur}' AND b.status = 'PENDING'), 0) AS pending${sfx}`;
const MONEY_SUMS = `${sumsIn('ALL', '')},
            ${sumsIn('EUR', '_eur')}`;
const TICKET_SUMS = `COUNT(b.id)::int AS tickets,
            ${MONEY_SUMS},
            COUNT(b.id) FILTER (WHERE b.status = 'WON')::int AS won_tickets,
            COUNT(b.id) FILTER (WHERE b.status = 'LOST')::int AS lost_tickets,
            COUNT(b.id) FILTER (WHERE b.status = 'PENDING')::int AS pending_tickets`;
// netResult = losses - wins (house profit when positive) -- one figure per currency.
const withNet = (r) => ({
  ...r,
  netResult: Number(r.losses) - Number(r.wins),
  netResultEur: Number(r.losses_eur) - Number(r.wins_eur),
});

// Monthly report: totals over ALL the users in scope (the admin's own, also the ones he created directly
// without an agent; everything for the super admin), a per-agent breakdown, and one line for the users that
// have no agent. Reuses the same month-boundary helper as the Agent's own monthly report for consistency.
router.get('/reports/monthly', async (req, res) => {
  const { rangeStart, rangeEnd, label } = monthRange(req.query.month);
  const scope = scopeOf(req.user);

  const { rows: totalsRows } = await pool.query(
    `SELECT (SELECT COUNT(*)::int FROM users a WHERE a.role = 'AGENT' AND ($3::text IS NULL OR a.admin_id = $3)) AS total_agents,
            (SELECT COUNT(*)::int FROM users x WHERE x.role = 'USER' AND ($3::text IS NULL OR x.admin_id = $3)) AS total_users,
            ${TICKET_SUMS}
     FROM bets b
     JOIN users u ON u.id = b.user_id
     WHERE b.status <> 'CANCELLED' AND b.created_at >= $1 AND b.created_at < $2 AND ($3::text IS NULL OR u.admin_id = $3)`,
    [rangeStart, rangeEnd, scope]
  );

  const { rows: perAgent } = await pool.query(
    `SELECT a.id, a.name, a.username, a.commission_rate,
            COUNT(DISTINCT u.id)::int AS total_users,
            ${TICKET_SUMS}
     FROM users a
     LEFT JOIN users u ON u.agent_id = a.id
     LEFT JOIN bets b ON b.user_id = u.id AND b.status <> 'CANCELLED' AND b.created_at >= $1 AND b.created_at < $2
     WHERE a.role = 'AGENT' AND ($3::text IS NULL OR a.admin_id = $3)
     GROUP BY a.id
     ORDER BY turnover DESC`,
    [rangeStart, rangeEnd, scope]
  );

  const { rows: directRows } = await pool.query(
    `SELECT COUNT(DISTINCT u.id)::int AS total_users,
            ${TICKET_SUMS}
     FROM users u
     LEFT JOIN bets b ON b.user_id = u.id AND b.status <> 'CANCELLED' AND b.created_at >= $1 AND b.created_at < $2
     WHERE u.role = 'USER' AND u.agent_id IS NULL AND ($3::text IS NULL OR u.admin_id = $3)`,
    [rangeStart, rangeEnd, scope]
  );

  const t = withNet(totalsRows[0]);
  const d = withNet(directRows[0]);
  res.json({
    month: label,
    totals: {
      totalAgents: t.total_agents, totalUsers: t.total_users, totalTickets: t.tickets,
      turnover: t.turnover, wins: t.wins, losses: t.losses, pending: t.pending,
      turnoverEur: t.turnover_eur, winsEur: t.wins_eur, lossesEur: t.losses_eur, pendingEur: t.pending_eur,
      wonTickets: t.won_tickets, lostTickets: t.lost_tickets, pendingTickets: t.pending_tickets,
      netResult: t.netResult, netResultEur: t.netResultEur,
    },
    // Users that belong to the admin directly (no agent in between).
    direct: d,
    // commissionOwed: the agent's share of the house's net result for the month, per currency (informational).
    agents: perAgent.map((raw) => {
      const a = withNet(raw);
      const commissionRate = Number(a.commission_rate);
      const owed = (net) => (net > 0 ? Number((net * commissionRate / 100).toFixed(2)) : 0);
      return { ...a, commissionRate, commissionOwed: owed(a.netResult), commissionOwedEur: owed(a.netResultEur) };
    }),
  });
});

// SUPER ADMIN: what every admin did in the month -- his credit, how many agents / users he has, how many
// tickets they placed, the turnover, what the players won and lost, and the admin's net result (netResult =
// losses - wins). `unowned` are the users nobody owns yet. Same counting rules as above.
router.get('/reports/admins', requireSuperAdmin, async (req, res) => {
  const { rangeStart, rangeEnd, label } = monthRange(req.query.month);
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.username, a.balance, a.balance_eur AS "balanceEur",
            (SELECT COUNT(*)::int FROM users x WHERE x.admin_id = a.id AND x.role = 'AGENT') AS agents,
            (SELECT COUNT(*)::int FROM users x WHERE x.admin_id = a.id AND x.role = 'USER') AS users,
            ${TICKET_SUMS}
     FROM users a
     LEFT JOIN users u ON u.admin_id = a.id AND u.role = 'USER'
     LEFT JOIN bets b ON b.user_id = u.id AND b.status <> 'CANCELLED' AND b.created_at >= $1 AND b.created_at < $2
     WHERE a.role = 'ADMIN'
     GROUP BY a.id
     ORDER BY turnover DESC`,
    [rangeStart, rangeEnd]
  );
  const { rows: unownedRows } = await pool.query(
    `SELECT COUNT(DISTINCT u.id)::int AS users,
            ${TICKET_SUMS}
     FROM users u
     LEFT JOIN bets b ON b.user_id = u.id AND b.status <> 'CANCELLED' AND b.created_at >= $1 AND b.created_at < $2
     WHERE u.role = 'USER' AND u.admin_id IS NULL`,
    [rangeStart, rangeEnd]
  );
  res.json({ month: label, admins: rows.map(withNet), unowned: withNet(unownedRows[0]) });
});

router.post('/agents', async (req, res) => {
  const { name, username, password, balance, adminId } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'name, username, and password are required' });
  }
  const startBalance = Number(balance) || 0;
  if (startBalance < 0) return res.status(400).json({ error: 'balance cannot be negative' });

  const { rows: existingRows } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existingRows[0]) return res.status(409).json({ error: 'Username already taken' });

  // The new agent belongs to the admin who creates him. The super admin may name the admin (adminId) or leave
  // the agent unowned, to assign later with PATCH /agents/:id/admin.
  let ownerAdminId = isSuperAdmin(req.user.role) ? null : req.user.id;
  if (isSuperAdmin(req.user.role) && adminId) {
    const { rows: adminRows } = await pool.query(`SELECT id FROM users WHERE id = $1 AND role = 'ADMIN'`, [adminId]);
    if (!adminRows[0]) return res.status(400).json({ error: 'adminId is not an admin account' });
    ownerAdminId = adminRows[0].id;
  }

  const { rows: ownerRows } = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
  if (startBalance > 0 && (!ownerRows[0] || ownerRows[0].balance < startBalance)) {
    return res.status(400).json({ error: 'Insufficient owner balance to fund initial balance' });
  }

  const id = randomUUID();
  const hash = await bcrypt.hash(password, 10);
  // Insert with balance=0, then move the requested starting balance out of
  // the Owner's own balance via transferBalance() below — this is what
  // gives the initial funding a `transactions` row (source_id = owner,
  // target_id = agent), exactly like Agent -> User creation funding
  // already does in agent.js. A raw `balance = $N` in the INSERT would
  // create money the ledger never sees, breaking Owner's own reports.
  await pool.query(
    `INSERT INTO users (id, name, username, password_hash, balance, role, avatar, admin_id, created_at)
     VALUES ($1,$2,$3,$4,0,'AGENT',$5,$6,$7)`,
    [id, name, username, hash, '', ownerAdminId, Date.now()]
  );

  if (startBalance > 0) {
    await transferBalance({
      actorId: req.user.id, sourceId: req.user.id, targetId: id,
      amount: startBalance, type: 'OWNER_CREATE_AGENT_FUND', reference: username,
    });
  }

  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  await logAudit(req.user, 'AGENT_CREATE', id, { username, balance: startBalance });
  res.status(201).json({ agent: toPublicUser(rows[0]) });
});

// Set/update an agent's commission rate (% of their users' net gaming
// result the platform owes them). A normal admin can only do it for his own agents.
router.patch('/agents/:id/commission', async (req, res) => {
  const rate = Number(req.body?.commissionRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return res.status(400).json({ error: 'commissionRate must be a number between 0 and 100' });
  }
  const { rows } = await pool.query(`SELECT id, admin_id FROM users WHERE id = $1 AND role = 'AGENT'`, [req.params.id]);
  if (!rows[0] || !ownsRow(req.user, rows[0])) return res.status(404).json({ error: 'Agent not found' });

  await pool.query('UPDATE users SET commission_rate = $1 WHERE id = $2', [rate, req.params.id]);
  await logAudit(req.user, 'AGENT_COMMISSION_SET', req.params.id, { commissionRate: rate });
  res.json({ ok: true, commissionRate: rate });
});

// Top up an EXISTING agent's balance out of the admin's own balance. There
// was previously no way to do this after agent creation — funding only
// happened once, at creation time.
router.post('/agents/:id/credit', async (req, res) => {
  const parts = amountParts(req.body);
  if (!parts || parts.some((p) => p.amount <= 0)) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1 AND role = 'AGENT'`, [req.params.id]);
  if (!rows[0] || !ownsRow(req.user, rows[0])) return res.status(404).json({ error: 'Agent not found' });

  try {
    await transferBalances({
      actorId: req.user.id, sourceId: req.user.id, targetId: req.params.id,
      type: 'OWNER_TO_AGENT', reference: rows[0].username,
    }, parts);
    await logAudit(req.user, 'AGENT_CREDIT', req.params.id, { amounts: parts, username: rows[0].username });
    const agent = await readWallet(req.params.id);
    const owner = await readWallet(req.user.id);
    res.json({ balance: agent.balance, balanceEur: agent.balanceEur, ownerBalance: owner.balance, ownerBalanceEur: owner.balanceEur });
  } catch (err) {
    if (err.message === 'Insufficient balance') return res.status(400).json({ error: 'Insufficient owner balance' });
    throw err;
  }
});

// Withdraw funds back from an agent into the admin's own balance (the
// reverse of the above) — mirrors the existing Agent -> User debit route.
router.post('/agents/:id/debit', async (req, res) => {
  const parts = amountParts(req.body);
  if (!parts || parts.some((p) => p.amount <= 0)) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1 AND role = 'AGENT'`, [req.params.id]);
  if (!rows[0] || !ownsRow(req.user, rows[0])) return res.status(404).json({ error: 'Agent not found' });

  try {
    await transferBalances({
      actorId: req.user.id, sourceId: req.params.id, targetId: req.user.id,
      type: 'AGENT_TO_OWNER', reference: rows[0].username,
    }, parts);
    await logAudit(req.user, 'AGENT_DEBIT', req.params.id, { amounts: parts, username: rows[0].username });
    const agent = await readWallet(req.params.id);
    const owner = await readWallet(req.user.id);
    res.json({ balance: agent.balance, balanceEur: agent.balanceEur, ownerBalance: owner.balance, ownerBalanceEur: owner.balanceEur });
  } catch (err) {
    if (err.message === 'Insufficient balance') return res.status(400).json({ error: 'Insufficient agent balance' });
    throw err;
  }
});

// Owner drill-down: Agent -> its Users, with the same turnover/wins/losses
// breakdown the agent itself sees in GET /api/agent/performance.
router.get('/agents/:id/performance', async (req, res) => {
  const { rows: agentRows } = await pool.query(`SELECT * FROM users WHERE id = $1 AND role = 'AGENT'`, [req.params.id]);
  if (!agentRows[0] || !ownsRow(req.user, agentRows[0])) return res.status(404).json({ error: 'Agent not found' });

  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.username, u.balance, u.balance_eur AS "balanceEur", u.is_active,
            COALESCE(COUNT(b.id), 0)::int AS tickets,
            ${MONEY_SUMS}
     FROM users u
     LEFT JOIN bets b ON b.user_id = u.id AND b.status <> 'CANCELLED'
     WHERE u.agent_id = $1
     GROUP BY u.id
     ORDER BY u.created_at DESC`,
    [req.params.id]
  );
  res.json({ agent: toPublicUser(agentRows[0]), users: rows });
});

router.delete('/users/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  const user = rows[0];
  if (!user || !ownsRow(req.user, user)) return res.status(404).json({ error: 'User not found' });
  if (!canDeleteAccount(req.user, user)) return res.status(400).json({ error: 'Cannot delete an admin user' });
  const result = await deleteUserIfUnused(req.params.id);
  if (!result.ok) {
    return res.status(409).json({ error: deleteBlockedMessage(result.blockers), code: 'USER_HAS_HISTORY', blockers: result.blockers });
  }
  // A deleted admin leaves his agents and users unowned (only the super admin sees them until he reassigns them).
  if (user.role === ROLE_ADMIN) await pool.query('UPDATE users SET admin_id = NULL WHERE admin_id = $1', [req.params.id]);
  await logAudit(req.user, 'USER_DELETE', req.params.id, { username: user.username });
  res.json({ ok: true });
});

// Admin-only full wipe: deletes the user AND their bets/transactions/casino
// history/sub-users instead of refusing when history exists. Destructive and
// irreversible -- the frontend only offers this as an explicit follow-up
// after the safe delete above comes back 409 USER_HAS_HISTORY.
router.delete('/users/:id/force', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  const user = rows[0];
  if (!user || !ownsRow(req.user, user)) return res.status(404).json({ error: 'User not found' });
  if (!canDeleteAccount(req.user, user)) return res.status(400).json({ error: 'Cannot delete an admin user' });
  await forceDeleteUser(req.params.id);
  if (user.role === ROLE_ADMIN) await pool.query('UPDATE users SET admin_id = NULL WHERE admin_id = $1', [req.params.id]);
  await logAudit(req.user, 'USER_FORCE_DELETE', req.params.id, { username: user.username, role: user.role });
  res.json({ ok: true });
});

router.post('/users/:id/credit', async (req, res) => {
  // `amount` = lek, `amountEur` = euro: either or both, positive (give) or negative (take back).
  const parts = amountParts(req.body, { signed: true });
  if (!parts) {
    return res.status(400).json({ error: 'amount must be a non-zero number' });
  }
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  // An admin never gives credit to an admin account (not even their own): that comes from the super admin.
  if (isAdminRole(rows[0].role) && !isSuperAdmin(req.user.role)) {
    return res.status(403).json({ error: 'Only the super admin can give credit to an admin' });
  }
  // ... and never to an agent or user that belongs to another admin.
  if (!ownsRow(req.user, rows[0])) return res.status(404).json({ error: 'User not found' });
  if (!isSuperAdmin(req.user.role)) {
    // A normal admin does not create money: what he gives (or takes back) moves between HIS balance
    // (given by the super admin) and the account. When his credit runs out he waits for the super admin.
    try {
      for (const p of parts) {
        await transferBalance(p.amount > 0
          ? { actorId: req.user.id, sourceId: req.user.id, targetId: req.params.id, amount: p.amount, currency: p.currency, type: 'ADMIN_TO_USER', reference: rows[0].username }
          : { actorId: req.user.id, sourceId: req.params.id, targetId: req.user.id, amount: -p.amount, currency: p.currency, type: 'USER_TO_ADMIN', reference: rows[0].username });
      }
    } catch (err) {
      if (err.message === 'Insufficient balance') {
        return res.status(400).json({ error: parts.some((p) => p.amount > 0) ? 'Kredia jote ka mbaruar: prit që super admini të të shtojë kredi' : 'Ky llogari nuk ka aq kredi' });
      }
      throw err;
    }
  } else {
    // The super admin mints money: lek and euro in one statement.
    const lek = parts.find((p) => p.currency === 'ALL')?.amount ?? 0;
    const eur = parts.find((p) => p.currency === 'EUR')?.amount ?? 0;
    await pool.query('UPDATE users SET balance = balance + $1, balance_eur = balance_eur + $2 WHERE id = $3', [lek, eur, req.params.id]);
  }
  const { rows: updated } = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  await logAudit(req.user, 'BALANCE_CREDIT', req.params.id, { amounts: parts, username: rows[0].username });
  res.json({ user: toPublicUser(updated[0]) });
});

router.post('/users/:id/reset-password', async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'password must be at least 4 characters' });
  }
  const { rows } = await pool.query('SELECT id, role, admin_id FROM users WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  if (isAdminRole(rows[0].role) && rows[0].id !== req.user.id && !isSuperAdmin(req.user.role)) {
    return res.status(403).json({ error: 'Only the super admin can reset an admin password' });
  }
  // An admin resets his own password or the ones of his agents / users, nobody else's.
  if (rows[0].id !== req.user.id && !ownsRow(req.user, rows[0])) return res.status(404).json({ error: 'User not found' });
  const hash = await bcrypt.hash(password, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
  await logAudit(req.user, 'PASSWORD_RESET', req.params.id, {});
  res.json({ ok: true });
});

// --- BETS (global view + cancel) ---

router.get('/bets', async (req, res) => {
  // Capped for the same reason as /users above — most-recent-first so an
  // admin scanning bet history always sees the newest tickets, not an
  // arbitrary slice. A normal admin only gets the tickets of his own users.
  const limit = Math.min(Number(req.query.limit) || 500, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  // The super admin may look at the tickets of ONE admin's people: ?adminId=...
  const scope = isSuperAdmin(req.user.role) && req.query.adminId ? String(req.query.adminId) : scopeOf(req.user);
  const [{ rows: bets }, { rows: countRows }] = await Promise.all([
    pool.query(
      `SELECT * FROM bets WHERE ($3::text IS NULL OR user_id IN (SELECT id FROM users WHERE admin_id = $3))
        ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset, scope]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count FROM bets WHERE ($1::text IS NULL OR user_id IN (SELECT id FROM users WHERE admin_id = $1))`,
      [scope]
    ),
  ]);

  // Batch both lookups instead of running 2 queries per bet (N+1).
  const betIds = [...new Set(bets.map((b) => b.id))];
  const userIds = [...new Set(bets.map((b) => b.user_id))];

  const [selectionsResult, usersResult] = await Promise.all([
    betIds.length
      ? pool.query('SELECT * FROM bet_selections WHERE bet_id = ANY($1::text[])', [betIds])
      : { rows: [] },
    userIds.length
      ? pool.query('SELECT id, username, name, avatar FROM users WHERE id = ANY($1::text[])', [userIds])
      : { rows: [] },
  ]);

  const selectionsByBet = new Map();
  for (const sel of selectionsResult.rows) {
    if (!selectionsByBet.has(sel.bet_id)) selectionsByBet.set(sel.bet_id, []);
    selectionsByBet.get(sel.bet_id).push(sel);
  }
  const userById = new Map(usersResult.rows.map((u) => [u.id, u]));

  const withDetails = bets.map((b) => ({
    ...b,
    selections: selectionsByBet.get(b.id) || [],
    user: userById.get(b.user_id) || null,
  }));
  res.json({ bets: withDetails, total: countRows[0].count, limit, offset });
});

// --- SUPER ADMIN ---------------------------------------------------------------

// Create an admin account.
router.post('/admins', requireSuperAdmin, async (req, res) => {
  const { name, username, password, balance } = req.body || {};
  if (!name || !username || !password) return res.status(400).json({ error: 'name, username, and password are required' });
  if (String(password).length < 4) return res.status(400).json({ error: 'password must be at least 4 characters' });
  const { rows: existing } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing[0]) return res.status(409).json({ error: 'Username already taken' });
  const id = randomUUID();
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (id, name, username, password_hash, balance, role, avatar, created_at)
     VALUES ($1,$2,$3,$4,$5,'ADMIN','',$6)`,
    [id, name, username, hash, Math.max(0, Number(balance) || 0), Date.now()],
  );
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  await logAudit(req.user, 'ADMIN_CREATE', id, { username });
  res.status(201).json({ admin: toPublicUser(rows[0]) });
});

// Give credit to an admin (recorded in the ledger as SUPER_TO_ADMIN, like the admin -> agent credit).
router.post('/admins/:id/credit', requireSuperAdmin, async (req, res) => {
  const parts = amountParts(req.body);
  if (!parts || parts.some((p) => p.amount <= 0)) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1 AND role = 'ADMIN'`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Admin not found' });
  await transferBalances({
    actorId: req.user.id, sourceId: null, targetId: req.params.id,
    type: 'SUPER_TO_ADMIN', reference: rows[0].username,
    feeRate: feeRateFromEnv(process.env.OWNER_CREDIT_FEE_RATE),
  }, parts);
  await logAudit(req.user, 'ADMIN_CREDIT', req.params.id, { amounts: parts, username: rows[0].username });
  const admin = await readWallet(req.params.id);
  res.json({ balance: admin.balance, balanceEur: admin.balanceEur });
});

// Take credit back from an admin (it returns to the super admin's balance; ledger ADMIN_TO_SUPER).
router.post('/admins/:id/debit', requireSuperAdmin, async (req, res) => {
  const parts = amountParts(req.body);
  if (!parts || parts.some((p) => p.amount <= 0)) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1 AND role = 'ADMIN'`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Admin not found' });
  try {
    await transferBalances({
      actorId: req.user.id, sourceId: req.params.id, targetId: req.user.id,
      type: 'ADMIN_TO_SUPER', reference: rows[0].username,
    }, parts);
    await logAudit(req.user, 'ADMIN_DEBIT', req.params.id, { amounts: parts, username: rows[0].username });
    const admin = await readWallet(req.params.id);
    res.json({ balance: admin.balance, balanceEur: admin.balanceEur });
  } catch (err) {
    if (err.message === 'Insufficient balance') return res.status(400).json({ error: 'Admini ka më pak kredi se kjo shumë' });
    throw err;
  }
});

// The super admin's book of credit given to the admins: what each got (date, lek, euro), what came back, what is
// left on his balance, and the cash the super admin keeps for it (OWNER_CREDIT_FEE_RATE, default 10%).
router.get('/credit-ledger', requireSuperAdmin, async (req, res) => {
  const adminId = req.query.adminId ? String(req.query.adminId) : null;
  const [{ rows: admins }, { rows }] = await Promise.all([
    pool.query(`SELECT id, name, username, balance, balance_eur FROM users WHERE role = 'ADMIN'`),
    pool.query(
      `SELECT id, created_at, amount, currency, type, fee_rate,
              CASE WHEN type = 'SUPER_TO_ADMIN' THEN target_id ELSE source_id END AS admin_id
         FROM transactions WHERE type IN ('SUPER_TO_ADMIN', 'ADMIN_TO_SUPER')`
    ),
  ]);
  res.json(buildCreditLedger({
    admins, rows, adminId,
    feeRate: feeRateFromEnv(process.env.OWNER_CREDIT_FEE_RATE),
    limit: Math.min(Number(req.query.limit) || 300, 1000),
  }));
});

// Hand an agent (and every user he has) over to another admin, or to nobody (adminId null / missing).
router.patch('/agents/:id/admin', requireSuperAdmin, async (req, res) => {
  const adminId = req.body?.adminId ?? null;
  if (adminId !== null && typeof adminId !== 'string') return res.status(400).json({ error: 'adminId must be a string or null' });
  const { rows: agentRows } = await pool.query(`SELECT id, username FROM users WHERE id = $1 AND role = 'AGENT'`, [req.params.id]);
  if (!agentRows[0]) return res.status(404).json({ error: 'Agent not found' });
  if (adminId !== null) {
    const { rows: adminRows } = await pool.query(`SELECT id FROM users WHERE id = $1 AND role = 'ADMIN'`, [adminId]);
    if (!adminRows[0]) return res.status(400).json({ error: 'adminId is not an admin account' });
  }
  const { rowCount } = await pool.query('UPDATE users SET admin_id = $1 WHERE id = $2 OR agent_id = $2', [adminId, req.params.id]);
  await logAudit(req.user, 'AGENT_REASSIGN', req.params.id, { username: agentRows[0].username, adminId, rows: rowCount });
  res.json({ ok: true, adminId, rows: rowCount });
});

// Agent commission report (super admin: every admin's agents grouped by admin; admin: his own agents).
// ?month=YYYY-MM (default: this month) or ?month=all. Every agent row carries the commission each of his players made.
router.get('/reports/commission', async (req, res) => {
  const { rangeStart, rangeEnd, label } = periodRange(req.query.month, monthRange);
  const scope = scopeOf(req.user);
  const { rows: people } = await pool.query(
    `SELECT u.id, u.name, u.username, u.role, u.is_active, COALESCE(u.admin_id, ag.admin_id) AS admin_id, u.agent_id
     FROM users u LEFT JOIN users ag ON ag.id = u.agent_id
     WHERE u.role IN ('ADMIN','AGENT','USER') AND ($1::text IS NULL OR COALESCE(u.admin_id, ag.admin_id) = $1 OR u.id = $1) ORDER BY u.name`,
    [scope]
  );
  const metrics = await userMetrics(pool, { rangeStart, rangeEnd, adminId: scope });
  const report = buildCommissionReport({
    admins: people.filter((p) => p.role === 'ADMIN'),
    agents: people.filter((p) => p.role === 'AGENT'),
    users: people.filter((p) => p.role === 'USER'),
    metrics,
  });
  res.json({ month: label, ...report });
});

// SUPER ADMIN: the whole tree -- every admin with his agents, every agent with his users, the users an admin
// has directly, and the accounts nobody owns -- each with its balance in lek AND in euro.
router.get('/hierarchy', requireSuperAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, username, role, is_active AS "isActive", admin_id AS "adminId", agent_id AS "agentId",
            balance, balance_eur AS "balanceEur"
     FROM users WHERE role IN ('ADMIN','AGENT','USER') ORDER BY name`
  );
  const node = (r) => ({ id: r.id, name: r.name, username: r.username, isActive: r.isActive, balance: Number(r.balance), balanceEur: Number(r.balanceEur) });
  const agents = rows.filter((r) => r.role === 'AGENT');
  const users = rows.filter((r) => r.role === 'USER');
  const build = (adminId) => ({
    agents: agents.filter((a) => (a.adminId ?? null) === adminId).map((a) => ({ ...node(a), users: users.filter((u) => u.agentId === a.id).map(node) })),
    directUsers: users.filter((u) => !u.agentId && (u.adminId ?? null) === adminId).map(node),
  });
  res.json({
    admins: rows.filter((r) => r.role === 'ADMIN').map((a) => ({ ...node(a), ...build(a.id) })),
    unowned: build(null),
  });
});

// Hand EVERY agent and user that has no admin yet (the accounts that existed before admins owned anything)
// to one admin in a single step.
router.post('/accounts/assign-unowned', requireSuperAdmin, async (req, res) => {
  const adminId = req.body?.adminId;
  if (typeof adminId !== 'string') return res.status(400).json({ error: 'adminId is required' });
  const { rows } = await pool.query(`SELECT id, username FROM users WHERE id = $1 AND role = 'ADMIN'`, [adminId]);
  if (!rows[0]) return res.status(400).json({ error: 'adminId is not an admin account' });
  const { rowCount } = await pool.query(`UPDATE users SET admin_id = $1 WHERE role IN ('AGENT','USER') AND admin_id IS NULL`, [adminId]);
  await logAudit(req.user, 'ASSIGN_UNOWNED', adminId, { username: rows[0].username, rows: rowCount });
  res.json({ ok: true, rows: rowCount });
});

// Move an agent (with all his users) or a single user to another admin -- or to nobody (adminId null).
// A user can also be placed under one of the target admin's agents (agentId); otherwise he becomes a direct
// user of the admin. Past tickets stay with the user, so the reports follow him to the new admin.
router.patch('/accounts/:id/admin', requireSuperAdmin, async (req, res) => {
  const adminId = req.body?.adminId || null;
  const agentId = req.body?.agentId || null;
  if (adminId !== null && typeof adminId !== 'string') return res.status(400).json({ error: 'adminId must be a string or null' });
  if (agentId !== null && typeof agentId !== 'string') return res.status(400).json({ error: 'agentId must be a string or null' });
  const { rows: accRows } = await pool.query(`SELECT id, username, role, admin_id, agent_id FROM users WHERE id = $1 AND role IN ('AGENT','USER')`, [req.params.id]);
  const acc = accRows[0];
  if (!acc) return res.status(404).json({ error: 'Agent or user not found' });
  if (adminId !== null) {
    const { rows } = await pool.query(`SELECT id FROM users WHERE id = $1 AND role = 'ADMIN'`, [adminId]);
    if (!rows[0]) return res.status(400).json({ error: 'adminId is not an admin account' });
  }
  if (acc.role === 'AGENT') {
    if (agentId) return res.status(400).json({ error: 'An agent cannot be placed under another agent' });
    const { rowCount } = await pool.query('UPDATE users SET admin_id = $1 WHERE id = $2 OR agent_id = $2', [adminId, acc.id]);
    await logAudit(req.user, 'AGENT_REASSIGN', acc.id, { username: acc.username, from: acc.admin_id, to: adminId, rows: rowCount });
    return res.json({ ok: true, adminId, rows: rowCount });
  }
  if (agentId) {
    const { rows } = await pool.query(`SELECT admin_id FROM users WHERE id = $1 AND role = 'AGENT'`, [agentId]);
    if (!rows[0]) return res.status(400).json({ error: 'agentId is not an agent account' });
    if ((rows[0].admin_id ?? null) !== adminId) return res.status(400).json({ error: 'That agent does not belong to the chosen admin' });
  }
  await pool.query('UPDATE users SET admin_id = $1, agent_id = $2 WHERE id = $3', [adminId, agentId, acc.id]);
  await logAudit(req.user, 'USER_REASSIGN', acc.id, { username: acc.username, fromAdmin: acc.admin_id, fromAgent: acc.agent_id, toAdmin: adminId, toAgent: agentId });
  res.json({ ok: true, adminId, agentId, rows: 1 });
});

// Erase any ticket (open, live, settled, void ...). By default the money is put back as if the
// ticket had never been placed; ?adjust=0 erases the ticket and leaves every balance as it is.
router.delete('/bets/:id', requireSuperAdmin, async (req, res) => {
  const adjust = !['0', 'false'].includes(String(req.query.adjust || '').toLowerCase());
  const { rows } = await pool.query('SELECT * FROM bets WHERE id = $1', [req.params.id]);
  const bet = rows[0];
  if (!bet) return res.status(404).json({ error: 'Bet not found' });
  const delta = adjust ? betBalanceReversal(bet) : 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (delta !== 0) await client.query(`UPDATE users SET ${walletColumn(bet.currency)} = ${walletColumn(bet.currency)} + $1 WHERE id = $2`, [delta, bet.user_id]);
    await client.query('DELETE FROM bet_selections WHERE bet_id = $1', [bet.id]);
    await client.query('DELETE FROM bets WHERE id = $1', [bet.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await logAudit(req.user, 'BET_DELETE', bet.id, { userId: bet.user_id, stake: bet.stake, wasStatus: bet.status, adjust, balanceChange: delta });
  res.json({ ok: true, balanceChange: delta });
});

router.post('/bets/:id/cancel', async (req, res) => {
  if (!isSuperAdmin(req.user.role) && !(await getTicketDeletionAllowed())) {
    return res.status(403).json({ error: 'Fshirja e biletave është çaktivizuar nga super admini', code: 'TICKET_DELETE_DISABLED' });
  }
  const client = await pool.connect();
  let bet;
  let delta = 0;
  try {
    await client.query('BEGIN');
    // Lock the ticket: a settlement running at the same moment can no longer change its status between
    // the read and the refund.
    const { rows } = await client.query('SELECT * FROM bets WHERE id = $1 FOR UPDATE', [req.params.id]);
    bet = rows[0];
    if (!bet) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Bet not found' }); }
    // A normal admin only deletes tickets of his own users.
    const { rows: ownerRows } = await client.query('SELECT admin_id FROM users WHERE id = $1', [bet.user_id]);
    if (!ownsRow(req.user, ownerRows[0])) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Bet not found' }); }
    // Only an open ticket can be cancelled: once it is won, lost, refunded or already cancelled it is final.
    if (bet.status !== 'PENDING') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Vetëm biletat e hapura mund të anulohen', code: 'BET_NOT_PENDING' }); }
    // Put the money back as if the ticket had never been placed (PENDING / LOST: the stake; WON: the winnings
    // are taken back; VOID: it was refunded already, nothing to give twice).
    delta = betBalanceReversal(bet);
    if (delta !== 0) await client.query(`UPDATE users SET ${walletColumn(bet.currency)} = ${walletColumn(bet.currency)} + $1 WHERE id = $2`, [delta, bet.user_id]);
    // The ticket is NOT deleted: it stays in the lists, marked CANCELLED (its legs stay too).
    await client.query(`UPDATE bets SET status = 'CANCELLED' WHERE id = $1`, [bet.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await logAudit(req.user, 'BET_CANCEL', bet.id, { userId: bet.user_id, stake: bet.stake, wasStatus: bet.status, balanceChange: delta });
  res.json({ ok: true });
});

// Manually override a single bet leg's outcome. Needed for markets where
// automatic settlement can't safely infer the winner from just the final
// score (double chance, draw-no-bet, handicaps) — see settle-match comment.
router.patch('/bet-selections/:id', async (req, res) => {
  const { status } = req.body || {};
  if (!['WON', 'LOST', 'VOID'].includes(status)) {
    return res.status(400).json({ error: "status must be 'WON', 'LOST' or 'VOID'" });
  }
  const { rows } = await pool.query('SELECT * FROM bet_selections WHERE id = $1', [req.params.id]);
  const selection = rows[0];
  if (!selection) return res.status(404).json({ error: 'Selection not found' });

  // Same BEGIN/COMMIT + FOR UPDATE pattern as settleMatch/bets-cancel above:
  // without an explicit transaction here, recomputeBetStatus's FOR UPDATE
  // lock would be released the instant its own SELECT finished (autocommit
  // per-statement), giving zero protection against a concurrent
  // settleMatch() call racing on the same bet. Wrapping both statements in
  // one transaction also means a crash between them can't leave the leg
  // marked WON/LOST while the bet's overall status/balance never updates.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE bet_selections SET status = $1 WHERE id = $2', [status, selection.id]);
    await recomputeBetStatus(selection.bet_id, client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await logAudit(req.user, 'SELECTION_OVERRIDE', String(selection.id), { betId: selection.bet_id, status, matchId: selection.match_id });
  res.json({ ok: true });
});

// --- MATCH SETTLEMENT ---
// Given a final score, automatically settles the markets where the winner
// is unambiguous from the score alone: 1X2 (h2h), Over/Under (totals),
// and Both Teams To Score (btts). Double chance / draw-no-bet / handicap
// legs are intentionally left PENDING here because their exact outcome
// naming/semantics depend on the bookmaker feed and should be confirmed
// via the manual override endpoint above rather than guessed.
// force:true lets an admin re-settle a match the automatic scores poller
// already closed, e.g. to correct a wrong final score.
router.post('/matches/:id/settle', async (req, res) => {
  const { homeScore, awayScore } = req.body || {};
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) {
    return res.status(400).json({ error: 'homeScore and awayScore must be non-negative integers' });
  }
  const { rows } = await pool.query('SELECT * FROM matches_cache WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Match not found' });

  const result = await settleMatch(req.params.id, homeScore, awayScore, { force: true });
  await logAudit(req.user, 'MATCH_SETTLE', req.params.id, { homeScore, awayScore, ...result });
  res.json({ ok: true, ...result });
});

// Tickets the rules cannot decide (penalties, unknown markets...): finished matches (or ones that
// started long ago) with legs still PENDING, one row per match + market + selection.
router.get('/pending-legs', async (req, res) => {
  const cutoff = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
  const { rows } = await pool.query(
    `SELECT bs.match_id, bs.match_home, bs.match_away, bs.market_name, bs.selection_name,
            COUNT(*)::int AS legs, COUNT(DISTINCT bs.bet_id)::int AS bets, MAX(m.start_time) AS start_time, MAX(m.status) AS match_status,
            MAX(m.result_home) AS result_home, MAX(m.result_away) AS result_away
       FROM bet_selections bs JOIN matches_cache m ON m.id = bs.match_id
      WHERE bs.status = 'PENDING' AND (m.status = 'FINISHED' OR m.start_time < $1)
      GROUP BY bs.match_id, bs.match_home, bs.match_away, bs.market_name, bs.selection_name
      ORDER BY MAX(m.start_time) DESC, bs.market_name LIMIT 500`, [cutoff]);
  res.json({ legs: rows });
});

// Decide every PENDING leg of one match + market + selection by hand, then recompute the tickets
// they belong to (the same money path as automatic settlement; a ticket already decided is untouched).
const MANUAL_LEG_OUTCOMES = new Set(['WON', 'LOST', 'VOID', 'HALF_WON', 'HALF_LOST']);
router.post('/legs/settle', async (req, res) => {
  const { matchId, marketName, selectionName, outcome } = req.body || {};
  if (!matchId || !marketName || selectionName == null || !MANUAL_LEG_OUTCOMES.has(outcome)) {
    return res.status(400).json({ error: 'matchId, marketName, selectionName and outcome (WON, LOST, VOID, HALF_WON, HALF_LOST) are required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE bet_selections SET status = $1
        WHERE match_id = $2 AND market_name = $3 AND selection_name = $4 AND status = 'PENDING'
        RETURNING bet_id`, [outcome, matchId, marketName, String(selectionName)]);
    const betIds = [...new Set(rows.map((r) => r.bet_id))];
    for (const betId of betIds) await recomputeBetStatus(betId, client);
    await client.query('COMMIT');
    await logAudit(req.user, 'LEG_SETTLE_MANUAL', matchId, { marketName, selectionName, outcome, legs: rows.length, bets: betIds.length });
    res.json({ ok: true, legs: rows.length, bets: betIds.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[admin] manual leg settle failed:', err.message);
    res.status(500).json({ error: 'Could not settle these legs' });
  } finally {
    client.release();
  }
});

// Which markets exist, and which of them the system can settle by itself. One row per market
// name: those used by placed bets (with how many are still open) and those currently on the
// board, with the rule it falls under, whether it can be bet on in play, and a summary of how
// many have NO automatic settlement rule (those tickets end by manual settlement or by the
// 24h refund). Send this to whoever extends the rules.
router.get('/market-coverage', async (req, res) => {
  const { rows: legRows } = await pool.query(
    `SELECT market_id, market_name, COUNT(*)::int AS legs, COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
            (array_agg(DISTINCT selection_name))[1:4] AS samples
       FROM bet_selections GROUP BY market_id, market_name`
  );
  const { rows: boardRows } = await pool.query(
    `SELECT * FROM matches_cache WHERE status IN ('LIVE', 'UPCOMING') ORDER BY start_time LIMIT 300`
  );
  const board = new Map();
  for (const row of boardRows) {
    let match;
    try { match = mapEventToMatch(row); } catch { continue; }
    for (const mk of match.markets || []) {
      const cur = board.get(mk.name) || { name: mk.name, id: mk.id, matches: 0, live: 0, liveOpen: 0, samples: [] };
      cur.matches += 1;
      if (row.status === 'LIVE') {
        cur.live += 1;
        if ((mk.options || []).some((o) => !o.suspended && o.odds > 0)) cur.liveOpen += 1;
      }
      for (const o of mk.options || []) { if (cur.samples.length < 4 && o && o.name != null && !cur.samples.includes(String(o.name))) cur.samples.push(String(o.name)); }
      board.set(mk.name, cur);
    }
  }
  const report = buildCoverageReport([
    ...legRows.map((r) => ({ name: r.market_name, id: r.market_id, legs: r.legs, pending: r.pending, samples: r.samples || [] })),
    ...board.values(),
  ]);
  res.json({ boardMatchesScanned: boardRows.length, requireSettlementRule: settlementRuleRequired(), ...report, text: formatCoverageText(report) });
});

// Every raw provider field seen so far (REST list, REST live detail, live socket) with a few
// sample values. Open it while real matches with goals are live to find out whether the feed
// carries scorer names, team logos, etc. (see feedKeySampler.js). Resets on server restart.
// The last unhandled route errors with their real cause (code, message, top stack lines).
// Unknown provider action codes (VC) with the counters that moved alongside them: helps label new ones.
router.get('/unmapped-vc', (req, res) => {
  res.json({ now: new Date().toISOString(), codes: getUnmappedVcReport() });
});

// Why are the corner markets (or the "Kornet" tab) missing on a match? For every match whose team name
// contains ?q= (default: the live ones) it shows the live corner counter (value, age, fresh?), whether the
// provider sent any corner market at all, and for each corner option the exact reason it is open / closed.
// Example: /api/admin/corner-diagnose?q=Agniputhra
router.get('/corner-diagnose', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const { rows } = await pool.query(
    `SELECT * FROM matches_cache
      WHERE ($1 = '' AND (status = 'LIVE' OR live_status IS NOT NULL) AND result_home IS NULL)
         OR ($1 <> '' AND (lower(home_team) LIKE '%' || $1 || '%' OR lower(away_team) LIKE '%' || $1 || '%' OR id = $1))
      ORDER BY start_time DESC LIMIT 6`,
    [q]
  );
  const now = Date.now();
  const out = [];
  for (const r of rows) {
    const { rows: st } = await pool.query('SELECT corners_home, corners_away, updated_at FROM live_statistics WHERE match_id = $1', [r.id]);
    const lc = await readLiveCorners(pool, r.id, now);
    if (lc) r.live_corners = lc;
    const cc = await readLiveCards(pool, r.id, now);
    if (cc) r.live_cards = cc;
    const m = mapEventToMatch(r);
    // corner AND card markets: both are opened in play from their live counters
    const cornerMarkets = m.markets.filter((x) => /korn|corner|karton|\bcards?\b/i.test(x.name));
    out.push({
      id: r.id, match: r.home_team + ' v ' + r.away_team, status: m.status, liveStatus: r.live_status, minute: r.live_minute,
      liveCorners: st[0] ? {
        home: st[0].corners_home, away: st[0].corners_away,
        ageSeconds: st[0].updated_at == null ? null : Math.round((now - Number(st[0].updated_at)) / 1000),
        fresh: Boolean(lc && lc.fresh),
      } : 'no live_statistics row (the live detail feed is not delivering counters for this match)',
      categories: [...new Set(m.markets.map((x) => x.category || 'other'))],
      providerSentCornerMarkets: cornerMarkets.length,
      cornerMarkets: cornerMarkets.map((x) => ({
        name: x.name, category: x.category || 'other',
        options: x.options.map((o) => ({ name: o.name, odds: o.odds, closed: getBetBlockReason(r, { id: x.id, name: x.name }, { id: o.id, name: o.name }) || false })),
      })),
    });
  }
  res.json({ now: new Date(now).toISOString(), matches: out });
});

router.get('/recent-errors', (req, res) => {
  res.json({ now: new Date().toISOString(), errors: getRecentErrors() });
});

// VC (live action) codes seen from the feed with counts: unlabelled ones, rarest first (a penalty is rare).
router.get('/vc-codes', (req, res) => {
  res.json({ now: new Date().toISOString(), ...getVcSamples() });
});

// Asks the provider's own site what it calls each live action code (to find the penalty code).
router.get('/provider-labels', async (req, res) => {
  try { res.json(await findProviderLabels()); } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});

router.get('/feed-keys', (req, res) => {
  res.json({ fields: getFeedKeySamples() });
});


// "Why is this ticket still open?" For every match that still has OPEN bets (optionally filtered by
// team name or match id with ?q=), what we know about its end and the exact reason it is not settled:
// status, stored score and clock, when it kicked off, how many bets wait on it, and the verdict of
// the same rule the live loop uses. Example: /api/admin/settle-diagnose?q=Augsburg
router.get('/settle-diagnose', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const { rows } = await pool.query(
    `SELECT m.id, m.home_team, m.away_team, m.start_time, m.status, m.live_status, m.live_home_score, m.live_away_score,
            m.live_minute, m.live_minute_updated_at, m.fetched_at, m.result_home, m.result_away, m.settled_at,
            COUNT(bs.id)::int AS open_legs
       FROM matches_cache m
       JOIN bet_selections bs ON bs.match_id = m.id AND bs.status = 'PENDING'
      WHERE ($1 = '' OR lower(m.home_team) LIKE '%' || $1 || '%' OR lower(m.away_team) LIKE '%' || $1 || '%' OR m.id = $1)
      GROUP BY m.id
      ORDER BY m.start_time DESC
      LIMIT 40`,
    [q]
  );
  const now = Date.now();
  const iso = (v) => (v ? new Date(Number(v)).toISOString() : null);
  res.json({
    now: new Date(now).toISOString(),
    matches: rows.map((r) => ({
      id: r.id, match: r.home_team + ' v ' + r.away_team, kickoff: r.start_time, status: r.status, liveStatus: r.live_status,
      storedScore: r.live_home_score == null ? null : r.live_home_score + '-' + r.live_away_score,
      storedClock: r.live_minute, clockUpdatedAt: iso(r.live_minute_updated_at), lastFeedUpdate: iso(r.fetched_at),
      finalResult: r.result_home == null ? null : r.result_home + '-' + r.result_away, settledAt: iso(r.settled_at),
      openLegs: r.open_legs, missedLiveCycles: missedLiveCycles.get(r.id) || 0,
      why: explainSettleBlock(r, now),
    })),
  });
});

// Verifies every open (PENDING) ticket against matches that are already
// finished and closes the ones whose result is now known.
router.post('/bets/settle-stuck', async (req, res) => {
  const recovered = await recoverFinishedWithoutResult();
  const settled = await settleStuckBets();
  const closed = await voidOverdueLegs();
  const result = { ...recovered, ...settled, overdueVoided: closed.voidedLegs, overdueBetsRecomputed: closed.recomputedBets };
  await logAudit(req.user, 'BETS_SETTLE_STUCK', null, result);
  res.json({ ok: true, ...result });
});

// --- AUDIT LOG ---
// Risk Management: current house exposure per outcome, and top-level KPIs
// (turnover/open liability) for the Admin Dashboard.
router.get('/risk/exposure', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT bs.match_id, bs.match_home, bs.match_away, bs.market_id, bs.market_name,
           bs.selection_id, bs.selection_name,
           COUNT(DISTINCT b.id)::int AS ticket_count,
           COALESCE(SUM(b.potential_return), 0) AS total_exposure
    FROM bet_selections bs
    JOIN bets b ON b.id = bs.bet_id
    WHERE b.status = 'PENDING'
    GROUP BY bs.match_id, bs.match_home, bs.match_away, bs.market_id, bs.market_name, bs.selection_id, bs.selection_name
    ORDER BY total_exposure DESC
    LIMIT 100
  `);
  res.json({ exposure: rows });
});

// What a normal admin sees of the business: profit, loss and how many tickets are open / won / lost,
// for HIS agents' users only.
//   profit = stakes of lost tickets          loss = what the won tickets pay out beyond the stake
// The super admin gets the full picture (turnover, open liability, users) on top, over the whole system.
router.get('/dashboard/kpi', async (req, res) => {
  const { rows: agg } = await pool.query(
    `SELECT ${TICKET_SUMS}
       FROM bets b WHERE b.status <> 'CANCELLED' AND ($1::text IS NULL OR b.user_id IN (SELECT id FROM users WHERE admin_id = $1))`,
    [scopeOf(req.user)]
  );
  const g = withNet(agg[0]);
  const basic = {
    profit: Number(g.losses), loss: Number(g.wins), net: g.netResult,
    profitEur: Number(g.losses_eur), lossEur: Number(g.wins_eur), netEur: g.netResultEur,
    ticketsOpen: g.pending_tickets, ticketsWon: g.won_tickets, ticketsLost: g.lost_tickets,
  };
  if (!isSuperAdmin(req.user.role)) return res.json(basic);

  const { rows: money } = await pool.query(
    `SELECT currency,
            COALESCE(SUM(stake) FILTER (WHERE status = 'PENDING'),0) AS pending_stake,
            COALESCE(SUM(potential_return) FILTER (WHERE status = 'PENDING'),0) AS liability,
            COUNT(*) FILTER (WHERE status = 'PENDING')::int AS open_bets,
            COALESCE(SUM(stake) FILTER (WHERE status IN ('WON','LOST')),0) AS settled_stake,
            COALESCE(SUM(potential_return) FILTER (WHERE status = 'WON'),0) AS paid_out
     FROM bets WHERE status <> 'CANCELLED' GROUP BY currency`
  );
  const by = (c) => money.find((r) => r.currency === c) || {};
  const num = (v) => Number(v || 0);
  const { rows: users } = await pool.query(`SELECT COUNT(*)::int AS c FROM users`);
  res.json({
    ...basic,
    turnover: num(by('ALL').pending_stake) + num(by('ALL').settled_stake),
    turnoverEur: num(by('EUR').pending_stake) + num(by('EUR').settled_stake),
    openLiability: num(by('ALL').liability), openLiabilityEur: num(by('EUR').liability),
    openBets: num(by('ALL').open_bets) + num(by('EUR').open_bets),
    ggr: num(by('ALL').settled_stake) - num(by('ALL').paid_out), // stakes in - payouts out
    ggrEur: num(by('EUR').settled_stake) - num(by('EUR').paid_out),
    totalUsers: users[0].c,
  });
});

// Switch: may normal admins delete tickets? Everybody reads it (the panel hides the button), only the super
// admin changes it.
router.get('/settings', async (req, res) => {
  res.json({ ticketDeletionAllowed: await getTicketDeletionAllowed(), casinoAccess: await getCasinoAccess() });
});
// Super admin: who may open the casino (off / only the super admin / everybody) + what was played.
router.put('/settings/casino-access', requireSuperAdmin, async (req, res) => {
  const { mode } = req.body || {};
  if (!CASINO_MODES.includes(mode)) return res.status(400).json({ error: 'mode must be off, super or all' });
  await setCasinoAccess(mode);
  await logAudit(req.user, 'SETTING_CASINO_ACCESS', null, { mode });
  res.json({ casinoAccess: mode });
});
router.get('/casino/report', requireSuperAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT game, currency, COUNT(*)::int AS rounds, COALESCE(SUM(stake),0) AS staked, COALESCE(SUM(payout),0) AS paid
     FROM casino_rounds GROUP BY game, currency ORDER BY game, currency`
  );
  res.json({ rows: rows.map((r) => ({ game: r.game, currency: r.currency, rounds: r.rounds, staked: Number(r.staked), paid: Number(r.paid), houseResult: Number(r.staked) - Number(r.paid) })) });
});
router.put('/settings/ticket-deletion', requireSuperAdmin, async (req, res) => {
  const { allowed } = req.body || {};
  if (typeof allowed !== 'boolean') return res.status(400).json({ error: 'allowed must be true or false' });
  await setTicketDeletionAllowed(allowed);
  await logAudit(req.user, 'SETTING_TICKET_DELETION', null, { allowed });
  res.json({ ticketDeletionAllowed: allowed });
});

// The log of actions is the super admin's alone: a normal admin never sees it (403).
router.get('/audit-log', requireSuperAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1', [limit]);
  res.json({ entries: rows });
});

export default router;
