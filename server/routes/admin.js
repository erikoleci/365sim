import { findProviderLabels } from '../providerLabels.js';
import { buildDayAudit } from '../dayAudit.js';
import { correctBatch } from '../resultCorrection.js';
import { getVcSamples } from '../vcSampler.js';
import express from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import pool from '../db.js';
import { requireAuth } from './auth.js';
import { readLiveCorners, readLiveCards } from '../matchSettlement.js';
import { settleMatch, recomputeBetStatus, creditWithLedger, refundAdminForWin, settleStuckBets, recoverFinishedWithoutResult, explainSettleBlock, wouldSettleNow } from '../matchSettlement.js';
import { missedLiveCycles } from '../london365/liveState.js';
import { logAudit } from '../auditLog.js';
import { getAllProfiles, saveProfile, resetProfile, PROFILE_KEYS, slotKey } from '../casinoProfiles.js';
import { SLOT_GAMES } from '../slots/games.js';
import { computeMarketCoverage } from '../marketCoverageScan.js';
import { settlementRuleRequired, getBetBlockReason } from '../marketRules.js';
import { getFeedKeySamples, getEventFrames, getSocketEvents } from '../feedKeySampler.js';
import { getRecentErrors } from '../recentErrors.js';
import { getUnmappedVcReport } from '../vcDeltaSampler.js';
import { mapEventToMatch } from '../oddsUtils.js';

import { transferBalance, transferBalances, amountParts, readWallet, walletColumn, normalizeAccountCurrency, disallowedPart, accountCurrencyError } from '../ledger.js';
import { getTicketDeletionAllowed, setTicketDeletionAllowed } from '../appSettings.js';
import { getCasinoAccess, setCasinoAccess, CASINO_MODES, getDisabledGames, setDisabledGames, CASINO_GAME_KEYS } from '../casinoAccess.js';
import { isAdminRole, isSuperAdmin, ROLE_ADMIN } from '../roles.js';
import { scopeOf, ownsRow } from '../adminScope.js';
import { importLondon365, getLondon365Status, getLondon365CountryDebug } from '../london365.js';
import { monthRange } from './agent.js';
import { userMetrics, buildCommissionReport, reportRange } from '../commission.js';
import { buildCreditLedger, feeRateFromEnv } from '../creditLedger.js';
import { buildAgentLedger, buildUserCredit } from '../agentCreditLedger.js';
import { planManualResolve } from '../manualResolve.js';
import { describeOpenLeg, refineOpenLeg } from '../legWhy.js';
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
  '/corner-diagnose', '/recent-errors', '/vc-codes', '/provider-labels', '/feed-keys', '/feed-frames', '/settle-diagnose',
  '/bets/settle-stuck', '/risk', '/live-audit', '/market-audit', '/day-audit',
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
    balance: row.balance, balanceEur: row.balance_eur ?? 0, accountCurrency: row.account_currency || 'BOTH', role: row.role, avatar: row.avatar,
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
  const { name, username, password, balance, balanceEur } = req.body || {};
  // The account is opened in lek only, euro only or both; the opening balance must be in that currency.
  const accountCurrency = normalizeAccountCurrency((req.body || {}).currency);
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'name, username, and password are required' });
  }
  const lek = Number(balance) || 0;
  const eur = Number(balanceEur) || 0;
  if (!Number.isFinite(lek) || !Number.isFinite(eur) || lek < 0 || eur < 0) {
    return res.status(400).json({ error: 'initial balance cannot be negative' });
  }
  if (disallowedPart(accountCurrency, [{ currency: 'ALL', amount: lek }, { currency: 'EUR', amount: eur }])) {
    return res.status(400).json({ error: accountCurrencyError(accountCurrency) });
  }
  const { rows: existingRows } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existingRows[0]) return res.status(409).json({ error: 'Username already taken' });

  const id = randomUUID();
  const hash = await bcrypt.hash(password, 10);
  const isSuper = isSuperAdmin(req.user.role);
  // The new user belongs to the admin who creates him (the super admin's own users stay unowned).
  await pool.query(
    `INSERT INTO users (id, name, username, password_hash, balance, balance_eur, role, avatar, admin_id, created_at, account_currency)
     VALUES ($1,$2,$3,$4,$5,$6,'USER',$7,$8,$9,$10)`,
    [id, name, username, hash, isSuper ? lek : 0, isSuper ? eur : 0, '', isSuper ? null : req.user.id, Date.now(), accountCurrency]
  );
  const parts = [];
  if (lek > 0) parts.push({ currency: 'ALL', amount: lek });
  if (eur > 0) parts.push({ currency: 'EUR', amount: eur });
  if (!isSuper && parts.length) {
    try {
      // lek and euro move together in one transaction
      await transferBalances({ actorId: req.user.id, sourceId: req.user.id, targetId: id, type: 'ADMIN_TO_USER', reference: username }, parts);
    } catch (err) {
      await pool.query('DELETE FROM users WHERE id = $1', [id]);
      if (err.message === 'Insufficient balance') return res.status(400).json({ error: 'Kredia jote ka mbaruar: prit që super admini të të shtojë kredi' });
      throw err;
    }
  }

  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  await logAudit(req.user, 'USER_CREATE', id, { username, balance: lek, balanceEur: eur, currency: accountCurrency });
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

  // Tickets the agents placed with THEIR OWN account: they are inside the totals above (the totals count every account of the
  // admin) but in no agent's row (those count only his players), so the rows did not add up to the totals. Display only.
  const { rows: ownRows } = await pool.query(
    `SELECT COUNT(DISTINCT u.id)::int AS total_users,
            ${TICKET_SUMS}
     FROM users u
     JOIN bets b ON b.user_id = u.id AND b.status <> 'CANCELLED' AND b.created_at >= $1 AND b.created_at < $2
     WHERE u.role = 'AGENT' AND ($3::text IS NULL OR u.admin_id = $3)`,
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
    // The agents' own tickets (see the query above).
    agentsOwn: withNet(ownRows[0]),
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
  // ?from=YYYY-MM-DD&to=YYYY-MM-DD (days included) | ?month=YYYY-MM | ?month=all ; ?adminId= limits it to one admin.
  const { rangeStart, rangeEnd, label } = reportRange(req.query, monthRange);
  const onlyAdmin = req.query.adminId ? String(req.query.adminId) : null;
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.username, a.balance, a.balance_eur AS "balanceEur",
            (SELECT COUNT(*)::int FROM users x WHERE x.admin_id = a.id AND x.role = 'AGENT') AS agents,
            (SELECT COUNT(*)::int FROM users x WHERE x.admin_id = a.id AND x.role = 'USER') AS users,
            ${TICKET_SUMS}
     FROM users a
     LEFT JOIN users u ON u.admin_id = a.id AND u.role = 'USER'
     LEFT JOIN bets b ON b.user_id = u.id AND b.status <> 'CANCELLED' AND b.created_at >= $1 AND b.created_at < $2
     WHERE a.role = 'ADMIN' AND ($3::text IS NULL OR a.id = $3)
     GROUP BY a.id
     ORDER BY turnover DESC`,
    [rangeStart, rangeEnd, onlyAdmin]
  );
  const { rows: unownedRows } = await pool.query(
    `SELECT COUNT(DISTINCT u.id)::int AS users,
            ${TICKET_SUMS}
     FROM users u
     LEFT JOIN bets b ON b.user_id = u.id AND b.status <> 'CANCELLED' AND b.created_at >= $1 AND b.created_at < $2
     WHERE u.role = 'USER' AND u.admin_id IS NULL AND $3::text IS NULL`,
    [rangeStart, rangeEnd, onlyAdmin]
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
    `SELECT u.id, u.name, u.username, u.balance, u.balance_eur AS "balanceEur", u.account_currency AS "accountCurrency", u.is_active,
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
  if (disallowedPart(rows[0].account_currency, parts)) return res.status(400).json({ error: accountCurrencyError(rows[0].account_currency) });
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
      ? pool.query('SELECT bs.*, m.start_time AS match_start_time FROM bet_selections bs LEFT JOIN matches_cache m ON m.id = bs.match_id WHERE bs.bet_id = ANY($1::text[])', [betIds])
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
  const isTest = req.body?.isTest === true;
  const recordOnly = req.body?.recordOnly === true; // already handed over before: only written in the book, balance unchanged
  const parts = amountParts(req.body);
  if (!parts || parts.some((p) => p.amount <= 0)) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  let at;
  if (req.body?.at !== undefined && req.body?.at !== null) {
    const n = Number(req.body.at);
    if (!Number.isFinite(n) || n < Date.UTC(2020, 0, 1) || n > Date.now() + 86400000) return res.status(400).json({ error: 'bad date' });
    at = Math.round(n);
  }
  const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1 AND role = 'ADMIN'`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Admin not found' });
  // A test / free credit keeps 0% for the super admin and is never counted in the book.
  const feeRate = isTest ? 0 : feeRateFromEnv(process.env.OWNER_CREDIT_FEE_RATE);
  if (recordOnly) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const p of parts) {
        const col = p.currency === 'EUR' ? 'balance_eur' : 'balance';
        const { rows: w } = await client.query(`SELECT ${col} AS bal FROM users WHERE id = $1 FOR UPDATE`, [req.params.id]);
        const bal = Number(w[0].bal);
        await client.query(
          `INSERT INTO transactions (actor_id, source_id, target_id, amount, type, reference, source_balance_before, source_balance_after,
                                     target_balance_before, target_balance_after, created_at, currency, fee_rate, is_test)
           VALUES ($1, NULL, $2, $3, 'SUPER_TO_ADMIN', $4, NULL, NULL, $5, $5, $6, $7, $8, $9)`,
          [req.user.id, req.params.id, p.amount, `${rows[0].username} (regjistruar, pa ndryshuar balancën)`, bal, at ?? Date.now(), p.currency, feeRate, isTest],
        );
      }
      await client.query('COMMIT');
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  } else {
    await transferBalances({
      actorId: req.user.id, sourceId: null, targetId: req.params.id,
      type: 'SUPER_TO_ADMIN', reference: rows[0].username, feeRate, isTest, at,
    }, parts);
  }
  await logAudit(req.user, 'ADMIN_CREDIT', req.params.id, { amounts: parts, username: rows[0].username, isTest, recordOnly, at: at ?? null });
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
  const [{ rows: admins }, { rows }, { rows: settlements }] = await Promise.all([
    pool.query(`SELECT id, name, username, balance, balance_eur FROM users WHERE role = 'ADMIN'`),
    pool.query(
      `SELECT id, created_at, amount, currency, type, fee_rate, is_test,
              CASE WHEN type = 'SUPER_TO_ADMIN' THEN target_id ELSE source_id END AS admin_id
         FROM transactions WHERE type IN ('SUPER_TO_ADMIN', 'ADMIN_TO_SUPER')`
    ),
    pool.query(`SELECT id, admin_id, currency, amount, created_at, note FROM credit_settlements`),
  ]);
  res.json(buildCreditLedger({
    admins, rows, settlements, adminId,
    feeRate: feeRateFromEnv(process.env.OWNER_CREDIT_FEE_RATE),
    limit: Math.min(Number(req.query.limit) || 300, 1000),
    range: { from: req.query.from === undefined || req.query.from === '' ? null : Number(req.query.from), to: req.query.to === undefined || req.query.to === '' ? null : Number(req.query.to) },
  }));
});

// Change an old credit: mark it test / real and/or fix its date (ms since epoch). Test = 0% and never counted.
router.patch('/credit-ledger/:id', requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
  const { isTest, at } = req.body || {};
  const { rows } = await pool.query(`SELECT id, fee_rate, is_test, created_at FROM transactions WHERE id = $1 AND type = 'SUPER_TO_ADMIN'`, [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Credit not found' });
  const nextTest = typeof isTest === 'boolean' ? isTest : rows[0].is_test === true;
  let nextAt = Number(rows[0].created_at);
  if (at !== undefined) {
    const n = Number(at);
    if (!Number.isFinite(n) || n < Date.UTC(2020, 0, 1) || n > Date.now() + 86400000) return res.status(400).json({ error: 'bad date' });
    nextAt = Math.round(n);
  }
  const frozen = Number(rows[0].fee_rate);
  const nextRate = nextTest ? 0 : frozen > 0 ? frozen : feeRateFromEnv(process.env.OWNER_CREDIT_FEE_RATE);
  await pool.query('UPDATE transactions SET is_test = $1, fee_rate = $2, created_at = $3 WHERE id = $4', [nextTest, nextRate, nextAt, id]);
  await logAudit(req.user, 'CREDIT_EDIT', String(id), { isTest: nextTest, at: nextAt });
  res.json({ ok: true, isTest: nextTest, at: nextAt, feeRate: nextRate });
});

// The admin handed cash back for his credit ("shlyer"): written down so what is still owed is computed.
router.post('/admins/:id/settle', requireSuperAdmin, async (req, res) => {
  const parts = amountParts(req.body);
  if (!parts || parts.some((p) => p.amount <= 0)) return res.status(400).json({ error: 'amount must be a positive number' });
  const { rows } = await pool.query(`SELECT id, username FROM users WHERE id = $1 AND role = 'ADMIN'`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Admin not found' });
  let at = Date.now();
  if (req.body?.at !== undefined) {
    const n = Number(req.body.at);
    if (!Number.isFinite(n) || n < Date.UTC(2020, 0, 1) || n > Date.now() + 86400000) return res.status(400).json({ error: 'bad date' });
    at = Math.round(n);
  }
  const note = req.body?.note ? String(req.body.note).slice(0, 200) : null;
  for (const p of parts) {
    await pool.query(
      'INSERT INTO credit_settlements (admin_id, currency, amount, created_at, actor_id, note) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.params.id, p.currency, p.amount, at, req.user.id, note],
    );
  }
  await logAudit(req.user, 'CREDIT_SETTLE', req.params.id, { amounts: parts, username: rows[0].username });
  res.status(201).json({ ok: true });
});

router.delete('/credit-settlements/:id', requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
  const { rowCount } = await pool.query('DELETE FROM credit_settlements WHERE id = $1', [id]);
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  await logAudit(req.user, 'CREDIT_SETTLE_DELETE', String(id), {});
  res.json({ ok: true });
});

// The admin's book of the credit he gave to his agents (date, lek, euro, what came back, what each agent has left) and of the
// winnings paid to players out of his credit. An admin sees his own agents; the super admin sees every admin's.
router.get('/agent-credit', async (req, res) => {
  const scope = scopeOf(req.user);
  const agentId = req.query.agentId ? String(req.query.agentId) : null;
  const { rows: agents } = await pool.query(
    `SELECT id, name, username, balance, balance_eur FROM users WHERE role = 'AGENT' AND ($1::text IS NULL OR admin_id = $1)`, [scope]);
  const ids = agents.map((a) => a.id);
  // Credit the admin moved to / from players with the generic credit button (not through an agent's own wallet).
  const { rows: userRows } = await pool.query(
    `SELECT t.id, t.created_at, t.amount, t.currency, t.type, CASE WHEN t.type = 'USER_TO_ADMIN' THEN t.source_id ELSE t.target_id END AS user_id
       FROM transactions t
      WHERE t.type IN ('ADMIN_TO_USER', 'USER_TO_ADMIN')
        AND ($1::text IS NULL OR (CASE WHEN t.type = 'USER_TO_ADMIN' THEN t.target_id ELSE t.source_id END) = $1)`, [scope]);
  const userIds = [...new Set(userRows.map((r) => r.user_id))];
  const { rows: players } = userIds.length
    ? await pool.query(`SELECT id, name, username, balance, balance_eur, agent_id FROM users WHERE role = 'USER' AND id = ANY($1::text[])`, [userIds])
    : { rows: [] };
  const [{ rows }, { rows: payRows }, { rows: me }] = await Promise.all([
    pool.query(
      `SELECT id, created_at, amount, currency, type, CASE WHEN type IN ('AGENT_TO_OWNER', 'USER_TO_ADMIN') THEN source_id ELSE target_id END AS agent_id
         FROM transactions WHERE type IN ('OWNER_TO_AGENT', 'OWNER_CREATE_AGENT_FUND', 'ADMIN_TO_USER', 'AGENT_TO_OWNER', 'USER_TO_ADMIN')
          AND (CASE WHEN type IN ('AGENT_TO_OWNER', 'USER_TO_ADMIN') THEN source_id ELSE target_id END) = ANY($1::text[])`, [ids]),
    pool.query(
      `SELECT t.id, t.created_at, t.amount, t.currency, t.type, t.reference, b.ticket_no, u.username
         FROM transactions t LEFT JOIN bets b ON b.id::text = t.reference LEFT JOIN users u ON u.id = b.user_id
        WHERE t.type IN ('ADMIN_PAYS_WIN', 'ADMIN_WIN_REVERSAL') AND ($1::text IS NULL OR t.target_id = $1)`, [scope]),
    pool.query('SELECT balance, balance_eur FROM users WHERE id = $1', [req.user.id]),
  ]);
  res.json({
    ...buildAgentLedger({
      agents, rows, payRows, agentId,
      limit: Math.min(Number(req.query.limit) || 300, 1000),
      range: { from: req.query.from === undefined || req.query.from === '' ? null : Number(req.query.from), to: req.query.to === undefined || req.query.to === '' ? null : Number(req.query.to) },
    }),
    directUsers: buildUserCredit({
      users: players, rows: userRows, limit: Math.min(Number(req.query.limit) || 300, 1000),
      range: { from: req.query.from === undefined || req.query.from === '' ? null : Number(req.query.from), to: req.query.to === undefined || req.query.to === '' ? null : Number(req.query.to) },
    }),
    myBalance: me[0] ? { ALL: Number(me[0].balance) || 0, EUR: Number(me[0].balance_eur) || 0 } : { ALL: 0, EUR: 0 },
    adminPaysWins: process.env.ADMIN_PAYS_WINS === '1',
  });
});

// An admin's own page: the credit the super admin gave him, with the date and time. Nothing about the cash side.
router.get('/my-credits', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, created_at, amount, currency, type, is_test FROM transactions
      WHERE type = 'SUPER_TO_ADMIN' AND target_id = $1 ORDER BY created_at DESC, id DESC LIMIT 500`,
    [req.user.id],
  );
  const total = { ALL: 0, EUR: 0 };
  const credits = rows.map((r) => {
    const currency = r.currency === 'EUR' ? 'EUR' : 'ALL';
    total[currency] += Number(r.amount) || 0;
    return { id: r.id, at: Number(r.created_at), currency, amount: Math.round((Number(r.amount) || 0) * 100) / 100, isTest: r.is_test === true };
  });
  res.json({ credits, total: { ALL: Math.round(total.ALL * 100) / 100, EUR: Math.round(total.EUR * 100) / 100 } });
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
  const { rangeStart, rangeEnd, label, from = null, to = null } = reportRange(req.query, monthRange);
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
  res.json({ month: label, from, to, ...report });
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
    if (adjust && bet.status === 'WON') await refundAdminForWin(client, bet);
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

// Change the currency an agent / player account works in: ALL (lek only), EUR (euro only) or BOTH.
// A normal admin only changes his own people. A wallet that still holds money cannot be switched off.
router.patch('/users/:id/currency', async (req, res) => {
  const currency = String((req.body || {}).currency || '');
  if (!['ALL', 'EUR', 'BOTH'].includes(currency)) return res.status(400).json({ error: "currency must be 'ALL', 'EUR' or 'BOTH'" });
  const { rows } = await pool.query('SELECT id, role, admin_id, balance, balance_eur, account_currency FROM users WHERE id = $1', [req.params.id]);
  const acc = rows[0];
  if (!acc || !ownsRow(req.user, acc) || !['USER', 'AGENT'].includes(acc.role)) return res.status(404).json({ error: 'Account not found' });
  if (currency === 'ALL' && Number(acc.balance_eur) !== 0) return res.status(400).json({ error: 'Llogaria ka ende euro: zbrita euro-t para se ta kalosh vetëm në lek' });
  if (currency === 'EUR' && Number(acc.balance) !== 0) return res.status(400).json({ error: 'Llogaria ka ende lek: zbrita lek-ët para se ta kalosh vetëm në euro' });
  await pool.query('UPDATE users SET account_currency = $1 WHERE id = $2', [currency, acc.id]);
  await logAudit(req.user, 'ACCOUNT_CURRENCY', acc.id, { from: acc.account_currency, to: currency });
  res.json({ ok: true, accountCurrency: currency });
});

// Cancel a ticket (refund + remove). Rules:
//  - a normal admin must write a reason (min 3 chars) and can only cancel an OPEN ticket none of whose matches has a
//    result yet (no leg won / lost / half / void): once something is decided only the super admin can cancel it;
//  - the super admin can cancel any ticket (a reason is optional for him);
//  - every cancellation is written to ticket_cancellations and the super admin gets it as an unread notification.
router.post('/bets/:id/cancel', async (req, res) => {
  const superAdmin = isSuperAdmin(req.user.role);
  if (!superAdmin && !(await getTicketDeletionAllowed())) {
    return res.status(403).json({ error: 'Fshirja e biletave është çaktivizuar nga super admini', code: 'TICKET_DELETE_DISABLED' });
  }
  const reason = String(req.body?.reason ?? '').trim().slice(0, 300);
  if (!superAdmin && reason.length < 3) return res.status(400).json({ error: 'Shkruaj arsyen e anulimit', code: 'REASON_REQUIRED' });
  const client = await pool.connect();
  let bet;
  let delta = 0;
  let decidedLegs = 0;
  let ownerAdminId = null;
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
    ownerAdminId = ownerRows[0]?.admin_id ?? null;
    if (bet.status === 'CANCELLED') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Bileta është anuluar tashmë', code: 'BET_NOT_PENDING' }); }
    const { rows: legs } = await client.query('SELECT status FROM bet_selections WHERE bet_id = $1', [bet.id]);
    decidedLegs = legs.filter((l) => l.status !== 'PENDING').length;
    if (!superAdmin && (bet.status !== 'PENDING' || decidedLegs > 0)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Bileta ka tashmë rezultat (të paktën një ndeshje fituar/humbur): vetëm super admini mund ta anulojë', code: 'ONLY_SUPER_ADMIN' });
    }
    // Put the money back as if the ticket had never been placed (PENDING / LOST: the stake; WON: the winnings
    // are taken back; VOID: it was refunded already, nothing to give twice).
    delta = betBalanceReversal(bet);
    if (delta !== 0) await client.query(`UPDATE users SET ${walletColumn(bet.currency)} = ${walletColumn(bet.currency)} + $1 WHERE id = $2`, [delta, bet.user_id]);
    if (bet.status === 'WON') await refundAdminForWin(client, bet);
    const now = Date.now();
    await client.query(
      `INSERT INTO ticket_cancellations (bet_id, ticket_no, user_id, owner_admin_id, actor_id, actor_username, actor_role, stake, currency, status_before, decided_legs, balance_change, reason, created_at, seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [bet.id, bet.ticket_no ?? null, bet.user_id, ownerAdminId, req.user.id, req.user.username ?? null, req.user.role, bet.stake, bet.currency || 'ALL', bet.status, decidedLegs, delta, reason || null, now, superAdmin ? now : null]
    );
    // Cancelled = refunded AND removed from the lists right away (legs included); the audit log keeps the trace.
    await client.query('DELETE FROM bet_selections WHERE bet_id = $1', [bet.id]);
    await client.query('DELETE FROM bets WHERE id = $1', [bet.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await logAudit(req.user, 'BET_CANCEL', bet.id, { userId: bet.user_id, stake: bet.stake, wasStatus: bet.status, decidedLegs, balanceChange: delta, reason: reason || null });
  res.json({ ok: true });
});

// Super admin: the cancellations done by admins (newest first) and how many he has not read yet.
router.get('/cancellations', requireSuperAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const { rows } = await pool.query(
    `SELECT c.id, c.bet_id AS "betId", c.ticket_no AS "ticketNo", c.user_id AS "userId", u.username AS "playerUsername", c.owner_admin_id AS "ownerAdminId",
            c.actor_id AS "actorId", c.actor_username AS "actorUsername", c.actor_role AS "actorRole", c.stake, c.currency, c.status_before AS "statusBefore",
            c.decided_legs AS "decidedLegs", c.balance_change AS "balanceChange", c.reason, c.created_at AS "createdAt", c.seen_at AS "seenAt"
       FROM ticket_cancellations c LEFT JOIN users u ON u.id = c.user_id
      ORDER BY c.created_at DESC LIMIT $1`, [limit]);
  const { rows: un } = await pool.query('SELECT COUNT(*)::int AS n FROM ticket_cancellations WHERE seen_at IS NULL');
  res.json({ unread: un[0].n, items: rows.map((r) => ({ ...r, ticketNo: r.ticketNo == null ? null : Number(r.ticketNo), stake: Number(r.stake), balanceChange: Number(r.balanceChange), createdAt: Number(r.createdAt), seenAt: r.seenAt == null ? null : Number(r.seenAt) })) });
});
router.get('/cancellations/unread', requireSuperAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM ticket_cancellations WHERE seen_at IS NULL');
  res.json({ unread: rows[0].n });
});
router.post('/cancellations/seen', requireSuperAdmin, async (req, res) => {
  await pool.query('UPDATE ticket_cancellations SET seen_at = $1 WHERE seen_at IS NULL', [Date.now()]);
  res.json({ ok: true });
});

// Why is this ticket still open? For every open leg: the state of its match and what is missing, in words.
router.get('/bets/:id/why', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM bets WHERE id = $1', [req.params.id]);
  const bet = rows[0];
  if (!bet) return res.status(404).json({ error: 'Bet not found' });
  const { rows: ownerRows } = await pool.query('SELECT admin_id FROM users WHERE id = $1', [bet.user_id]);
  if (!ownsRow(req.user, ownerRows[0])) return res.status(404).json({ error: 'Bet not found' });
  const { rows: legs } = await pool.query(`SELECT * FROM bet_selections WHERE bet_id = $1 AND status = 'PENDING' ORDER BY id`, [bet.id]);
  const ids = [...new Set(legs.map((l) => l.match_id))];
  const { rows: matches } = ids.length ? await pool.query('SELECT * FROM matches_cache WHERE id = ANY($1::text[])', [ids]) : { rows: [] };
  const byId = new Map(matches.map((m) => [m.id, m]));
  const now = Date.now();
  res.json({
    status: bet.status,
    legs: legs.map((l) => {
      const match = byId.get(l.match_id);
      return refineOpenLeg(describeOpenLeg({ leg: l, match, now, blockReason: match && match.status === 'FINISHED' && match.result_home == null ? explainSettleBlock(match, now) : '' }), { leg: l, match, decide: wouldSettleNow });
    }),
  });
});

// Close a ticket by hand as WON or LOST. The super admin may close any ticket; a normal admin only the tickets of his own people. A win is paid exactly once by the normal
// settlement code; a won ticket made lost gives the winnings back (written in the ledger). Not for cancelled / refunded tickets.
router.post('/bets/:id/resolve', async (req, res) => {
  const outcome = String((req.body && req.body.outcome) || '').toUpperCase();
  if (outcome !== 'WON' && outcome !== 'LOST') return res.status(400).json({ error: "outcome must be 'WON' or 'LOST'" });
  const client = await pool.connect();
  let bet;
  let plan;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM bets WHERE id = $1 FOR UPDATE', [req.params.id]);
    bet = rows[0];
    if (!bet) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Bet not found' }); }
    const { rows: ownerRows } = await client.query('SELECT admin_id FROM users WHERE id = $1', [bet.user_id]);
    if (!ownsRow(req.user, ownerRows[0])) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Bet not found' }); }
    const { rows: legs } = await client.query('SELECT id, status FROM bet_selections WHERE bet_id = $1 ORDER BY id', [bet.id]);
    plan = planManualResolve(bet, legs, outcome);
    if (plan.error) { await client.query('ROLLBACK'); return res.status(400).json({ error: plan.error.message, code: plan.error.code }); }
    if (plan.noop) { await client.query('ROLLBACK'); return res.json({ ok: true, unchanged: true, status: bet.status }); }
    for (const u of plan.legUpdates) await client.query('UPDATE bet_selections SET status = $1 WHERE id = $2', [u.status, u.id]);
    if (plan.takeBack > 0) {
      await creditWithLedger(client, bet.user_id, -plan.takeBack, bet.status === 'VOID' ? 'BET_VOID_REFUND_REVERSAL' : 'BET_WIN_REVERSAL', bet.id, bet.currency);
      if (bet.status === 'WON') await refundAdminForWin(client, bet); // the admin gets back what this win cost him
    }
    await recomputeBetStatus(bet.id, client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[admin] manual ticket resolve failed:', err.message);
    return res.status(500).json({ error: 'Could not close this ticket' });
  } finally {
    client.release();
  }
  await logAudit(req.user, 'BET_RESOLVE_MANUAL', bet.id, { userId: bet.user_id, from: bet.status, to: outcome, stake: bet.stake, potentialReturn: bet.potential_return, tookBack: plan.takeBack, currency: bet.currency });
  res.json({ ok: true, status: outcome });
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
  // A normal admin may only touch the legs of his own people's tickets (same rule as /bets/:id/why).
  const { rows: ownerRows } = await pool.query('SELECT u.admin_id FROM bets b JOIN users u ON u.id = b.user_id WHERE b.id = $1', [selection.bet_id]);
  if (!ownsRow(req.user, ownerRows[0])) return res.status(404).json({ error: 'Selection not found' });

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
// Correct the final score of FINISHED matches closed on a wrong one and re-decide their tickets, all matches planned together.
// Body { items: [{ matchId, homeScore, awayScore, overrides? }], apply }: without apply:true it is a DRY RUN (nothing is written).
router.post('/matches/correct-results', async (req, res) => {
  const { items, apply } = req.body || {};
  const okItem = (i) => i && typeof i.matchId === 'string' && Number.isInteger(i.homeScore) && Number.isInteger(i.awayScore) && i.homeScore >= 0 && i.awayScore >= 0;
  if (!Array.isArray(items) || !items.length || !items.every(okItem)) return res.status(400).json({ error: 'items: [{ matchId, homeScore, awayScore }] required' });
  const out = await correctBatch(items, { apply: apply === true });
  if (out.error) return res.status(400).json(out);
  if (out.applied) await logAudit(req.user, 'MATCH_RESULT_CORRECT', items.map((i) => i.matchId).join(','), { items, tickets: out.tickets.length });
  res.json(out);
});

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
// The scan reads every LIVE and UPCOMING row (each carries a 9-30 KB raw_json), which with the whole catalogue
// (LONDON365_ALL_MATCHES) takes minutes and ended in "Request failed (504)" behind the tunnel. Now: keyset paging
// (no OFFSET), a time budget (soonest matches first, so the sample stays representative), the answer cached for
// 5 minutes, and one scan at a time. ?fresh=1 forces a new scan.
const COVERAGE_CACHE_MS = 5 * 60000;
let coverageCache = null;
let coverageInflight = null;

router.get('/market-coverage', async (req, res) => {
  if (req.query.fresh !== '1' && coverageCache && Date.now() - coverageCache.at < COVERAGE_CACHE_MS) return res.json(coverageCache.body);
  if (!coverageInflight) {
    coverageInflight = computeMarketCoverage(pool)
      .then((body) => { coverageCache = { at: Date.now(), body }; return body; })
      .finally(() => { coverageInflight = null; });
  }
  res.json(await coverageInflight);
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

// The full raw frame each time something other than the clock changed (goal, card, corner, penalty, a name ...), newest
// first, with the fields that changed and their previous values. Open it during a live match to see how a penalty or a
// scorer's name really arrives.
router.get('/feed-frames', (req, res) => {
  res.json({ frames: getEventFrames(), socketEvents: getSocketEvents() });
});


// "Why is this ticket still open?" For every match that still has OPEN bets (optionally filtered by
// team name or match id with ?q=), what we know about its end and the exact reason it is not settled:
// status, stored score and clock, when it kicked off, how many bets wait on it, and the verdict of
// the same rule the live loop uses. Example: /api/admin/settle-diagnose?q=Augsburg
// Live tickets booked in the last ?hours= (default 24) with the match state at booking (minute, score) and the
// model's win probability / edge per leg, worst first. Use it to see which live prices were off-market and to tune
// LIVE_LEG_MAX_EDGE / LIVE_TICKET_MAX_EDGE. Example: /api/admin/live-audit?hours=6&min_edge=1.1
// READ-ONLY: every match behind the tickets of the last ?hours= (default 30): result vs live score vs timeline goals/corners vs Flashscore.
router.get('/day-audit', async (req, res) => {
  const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 30));
  res.json(await buildDayAudit(pool, { hours }));
});

router.get('/live-audit', async (req, res) => {
  const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24));
  const minEdge = Number(req.query.min_edge) || 0;
  const { rows } = await pool.query(
    `SELECT b.id AS bet_id, b.created_at, b.stake, b.total_odds, b.status AS bet_status, bs.match_home, bs.match_away,
            bs.market_name, bs.selection_name, bs.odds, bs.status AS leg_status, bs.placed_state
       FROM bets b JOIN bet_selections bs ON bs.bet_id = b.id
      WHERE b.is_live = true AND b.created_at > $1 AND bs.placed_state IS NOT NULL
      ORDER BY b.created_at DESC LIMIT 2000`,
    [Date.now() - hours * 3600 * 1000]
  );
  const byBet = new Map();
  for (const r of rows) {
    if (!byBet.has(r.bet_id)) byBet.set(r.bet_id, { betId: r.bet_id, createdAt: Number(r.created_at), stake: r.stake, totalOdds: r.total_odds, status: r.bet_status, ticketEdge: 1, legs: [] });
    const t = byBet.get(r.bet_id);
    const e = Number(r.placed_state && r.placed_state.edge);
    if (Number.isFinite(e)) t.ticketEdge *= e;
    t.legs.push({ match: r.match_home + ' - ' + r.match_away, market: r.market_name, selection: r.selection_name, odds: r.odds, status: r.leg_status, placed: r.placed_state });
  }
  const tickets = [...byBet.values()].filter((t) => t.ticketEdge >= minEdge).sort((a, b) => b.ticketEdge - a.ticketEdge);
  res.json({ hours, count: tickets.length, tickets });
});

// Who bet on a market and what the match looked like at that moment: every ticket leg whose market name contains ?q=
// (default "shenon pritesi ne p1/p2") in the last ?hours= (default 48), with the user, the stake, the odds and the goals
// that had ALREADY been scored when the ticket was booked (and any goal in the 60 s after it). A live ticket on a market
// the goals had already decided, or one that landed just before a goal, is a player beating the feed.
// Example: /api/admin/market-audit?q=shenon%20pritesi&hours=72
router.get('/market-audit', async (req, res) => {
  const q = String(req.query.q || 'shenon pritesi ne p1/p2').trim().toLowerCase();
  const hours = Math.min(720, Math.max(1, Number(req.query.hours) || 48));
  const { rows } = await pool.query(
    `SELECT b.id AS bet_id, b.created_at, b.stake, b.total_odds, b.status AS bet_status, b.is_live, b.user_id, u.username,
            bs.match_id, bs.match_home, bs.match_away, bs.market_name, bs.selection_name, bs.odds, bs.status AS leg_status, bs.placed_state
       FROM bet_selections bs JOIN bets b ON b.id = bs.bet_id LEFT JOIN users u ON u.id = b.user_id
      WHERE lower(bs.market_name) LIKE $1 AND b.created_at > $2
      ORDER BY b.created_at DESC LIMIT 500`,
    ['%' + q + '%', Date.now() - hours * 3600 * 1000]
  );
  const out = [];
  for (const r of rows) {
    const { rows: ev } = await pool.query(
      "SELECT minute, type, team, created_at FROM match_events WHERE match_id = $1 AND type = 'GOAL' ORDER BY created_at", [r.match_id]);
    const at = Number(r.created_at);
    const before = ev.filter((e) => Number(e.created_at) <= at).map((e) => ({ minute: e.minute, team: e.team }));
    const soon = ev.filter((e) => Number(e.created_at) > at && Number(e.created_at) - at <= 60000).map((e) => ({ minute: e.minute, team: e.team, afterSec: Math.round((Number(e.created_at) - at) / 1000) }));
    out.push({
      betId: r.bet_id, user: r.username || r.user_id, bookedAt: at, live: r.is_live, stake: r.stake, odds: r.odds, betStatus: r.bet_status, legStatus: r.leg_status,
      match: r.match_home + ' - ' + r.match_away, market: r.market_name, selection: r.selection_name, bookedWith: r.placed_state || null,
      goalsBeforeBooking: before, goalWithin60sAfter: soon, suspicious: Boolean(r.is_live && (before.length > 0 || soon.length > 0)),
    });
  }
  const perUser = {};
  for (const t of out) { const u = perUser[t.user] || (perUser[t.user] = { tickets: 0, liveWithGoals: 0, stake: 0 }); u.tickets++; u.stake += Number(t.stake) || 0; if (t.suspicious) u.liveWithGoals++; }
  res.json({ q, hours, count: out.length, perUser, tickets: out });
});

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
  const result = { ...recovered, ...settled };
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
  res.json({ ticketDeletionAllowed: await getTicketDeletionAllowed(), casinoAccess: await getCasinoAccess(), casinoDisabledGames: await getDisabledGames(), casinoGameKeys: CASINO_GAME_KEYS });
});
// Super admin: who may open the casino (off / only the super admin / everybody) + what was played.
router.put('/settings/casino-access', requireSuperAdmin, async (req, res) => {
  const { mode } = req.body || {};
  if (!CASINO_MODES.includes(mode)) return res.status(400).json({ error: 'mode must be off, super or all' });
  await setCasinoAccess(mode);
  await logAudit(req.user, 'SETTING_CASINO_ACCESS', null, { mode });
  res.json({ casinoAccess: mode });
});
// Super admin: close single games to players (the super admin can still open them).
router.put('/settings/casino-games', requireSuperAdmin, async (req, res) => {
  const { disabled } = req.body || {};
  if (!Array.isArray(disabled) || disabled.some((g) => !CASINO_GAME_KEYS.includes(g))) return res.status(400).json({ error: 'disabled must be a list of game keys' });
  const saved = await setDisabledGames(disabled);
  await logAudit(req.user, 'SETTING_CASINO_GAMES', null, { disabled: saved });
  res.json({ casinoDisabledGames: saved });
});
router.get('/casino/report', requireSuperAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT game, currency, COUNT(*)::int AS rounds, COALESCE(SUM(stake),0) AS staked, COALESCE(SUM(payout),0) AS paid
     FROM casino_rounds GROUP BY game, currency ORDER BY game, currency`
  );
  res.json({ rows: rows.map((r) => ({ game: r.game, currency: r.currency, rounds: r.rounds, staked: Number(r.staked), paid: Number(r.paid), houseResult: Number(r.staked) - Number(r.paid) })) });
});
// Math profile of every casino game (hit frequency, RTP, bet limits, max win): read, change, reset. Every change is audited.
// What really happened in the played rounds (casino_rounds), per game key: hit frequency, net-win frequency, RTP, house edge, payout buckets.
async function measuredByKey() {
  const { rows } = await pool.query(
    `SELECT game, COUNT(*)::int AS rounds, COUNT(*) FILTER (WHERE payout > 0)::int AS hits, COUNT(*) FILTER (WHERE payout > stake)::int AS net,
            COUNT(*) FILTER (WHERE payout >= stake * 5)::int AS x5, COUNT(*) FILTER (WHERE payout >= stake * 20)::int AS x20, COUNT(*) FILTER (WHERE payout >= stake * 100)::int AS x100,
            COALESCE(SUM(stake),0) AS staked, COALESCE(SUM(payout),0) AS paid
     FROM casino_rounds WHERE status = 'FINISHED' GROUP BY game`
  );
  const slotIds = new Set(SLOT_GAMES.map((g) => g.id));
  const out = {};
  for (const r of rows) {
    const key = r.game.startsWith('slots:') ? 'slots' : r.game === 'sugar-cascade' ? 'tumble' : slotIds.has(r.game) ? slotKey(r.game) : r.game;
    const o = out[key] || (out[key] = { rounds: 0, hits: 0, net: 0, x5: 0, x20: 0, x100: 0, staked: 0, paid: 0 });
    o.rounds += r.rounds; o.hits += r.hits; o.net += r.net; o.x5 += r.x5; o.x20 += r.x20; o.x100 += r.x100; o.staked += Number(r.staked); o.paid += Number(r.paid);
  }
  return out;
}
const withMeasured = async (profiles) => { const m = await measuredByKey(); return profiles.map((p) => ({ ...p, measured: m[p.key] || null })); };
router.get('/casino/profiles', requireSuperAdmin, async (req, res) => {
  res.json({ profiles: await withMeasured(await getAllProfiles()) });
});
router.put('/casino/profiles/:key', requireSuperAdmin, async (req, res) => {
  if (!PROFILE_KEYS.includes(req.params.key)) return res.status(404).json({ error: 'Unknown game' });
  try {
    const { before, after } = await saveProfile(req.params.key, req.body);
    await logAudit(req.user, 'CASINO_PROFILE', req.params.key, { before, after });
    res.json({ profiles: await withMeasured(await getAllProfiles()) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/casino/profiles/:key/reset', requireSuperAdmin, async (req, res) => {
  if (!PROFILE_KEYS.includes(req.params.key)) return res.status(404).json({ error: 'Unknown game' });
  const { before, after } = await resetProfile(req.params.key);
  await logAudit(req.user, 'CASINO_PROFILE_RESET', req.params.key, { before, after });
  res.json({ profiles: await withMeasured(await getAllProfiles()) });
});
router.get('/casino/profiles-audit', requireSuperAdmin, async (req, res) => {
  const { rows } = await pool.query(`SELECT actor_username, action, target, details, created_at FROM audit_log WHERE action IN ('CASINO_PROFILE','CASINO_PROFILE_RESET') ORDER BY created_at DESC LIMIT 40`);
  res.json({ entries: rows });
});
// Clears the test rounds of the super admin himself (the demo statistics); players' rounds are never touched.
router.post('/casino/reset-test-stats', requireSuperAdmin, async (req, res) => {
  const r = await pool.query('DELETE FROM casino_rounds WHERE user_id = $1', [req.user.id]);
  await logAudit(req.user, 'CASINO_RESET_TEST_STATS', null, { removed: r.rowCount });
  res.json({ removed: r.rowCount });
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
