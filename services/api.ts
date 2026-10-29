import { User, Match, Bet, BetSelectionItem } from '../types';
import { tr } from '../i18n';

const TOKEN_KEY = 'betsim_token';

// Set at build time (Vercel/Cloudflare Pages env var). Empty string means
// "same origin as the frontend" — that's still correct for local dev and
// for a same-host deploy; only a split deploy (frontend on Vercel, API on
// Koyeb/Render) needs this pointed at the API's own domain.
const API_BASE = (import.meta as any).env?.VITE_API_URL || '';

export function getWsUrl(): string {
  if (API_BASE) {
    // e.g. https://foo.koyeb.app -> wss://foo.koyeb.app/ws
    return API_BASE.replace(/^http/, 'ws') + '/ws';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// Carries the parsed error body (code, changes, etc.) alongside the message,
// so callers like handlePlaceBet can branch on e.g. code === 'ODDS_CHANGED'
// instead of only having a human-readable string to show as-is.
export class ApiError extends Error {
  code?: string;
  body?: any;
  constructor(message: string, code?: string, body?: any) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.body = body;
  }
}

async function request<T>(path: string, options: RequestInit = {}, opts: { retry?: boolean } = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // Free-tier hosting (Render et al.) spins the backend down after
  // inactivity and can take 50+ seconds to wake back up on the next
  // request. During that window fetch() never gets a real HTTP response
  // at all — it just throws (connection refused/reset) — so this retries
  // ONLY on that network-level failure, automatically riding out a cold
  // start instead of surfacing a scary "can't connect" error on the very
  // first request after the app has been idle. A real HTTP error response
  // (e.g. 401 for a wrong password) means the server IS up and answered,
  // so that path below is untouched and still fails immediately.
  //
  // Scoped to GET (safe/idempotent) plus explicitly-opted-in calls
  // (login/register: a retried login is harmless, and register on a
  // network failure never reached the server to begin with) — NOT
  // mutating calls like placing a bet or crediting a balance by default,
  // since fetch() throwing after the request already reached the server
  // but before the response came back, though rare, could otherwise mean
  // retrying resubmits something that already happened.
  const method = (options.method || 'GET').toUpperCase();
  const retryable = opts.retry ?? method === 'GET';
  const maxAttempts = retryable ? 9 : 1;
  const retryDelayMs = 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(`${API_BASE}/api${path}`, { ...options, headers });
    } catch (networkErr) {
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
      throw new Error(tr("S'arritëm të lidhemi me serverin. Kontrollo internetin dhe provo përsëri."));
    }
    const contentType = resp.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await resp.json() : null;
    if (!resp.ok) {
      const message = body?.error ? tr(String(body.error)) : `Request failed (${resp.status})`;
      throw new ApiError(message, body?.code, body);
    }
    return body as T;
  }
  // Unreachable in practice (the loop above always returns or throws),
  // kept only so TypeScript sees every path returning/throwing.
  throw new Error(tr("S'arritëm të lidhemi me serverin. Kontrollo internetin dhe provo përsëri."));
}

// --- Auth ---

export async function login(username: string, password: string): Promise<User> {
  const data = await request<{ token: string; user: User }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }, { retry: true });
  setToken(data.token);
  return data.user;
}

// Self-service registration is intentionally not offered -- accounts are
// created by an Admin or Agent (see AgentUsersPanel), never by the person
// signing themselves up. See server/routes/auth.js for the same note on
// the backend side.

export async function fetchCurrentUser(): Promise<User | null> {
  if (!getToken()) return null;
  try {
    const data = await request<{ user: User }>('/auth/me');
    return data.user;
  } catch {
    setToken(null); // token expired/invalid
    return null;
  }
}

export function logout() {
  setToken(null);
}

// --- Matches ---

export interface LeagueMeta {
  id: string | null;
  name: string;
  countryId: string | null;
  countryName: string | null;
}

export async function fetchMatches(league?: string): Promise<{ matches: Match[]; leagueNames?: Record<string, string>; leagueMeta?: Record<string, LeagueMeta> }> {
  const qs = league && league !== 'All Top Football' ? `?league=${encodeURIComponent(league)}` : '';
  return request(`/matches${qs}`);
}

// The list endpoint above only returns the 1X2/"h2h" market per match (see
// server/routes/matches.js LIST_RAW_JSON_H2H_ONLY) to keep the list payload
// small/fast. This fetches the ONE match being opened with every market —
// GET /matches/:id was already doing a full unfiltered SELECT * server-side
// and is unchanged; this is just the first frontend caller of it.
export async function fetchMatchById(id: string): Promise<Match> {
  const { match } = await request<{ match: Match }>(`/matches/${encodeURIComponent(id)}`);
  return match;
}

// Only the matches that changed since the last look (see server/matchChanges.js). since < 0 = just learn the position.
export async function fetchMatchChanges(since: number, boot: string): Promise<{ boot: string; seq: number; full: boolean; matches: Match[] }> {
  return request(`/matches/changes?since=${since}&boot=${encodeURIComponent(boot)}`);
}

export interface LiveStatistics {
  minute: number | null;
  // Server-side reference timestamp (epoch ms) for `minute` — see
  // migrations/0002_live_minute_updated_at.sql. Optional: only present
  // when GET /matches/:id/live-detail had a matches_cache row to pull it
  // from.
  minuteUpdatedAt?: number;
  // The provider's raw clock ("75:39") that minuteUpdatedAt belongs to -- only present together.
  clock?: string;
  home_score?: number | null;
  away_score?: number | null;
  possession_home: number | null;
  possession_away: number | null;
  shots_home: number | null;
  shots_away: number | null;
  shots_on_target_home: number | null;
  shots_on_target_away: number | null;
  corners_home: number | null;
  corners_away: number | null;
  cards_home: number | null;
  cards_away: number | null;
  xg_home: number | null;
  xg_away: number | null;
}

export interface MatchEvent {
  minute: number | null;
  type: string;
  team: string | null;
  player: string | null;
  detail: string | null;
  created_at: number;
  /** 1 | 2 = the half it happened in (from the match status when logged); null = unknown */
  half?: number | null;
}

export async function fetchMatchLiveDetail(matchId: string): Promise<{ statistics: LiveStatistics | null; events: MatchEvent[] }> {
  return request(`/matches/${matchId}/live-detail`);
}

// --- Bets ---

export async function placeBet(stake: number, type: 'SINGLE' | 'ACCUMULATOR', selections: BetSelectionItem[], currency: 'ALL' | 'EUR' = 'ALL') {
  return request<{ bet: { id: string; totalOdds: number; potentialReturn: number; stake: number; currency?: 'ALL' | 'EUR' }; balance: number; balanceEur: number }>(
    '/bets',
    {
      method: 'POST',
      body: JSON.stringify({
        stake,
        currency,
        type,
        selections: selections.map((s) => ({
          matchId: s.matchId,
          matchHome: s.matchHome,
          matchAway: s.matchAway,
          marketId: s.marketId,
          marketName: s.marketName,
          selectionId: s.selectionId,
          selectionName: s.selectionName,
          odds: s.odds,
          boosted: s.boosted,
        })),
      }),
    }
  );
}

export async function fetchMyBets(): Promise<Bet[]> {
  const data = await request<{ bets: any[] }>('/bets');
  return data.bets.map(mapServerBet);
}

export async function cancelMyBet(betId: string): Promise<{ balance: number; balanceEur: number }> {
  return request<{ ok: true; balance: number; balanceEur: number }>(`/bets/${betId}/cancel`, { method: 'POST' });
}

function mapServerBet(b: any): Bet {
  return {
    id: b.id,
    userId: b.user_id,
    type: b.type,
    stake: b.stake,
    totalOdds: b.total_odds,
    potentialReturn: b.potential_return,
    status: b.status,
    currency: b.currency === 'EUR' ? 'EUR' : 'ALL',
    timestamp: Number(b.created_at),
    cancellable: b.cancellable === true,
    selections: (b.selections || []).map((s: any) => ({
      matchId: s.match_id,
      matchHome: s.match_home,
      matchAway: s.match_away,
      marketId: s.market_id,
      marketName: s.market_name,
      selectionId: s.selection_id,
      selectionName: s.selection_name,
      odds: s.odds,
      status: s.status,
    })),
    matchDetails: b.selections?.[0] ? { homeTeam: b.selections[0].match_home, awayTeam: b.selections[0].match_away } : undefined,
  };
}

// --- Admin ---

export async function adminFetchUsers(): Promise<User[]> {
  const data = await request<{ users: User[] }>('/admin/users');
  return data.users;
}

export async function adminCreateUser(u: { name: string; username: string; password: string; balance: number }) {
  return request<{ user: User }>('/admin/users', { method: 'POST', body: JSON.stringify(u) });
}

export async function adminDeleteUser(userId: string) {
  return request<{ ok: true }>(`/admin/users/${userId}`, { method: 'DELETE' });
}

// Wipes the user AND their bets/transactions/casino history/sub-users
// instead of refusing. Irreversible -- only call after the user confirms,
// typically as the follow-up to adminDeleteUser failing with USER_HAS_HISTORY.
export async function adminForceDeleteUser(userId: string) {
  return request<{ ok: true }>(`/admin/users/${userId}/force`, { method: 'DELETE' });
}

/** Body of a credit/debit call: lek in `amount`, euro in `amountEur` (zero parts are left out). */
const moneyBody = (amount: number, amountEur = 0) => JSON.stringify({
  ...(amount ? { amount } : {}),
  ...(amountEur ? { amountEur } : {}),
});

export async function adminAddCredit(userId: string, amount: number, amountEur = 0) {
  return request<{ user: User }>(`/admin/users/${userId}/credit`, {
    method: 'POST',
    body: moneyBody(amount, amountEur),
  });
}

export async function adminResetPassword(userId: string, password: string) {
  return request<{ ok: true }>(`/admin/users/${userId}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function adminFetchAllBets(): Promise<any[]> {
  const data = await request<{ bets: any[] }>('/admin/bets');
  return data.bets.map((b) => ({ ...mapServerBet(b), user: b.user }));
}

export async function adminFetchAuditLog(): Promise<any[]> {
  const data = await request<{ entries: any[] }>('/admin/audit-log');
  return data.entries;
}

export interface AdminDashboardKpi {
  // everybody: profit (stakes of lost tickets), loss (what won tickets pay beyond the stake), net, ticket counts
  profit: number;
  loss: number;
  net: number;
  ticketsOpen: number;
  ticketsWon: number;
  ticketsLost: number;
  // super admin only
  turnover?: number;
  openLiability?: number;
  openBets?: number;
  ggr?: number;
  totalUsers?: number;
}
export async function adminFetchDashboardKpi() {
  return request<AdminDashboardKpi>('/admin/dashboard/kpi');
}

export interface AdminExposureRow {
  match_id: string; match_home: string; match_away: string;
  market_id: string; market_name: string; selection_id: string; selection_name: string;
  ticket_count: number; total_exposure: number;
}
export async function adminFetchSettings() {
  return request<{ ticketDeletionAllowed: boolean }>('/admin/settings');
}
/** Super admin: allow or forbid normal admins to delete tickets. */
export async function adminSetTicketDeletion(allowed: boolean) {
  return request<{ ticketDeletionAllowed: boolean }>('/admin/settings/ticket-deletion', { method: 'PUT', body: JSON.stringify({ allowed }) });
}

export async function adminFetchExposure() {
  const data = await request<{ exposure: AdminExposureRow[] }>('/admin/risk/exposure');
  return data.exposure;
}

export async function adminCancelBet(betId: string) {
  return request<{ ok: true }>(`/admin/bets/${betId}/cancel`, { method: 'POST' });
}

export async function adminCreateAdmin(a: { name: string; username: string; password: string; balance: number }) {
  return request<{ admin: User }>('/admin/admins', { method: 'POST', body: JSON.stringify(a) });
}

export async function adminDebitAdmin(adminId: string, amount: number, amountEur = 0) {
  return request<{ balance: number; balanceEur: number }>(`/admin/admins/${adminId}/debit`, { method: 'POST', body: moneyBody(amount, amountEur) });
}

export async function adminCreditAdmin(adminId: string, amount: number, amountEur = 0) {
  return request<{ balance: number; balanceEur: number }>(`/admin/admins/${adminId}/credit`, { method: 'POST', body: moneyBody(amount, amountEur) });
}

/** Super admin: erase any ticket (open, live or settled). adjust=false leaves all balances untouched. */
export async function adminDeleteBet(betId: string, adjust = true) {
  return request<{ ok: true; balanceChange: number }>(`/admin/bets/${betId}?adjust=${adjust ? '1' : '0'}`, { method: 'DELETE' });
}

export interface AdminPendingLeg {
  match_id: string; match_home: string; match_away: string; market_name: string; selection_name: string;
  legs: number; bets: number; start_time: string; match_status: string; result_home: number | null; result_away: number | null;
}
export async function adminFetchPendingLegs() {
  return request<{ legs: AdminPendingLeg[] }>('/admin/pending-legs');
}
export async function adminSettleLegs(body: { matchId: string; marketName: string; selectionName: string; outcome: 'WON' | 'LOST' | 'VOID' }) {
  return request<{ ok: boolean; legs: number; bets: number }>('/admin/legs/settle', { method: 'POST', body: JSON.stringify(body) });
}

export interface AdminMarketCoverage {
  summary: { markets: number; autoSettled: number; withoutRule: number; betLegsWithoutRule: number; pendingLegsWithoutRule: number };
  markets: { name: string; legs: number; pending: number; matches: number; autoSettles: boolean; samples?: string[] }[];
  text: string;
}
/** Which markets the system settles by itself and which it does not (admin). */
export async function adminFetchMarketCoverage() {
  return request<AdminMarketCoverage>('/admin/market-coverage');
}

export async function adminSettleMatch(matchId: string, homeScore: number, awayScore: number) {
  return request<{ ok: true; autoSettledLegs: number; leftPendingForManualReview: number; affectedBets: number }>(
    `/admin/matches/${matchId}/settle`,
    { method: 'POST', body: JSON.stringify({ homeScore, awayScore }) }
  );
}

// --- Owner: Agent hierarchy (reports only, Owner never plays) ---

export interface AdminOverview {
  agents: { total: number; active: number; totalBalance: number; totalBalanceEur: number };
  users: { total: number; active: number; totalBalance: number; totalBalanceEur: number };
  tickets: { total: number; turnover: number; wins: number; losses: number; pending: number; turnoverEur: number; winsEur: number; lossesEur: number; pendingEur: number; pendingCount: number };
  netResult: number;
  netResultEur: number;
}
export async function adminFetchOverview() {
  return request<AdminOverview>('/admin/overview');
}

export async function adminFetchAgents(): Promise<User[]> {
  const data = await request<{ agents: User[] }>('/admin/agents');
  return data.agents;
}

export async function adminCreateAgent(a: { name: string; username: string; password: string; balance: number }) {
  return request<{ agent: User }>('/admin/agents', { method: 'POST', body: JSON.stringify(a) });
}

export async function adminCreditAgent(agentId: string, amount: number, amountEur = 0) {
  return request<{ balance: number; balanceEur: number; ownerBalance: number; ownerBalanceEur: number }>(`/admin/agents/${agentId}/credit`, {
    method: 'POST', body: moneyBody(amount, amountEur),
  });
}

export async function adminDebitAgent(agentId: string, amount: number, amountEur = 0) {
  return request<{ balance: number; balanceEur: number; ownerBalance: number; ownerBalanceEur: number }>(`/admin/agents/${agentId}/debit`, {
    method: 'POST', body: moneyBody(amount, amountEur),
  });
}

export async function adminSetAgentCommission(agentId: string, commissionRate: number) {
  return request<{ ok: true; commissionRate: number }>(`/admin/agents/${agentId}/commission`, {
    method: 'PATCH', body: JSON.stringify({ commissionRate }),
  });
}

export interface AgentUserPerformance {
  id: string; name: string; username: string; balance: number; balanceEur?: number; is_active: boolean;
  tickets: number; turnover: number; wins: number; losses: number; pending: number;
  turnover_eur?: number; wins_eur?: number; losses_eur?: number; pending_eur?: number;
}
export async function adminFetchAgentPerformance(agentId: string) {
  return request<{ agent: User; users: AgentUserPerformance[] }>(`/admin/agents/${agentId}/performance`);
}

// --- Agent: self-play + manage own Users ---

export async function agentFetchMe() {
  return request<{ agent: User }>('/agent/me');
}

export async function agentCreateUser(u: { name: string; username: string; password: string; initialBalance?: number; initialBalanceEur?: number }) {
  return request<{ user: User }>('/agent/users', { method: 'POST', body: JSON.stringify(u) });
}

export async function agentSetUserActive(userId: string, active: boolean) {
  return request<{ ok: true }>(`/agent/users/${userId}/active`, { method: 'PATCH', body: JSON.stringify({ active }) });
}

export async function agentCreditUser(userId: string, amount: number, amountEur = 0) {
  return request<{ balance: number; balanceEur: number; agentBalance: number; agentBalanceEur: number }>(`/agent/users/${userId}/credit`, { method: 'POST', body: moneyBody(amount, amountEur) });
}

export async function agentDebitUser(userId: string, amount: number, amountEur = 0) {
  return request<{ balance: number; balanceEur: number; agentBalance: number; agentBalanceEur: number }>(`/agent/users/${userId}/debit`, { method: 'POST', body: moneyBody(amount, amountEur) });
}

export interface AgentTicketSelection {
  matchId: string; matchHome: string; matchAway: string;
  marketId: string; marketName: string; selectionId: string; selectionName: string;
  odds: number; status: string;
}
export interface AgentTicket {
  id: string; type: string; stake: number; totalOdds: number; potentialReturn: number;
  status: string; createdAt: number; selections: AgentTicketSelection[];
}
export async function agentFetchUserTickets(userId: string) {
  const data = await request<{ tickets: AgentTicket[] }>(`/agent/users/${userId}/tickets`);
  return data.tickets;
}

export async function agentFetchPerformance() {
  const data = await request<{ users: AgentUserPerformance[] }>('/agent/performance');
  return data.users;
}

export interface AgentMonthlyReport {
  month: string;
  totals: { totalUsers: number; totalTickets: number; turnover: number; wins: number; losses: number; pending: number; netResult: number };
  commissionRate: number;
  commissionOwed: number;
  users: { id: string; name: string; username: string; tickets: number; turnover: number; wins: number; losses: number; pending: number }[];
}
export async function agentFetchMonthlyReport(month?: string) {
  const q = month ? `?month=${encodeURIComponent(month)}` : '';
  return request<AgentMonthlyReport>(`/agent/reports/monthly${q}`);
}

export async function agentDeleteUser(userId: string) {
  return request<{ ok: true }>(`/agent/users/${userId}`, { method: 'DELETE' });
}

export interface AdminMonthlyReport {
  month: string;
  totals: { totalAgents: number; totalUsers: number; totalTickets: number; turnover: number; wins: number; losses: number; pending: number; wonTickets: number; lostTickets: number; pendingTickets: number; netResult: number; turnoverEur: number; winsEur: number; lossesEur: number; pendingEur: number; netResultEur: number };
  // users that belong to the admin directly (no agent in between)
  direct: { total_users: number; tickets: number; won_tickets: number; lost_tickets: number; pending_tickets: number; turnover: number; wins: number; losses: number; pending: number; netResult: number; turnover_eur: number; wins_eur: number; losses_eur: number; pending_eur: number; netResultEur: number };
  agents: { id: string; name: string; username: string; total_users: number; tickets: number; won_tickets: number; lost_tickets: number; pending_tickets: number; turnover: number; wins: number; losses: number; pending: number; commission_rate: number; netResult: number; commissionRate: number; commissionOwed: number; turnover_eur: number; wins_eur: number; losses_eur: number; pending_eur: number; netResultEur: number; commissionOwedEur: number }[];
}
// Super admin: what every admin did in the month (credit, agents, users, tickets, turnover, won / lost, net).
export interface AdminMoneyRow {
  tickets: number; won_tickets: number; lost_tickets: number; pending_tickets: number;
  turnover: number; wins: number; losses: number; pending: number; netResult: number;
  turnover_eur: number; wins_eur: number; losses_eur: number; pending_eur: number; netResultEur: number;
}
export interface AdminsReport {
  month: string;
  admins: (AdminMoneyRow & { id: string; name: string; username: string; balance: number; balanceEur: number; agents: number; users: number })[];
  unowned: AdminMoneyRow & { users: number };
}
export async function adminFetchAdminsReport(month?: string) {
  const q = month ? `?month=${encodeURIComponent(month)}` : '';
  return request<AdminsReport>(`/admin/reports/admins${q}`);
}
// Super admin: the tickets of ONE admin's agents and users, newest first.
export async function adminFetchBetsOfAdmin(adminId: string, limit = 100) {
  const data = await request<{ bets: any[] }>(`/admin/bets?adminId=${encodeURIComponent(adminId)}&limit=${limit}`);
  return data.bets;
}

// Super admin: the whole tree (admin -> agents -> users, direct users, unowned), balances in lek and euro.
export interface HierarchyUser { id: string; name: string; username: string; isActive: boolean; balance: number; balanceEur: number }
export interface HierarchyAgent extends HierarchyUser { users: HierarchyUser[] }
export interface HierarchyBranch { agents: HierarchyAgent[]; directUsers: HierarchyUser[] }
export interface Hierarchy { admins: (HierarchyUser & HierarchyBranch)[]; unowned: HierarchyBranch }
export async function adminFetchHierarchy() {
  return request<Hierarchy>('/admin/hierarchy');
}
// Super admin: hand an agent (with all his users) or a single user to another admin (null = nobody).
export async function adminMoveAccount(accountId: string, adminId: string | null, agentId: string | null = null) {
  return request<{ ok: true }>(`/admin/accounts/${accountId}/admin`, { method: 'PATCH', body: JSON.stringify({ adminId, agentId }) });
}

export async function adminFetchMonthlyReport(month?: string) {
  const q = month ? `?month=${encodeURIComponent(month)}` : '';
  return request<AdminMonthlyReport>(`/admin/reports/monthly${q}`);
}

// --- Casino (server-authoritative: every game is deducted/resolved/paid
// out on the backend, never mutated purely client-side) ---

export interface PokerCard { suit: string; value: string; }

export async function casinoSlotsSpin(stake: number) {
  return request<{ reels: string[]; payout: number; balance: number }>('/casino/slots/spin', {
    method: 'POST',
    body: JSON.stringify({ stake }),
  });
}

export async function casinoRouletteSpin(bets: Record<string, number>) {
  return request<{ result: number; payout: number; balance: number }>('/casino/roulette/spin', {
    method: 'POST',
    body: JSON.stringify({ bets }),
  });
}

export async function casinoBaccaratDeal(stake: number, selectedBet: 'PLAYER' | 'BANKER' | 'TIE') {
  return request<{ playerHand: any[]; bankerHand: any[]; result: 'PLAYER' | 'BANKER' | 'TIE'; payout: number; balance: number }>(
    '/casino/baccarat/deal',
    { method: 'POST', body: JSON.stringify({ stake, selectedBet }) }
  );
}

export async function casinoCrashStart(stake: number) {
  return request<{ roundId: string; startTime: number; balance: number }>('/casino/crash/start', {
    method: 'POST',
    body: JSON.stringify({ stake }),
  });
}

export async function casinoCrashStatus(roundId: string) {
  return request<{ crashed: boolean; multiplier: number | null; resolved: boolean }>(`/casino/crash/${roundId}/status`);
}

export async function casinoCrashCashout(roundId: string) {
  return request<{ crashed: boolean; multiplier: number; payout: number; balance: number }>(
    `/casino/crash/${roundId}/cashout`,
    { method: 'POST' }
  );
}

export async function casinoBlackjackDeal(stake: number) {
  return request<{
    roundId: string; status: 'PLAYING' | 'FINISHED';
    playerHand: any[]; dealerHand: (any | null)[]; message: string | null; payout: number; balance: number;
  }>('/casino/blackjack/deal', { method: 'POST', body: JSON.stringify({ stake }) });
}

export async function casinoBlackjackHit(roundId: string) {
  return request<{
    status: 'PLAYING' | 'FINISHED';
    playerHand: any[]; dealerHand: (any | null)[]; message?: string; payout?: number; balance?: number;
  }>(`/casino/blackjack/${roundId}/hit`, { method: 'POST' });
}

export async function casinoBlackjackStand(roundId: string) {
  return request<{
    status: 'FINISHED';
    playerHand: any[]; dealerHand: any[]; message: string; payout: number; balance: number;
  }>(`/casino/blackjack/${roundId}/stand`, { method: 'POST' });
}

export async function casinoVideoPokerDeal(stake: number) {
  return request<{ roundId: string; hand: PokerCard[]; balance: number }>('/casino/videopoker/deal', {
    method: 'POST',
    body: JSON.stringify({ stake }),
  });
}

export async function casinoVideoPokerDraw(roundId: string, holdIndices: number[]) {
  return request<{ hand: PokerCard[]; tier: string | null; payout: number; balance: number }>(
    `/casino/videopoker/${roundId}/draw`,
    { method: 'POST', body: JSON.stringify({ holdIndices }) }
  );
}

export interface Favorite { type: 'TEAM' | 'LEAGUE'; value: string; }

export async function getFavorites() {
  return request<{ favorites: Favorite[] }>('/favorites');
}

export async function toggleFavorite(type: 'TEAM' | 'LEAGUE', value: string) {
  return request<{ favorites: Favorite[]; favorited: boolean }>('/favorites/toggle', {
    method: 'POST',
    body: JSON.stringify({ type, value }),
  });
}
