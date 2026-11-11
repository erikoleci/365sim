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
  status?: number;
  constructor(message: string, code?: string, body?: any, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.body = body;
    this.status = status;
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
      throw new ApiError(message, body?.code, body, resp.status);
    }
    return body as T;
  }
  // Unreachable in practice (the loop above always returns or throws),
  // kept only so TypeScript sees every path returning/throwing.
  throw new Error(tr("S'arritëm të lidhemi me serverin. Kontrollo internetin dhe provo përsëri."));
}

// --- Auth ---

// Ask for the matches in the background (public data), so they are already in the browser when the app needs them:
// used on the login screen and the moment a login is sent, so after signing in (user, agent or admin) the games, odds
// and live minutes appear at once instead of starting to download only then. Picked up by fetchMatches/fetchLiveMatches.
export function prefetchMatches(): void {
  try {
    const w = window as any;
    if (w.__earlyMatches && Date.now() - w.__earlyMatches.at < 8000) return; // a fresh one is already on its way
    const get = (path: string) => fetch(`${API_BASE}/api/matches${path}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    w.__earlyMatches = { at: Date.now(), live: get('/live'), all: get('') };
  } catch { /* the app asks for the matches itself */ }
}

export async function login(username: string, password: string): Promise<User> {
  // The list download (about 1.4 MB) starts AFTER the answer, not before: sent together, it shares a slow phone connection
  // with the login itself and made "Hyr" wait for seconds. The server keeps the list ready, so it still arrives at once.
  const data = await request<{ token: string; user: User }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }, { retry: true });
  setToken(data.token);
  prefetchMatches(); // downloads while the app opens
  return data.user;
}

// Self-service registration is intentionally not offered -- accounts are
// created by an Admin or Agent (see AgentUsersPanel), never by the person
// signing themselves up. See server/routes/auth.js for the same note on
// the backend side.

// Only a token the server REJECTS (401 expired / invalid, 403 disabled account) logs the person out. A busy server
// (500 / 503 / 429, a timeout) used to wipe the token here too, so a slow moment threw users back to the login screen.
// Those are retried a few times and, if the server still does not answer, the signed-in user is kept as last known.
export async function fetchCurrentUser(): Promise<User | null> {
  if (!getToken()) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await request<{ user: User }>('/auth/me');
      return data.user;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setToken(null); // token expired/invalid or account disabled
        return null;
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  try { return JSON.parse(localStorage.getItem('cachedUser') || 'null'); } catch { return null; }
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

// The page asked for the matches before the app code finished loading (see index.html). Used once, only when fresh.
function takeEarlyMatches<T>(kind: 'live' | 'all'): Promise<T | null> | null {
  try {
    const early = (window as any).__earlyMatches;
    if (!early || Date.now() - early.at > 15000 || !early[kind]) return null;
    const p = early[kind];
    early[kind] = null;
    return p;
  } catch { return null; }
}

export async function fetchMatches(league?: string): Promise<{ matches: Match[]; leagueNames?: Record<string, string>; leagueMeta?: Record<string, LeagueMeta> }> {
  const qs = league && league !== 'All Top Football' ? `?league=${encodeURIComponent(league)}` : '';
  if (!qs) {
    const early = await takeEarlyMatches<{ matches: Match[]; leagueNames?: Record<string, string>; leagueMeta?: Record<string, LeagueMeta> }>('all');
    if (early && Array.isArray(early.matches)) return early;
  }
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

// Only the matches in play, small and fast: fetched first when a tab opens or returns (see useMatchesFeed.loadLive).
export async function fetchLiveMatches(): Promise<{ matches: Match[] }> {
  const early = await takeEarlyMatches<{ matches: Match[] }>('live');
  if (early && Array.isArray(early.matches)) return early;
  return request('/matches/live');
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
  yellow_home?: number | null;
  yellow_away?: number | null;
  red_home?: number | null;
  red_away?: number | null;
  attacks_home?: number | null;
  attacks_away?: number | null;
  dangerous_attacks_home?: number | null;
  dangerous_attacks_away?: number | null;
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

export interface MatchExtra { bigChancesHome: number | null; bigChancesAway: number | null; leg: number | null; aggregate: string | null; legText: string | null }
type LiveDetail = { statistics: LiveStatistics | null; events: MatchEvent[]; extra?: MatchExtra | null };
const liveDetailPrefetch = new Map<string, { at: number; promise: Promise<LiveDetail> }>();

// The finger is on a match: start downloading its events and statistics now, so they are there when the page opens.
export function prefetchLiveDetail(matchId: string): void {
  const now = Date.now();
  const hit = liveDetailPrefetch.get(matchId);
  if (hit && now - hit.at < 5000) return;
  if (liveDetailPrefetch.size > 20) liveDetailPrefetch.clear();
  const promise = request<LiveDetail>(`/matches/${matchId}/live-detail`);
  promise.catch(() => liveDetailPrefetch.delete(matchId));
  liveDetailPrefetch.set(matchId, { at: now, promise });
}

export async function fetchMatchLiveDetail(matchId: string): Promise<LiveDetail> {
  const hit = liveDetailPrefetch.get(matchId);
  if (hit && Date.now() - hit.at < 5000) {
    liveDetailPrefetch.delete(matchId); // used once: the next look (polling, a goal) asks the server again
    try { return await hit.promise; } catch { /* fall through to a normal request */ }
  }
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


function mapServerBet(b: any): Bet {
  return {
    id: b.id,
    ticketNo: b.ticket_no == null ? undefined : Number(b.ticket_no),
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
      placedState: s.placed_state ?? undefined,
      matchStartTime: s.match_start_time ?? undefined,
    })),
    matchDetails: b.selections?.[0] ? { homeTeam: b.selections[0].match_home, awayTeam: b.selections[0].match_away } : undefined,
  };
}

// --- Admin ---

export async function adminFetchUsers(): Promise<User[]> {
  const data = await request<{ users: User[] }>('/admin/users');
  return data.users;
}

export async function adminCreateUser(u: { name: string; username: string; password: string; balance: number; balanceEur?: number; currency?: 'ALL' | 'EUR' | 'BOTH' }) {
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
  return request<{ ticketDeletionAllowed: boolean; casinoAccess?: CasinoMode; casinoDisabledGames?: string[]; casinoGameKeys?: string[] }>('/admin/settings');
}
/** Super admin: allow or forbid normal admins to delete tickets. */
export async function adminSetTicketDeletion(allowed: boolean) {
  return request<{ ticketDeletionAllowed: boolean }>('/admin/settings/ticket-deletion', { method: 'PUT', body: JSON.stringify({ allowed }) });
}

export async function adminFetchExposure() {
  const data = await request<{ exposure: AdminExposureRow[] }>('/admin/risk/exposure');
  return data.exposure;
}

// Super admin only: close any ticket by hand as won or lost (a win is paid once; a won ticket made lost gives the winnings back).
export async function adminSetAccountCurrency(userId: string, currency: 'ALL' | 'EUR' | 'BOTH') {
  return request<{ ok: true; accountCurrency: string }>(`/admin/users/${userId}/currency`, { method: 'PATCH', body: JSON.stringify({ currency }) });
}

export async function adminResolveBet(betId: string, outcome: 'WON' | 'LOST') {
  return request<{ ok: true; status: string; unchanged?: boolean }>(`/admin/bets/${betId}/resolve`, { method: 'POST', body: JSON.stringify({ outcome }) });
}

export interface OpenLegWhy { legId: number; matchId: string; match: string; selection: string; code: string; text: string }
export async function adminBetWhy(betId: string) {
  return request<{ status: string; legs: OpenLegWhy[] }>(`/admin/bets/${betId}/why`);
}

export async function adminSetLeg(legId: number, status: 'WON' | 'LOST') {
  return request<{ ok: true }>(`/admin/bet-selections/${legId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

export async function adminCancelBet(betId: string, reason?: string) {
  return request<{ ok: true }>(`/admin/bets/${betId}/cancel`, { method: 'POST', body: JSON.stringify({ reason: reason ?? '' }) });
}
export interface TicketCancellation {
  id: number; betId: string; ticketNo: number | null; userId: string; playerUsername: string | null; ownerAdminId: string | null;
  actorId: string; actorUsername: string | null; actorRole: string | null; stake: number; currency: 'ALL' | 'EUR'; statusBefore: string | null;
  decidedLegs: number; balanceChange: number; reason: string | null; createdAt: number; seenAt: number | null;
}
export async function adminFetchCancellations() { return request<{ unread: number; items: TicketCancellation[] }>('/admin/cancellations'); }
export async function adminCancellationsUnread() { return request<{ unread: number }>('/admin/cancellations/unread'); }
export async function adminMarkCancellationsSeen() { return request<{ ok: true }>('/admin/cancellations/seen', { method: 'POST' }); }

export async function adminCreateAdmin(a: { name: string; username: string; password: string; balance: number }) {
  return request<{ admin: User }>('/admin/admins', { method: 'POST', body: JSON.stringify(a) });
}

export async function adminDebitAdmin(adminId: string, amount: number, amountEur = 0) {
  return request<{ balance: number; balanceEur: number }>(`/admin/admins/${adminId}/debit`, { method: 'POST', body: moneyBody(amount, amountEur) });
}

export async function adminCreditAdmin(adminId: string, amount: number, amountEur = 0, isTest = false, opts: { at?: number; recordOnly?: boolean } = {}) {
  return request<{ balance: number; balanceEur: number }>(`/admin/admins/${adminId}/credit`, { method: 'POST', body: JSON.stringify({ ...(amount ? { amount } : {}), ...(amountEur ? { amountEur } : {}), ...(isTest ? { isTest: true } : {}), ...(opts.at ? { at: opts.at } : {}), ...(opts.recordOnly ? { recordOnly: true } : {}) }) });
}
/** Super admin: the admin handed cash back ("shlyer"); at = optional date (ms). */
export async function adminSettleCredit(adminId: string, amount: number, amountEur = 0, at?: number, note?: string) {
  return request<{ ok: true }>(`/admin/admins/${adminId}/settle`, { method: 'POST', body: JSON.stringify({ ...(amount ? { amount } : {}), ...(amountEur ? { amountEur } : {}), ...(at ? { at } : {}), ...(note ? { note } : {}) }) });
}
export async function adminDeleteSettlement(id: number) { return request<{ ok: true }>(`/admin/credit-settlements/${id}`, { method: 'DELETE' }); }
/** Super admin: mark an old credit test / real and/or fix its date. */
export async function adminEditCredit(id: number, patch: { isTest?: boolean; at?: number }) {
  return request<{ ok: true }>(`/admin/credit-ledger/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
/** Any admin: the credit the super admin gave him, with dates. */
export interface MyCredits { credits: { id: number; at: number; currency: 'ALL' | 'EUR'; amount: number; isTest: boolean }[]; total: { ALL: number; EUR: number } }
export async function adminFetchMyCredits() { return request<MyCredits>('/admin/my-credits'); }

/** Admin: the credit he gave to his agents, and the winnings paid to players out of his credit. */
export interface AgentCreditLedger {
  agents: { id: string; name: string; username: string; remaining: Dual; given: Dual; takenBack: Dual; net: Dual; credits: number; lastCreditAt: number | null; period: { given: Dual; takenBack: Dual; credits: number } }[];
  totals: { given: Dual; takenBack: Dual; net: Dual; remaining: Dual };
  periodTotals?: { given: Dual; takenBack: Dual; credits: number };
  history: { id: number; at: number; agentId: string; agentName: string; agentUsername: string; currency: 'ALL' | 'EUR'; amount: number; kind: 'GIVEN' | 'TAKEN' }[];
  winPayouts: { paid: Dual; reversed: Dual; net: Dual; period?: { paid: Dual; reversed: Dual }; history: { id: number; at: number; currency: 'ALL' | 'EUR'; amount: number; kind: 'PAID' | 'REVERSED'; ticketNo: number | null; username: string | null }[] };
  directUsers: {
    list: { id: string; name: string; username: string; viaAgent: boolean; remaining: Dual; given: Dual; takenBack: Dual; net: Dual; credits: number; lastCreditAt: number | null }[];
    totals: { given: Dual; takenBack: Dual; net: Dual };
    history: { id: number; at: number; userId: string; userName: string; username: string; currency: 'ALL' | 'EUR'; amount: number; kind: 'GIVEN' | 'TAKEN' }[];
  };
  myBalance: Dual;
  adminPaysWins: boolean;
}
export async function adminFetchAgentCredit(range?: { from?: number | null; to?: number | null }, agentId?: string) {
  const q = new URLSearchParams();
  if (agentId) q.set('agentId', agentId);
  if (range?.from != null) q.set('from', String(range.from));
  if (range?.to != null) q.set('to', String(range.to));
  if (range && (range.from != null || range.to != null)) q.set('limit', '1000');
  const qs = q.toString();
  return request<AgentCreditLedger>(`/admin/agent-credit${qs ? '?' + qs : ''}`);
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
  id: string; name: string; username: string; balance: number; balanceEur?: number; accountCurrency?: 'ALL' | 'EUR' | 'BOTH'; is_active: boolean;
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

export async function agentCreateUser(u: { name: string; username: string; password: string; initialBalance?: number; initialBalanceEur?: number; currency?: 'ALL' | 'EUR' | 'BOTH' }) {
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
  id: string; ticketNo?: number | null; type: string; stake: number; totalOdds: number; potentialReturn: number;
  status: string; createdAt: number; currency?: 'ALL' | 'EUR'; selections: AgentTicketSelection[];
}
export async function agentFetchAllTickets() {
  const data = await request<{ tickets: (AgentTicket & { userName: string })[] }>('/agent/tickets');
  return data.tickets;
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
  // tickets the agents placed with their own account (in the totals, in no agent's row)
  agentsOwn?: { total_users: number; tickets: number; won_tickets: number; lost_tickets: number; pending_tickets: number; turnover: number; wins: number; losses: number; pending: number; netResult: number; turnover_eur: number; wins_eur: number; losses_eur: number; pending_eur: number; netResultEur: number };
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
export async function adminFetchAdminsReport(month?: string, opts: { from?: string; to?: string; all?: boolean; adminId?: string } = {}) {
  const qs = new URLSearchParams();
  if (opts.from || opts.to) { if (opts.from) qs.set('from', opts.from); if (opts.to) qs.set('to', opts.to); }
  else if (opts.all) qs.set('month', 'all');
  else if (month) qs.set('month', month);
  if (opts.adminId) qs.set('adminId', opts.adminId);
  const q = qs.toString() ? `?${qs}` : '';
  return request<AdminsReport>(`/admin/reports/admins${q}`);
}
// Super admin: the book of credit given to the admins (see server/creditLedger.js).
export interface Dual { ALL: number; EUR: number }
export interface CreditPeriod { given: Dual; real: Dual; test: Dual; takenBack: Dual; cash: Dual; settled: Dual; credits?: number }
export interface CreditLedger {
  periodTotals?: CreditPeriod; range?: { from: number | null; to: number | null } | null;
  feeRate: number;
  admins: { id: string; name: string; username: string; remaining: Dual; given: Dual; takenBack: Dual; net: Dual; cash: Dual; used: Dual; leftPct: { ALL: number | null; EUR: number | null }; credits: number; lastCreditAt: number | null; settled: Dual; owed: Dual; testGiven: Dual; period?: CreditPeriod }[];
  totals: { given: Dual; takenBack: Dual; net: Dual; cash: Dual; remaining: Dual; settled: Dual; owed: Dual; testGiven: Dual };
  history: { id: number | string; settlementId?: number; at: number; adminId: string; adminName: string; adminUsername: string; kind: 'CREDIT' | 'TAKE_BACK' | 'SETTLEMENT'; currency: 'ALL' | 'EUR'; amount: number; cash: number; feeRate: number | null; isTest?: boolean; note?: string | null }[];
}
/** range: from / to in ms (either may be left out) = only what happened between those two moments is counted in `period`. */
export async function adminFetchCreditLedger(adminId?: string, range?: { from?: number | null; to?: number | null }) {
  const q = new URLSearchParams();
  if (adminId) q.set('adminId', adminId);
  if (range?.from != null) q.set('from', String(range.from));
  if (range?.to != null) q.set('to', String(range.to));
  if (range && (range.from != null || range.to != null)) q.set('limit', '1000');
  const qs = q.toString();
  return request<CreditLedger>(`/admin/credit-ledger${qs ? '?' + qs : ''}`);
}
// Super admin: the tickets of ONE admin's agents and users, newest first.
export async function adminFetchBetsOfAdmin(adminId: string, limit = 100) {
  const data = await request<{ bets: any[] }>(`/admin/bets?adminId=${encodeURIComponent(adminId)}&limit=${limit}`);
  return data.bets;
}

// Super admin: live action codes the feed sent (to find e.g. the penalty code) and what the provider's site calls them.
export interface VcCodeRow { code: string; label: string | null; count: number; home: number; away: number; firstSeen: string; lastSeen?: string; example: { vc: string; match?: string; score?: string; t?: string } | null }
export interface VcCodesReport { now: string; unlabelled: VcCodeRow[]; labelled: VcCodeRow[] }
export interface FeedFrame { at: number; eid: string; changed: string[]; from: Record<string, string | null>; frame: Record<string, string> }
export async function adminFetchFeedFrames() { return request<{ frames: FeedFrame[]; socketEvents?: { socket: string; event: string; count: number; samples: string[] }[] }>('/admin/feed-frames'); }
export async function adminFetchVcCodes() { return request<VcCodesReport>('/admin/vc-codes'); }
export interface ProviderLabelsReport { checked: string[]; errors: string[]; matches: { source: string; word: string; around: string; pairs: { code: string; text: string }[] }[] }
export async function adminFetchProviderLabels() { return request<ProviderLabelsReport>('/admin/provider-labels'); }
// Super admin: the whole tree (admin -> agents -> users, direct users, unowned), balances in lek and euro.
export interface HierarchyUser { id: string; name: string; username: string; isActive: boolean; balance: number; balanceEur: number }
export interface HierarchyAgent extends HierarchyUser { users: HierarchyUser[] }
export interface HierarchyBranch { agents: HierarchyAgent[]; directUsers: HierarchyUser[] }
export interface Hierarchy { admins: (HierarchyUser & HierarchyBranch)[]; unowned: HierarchyBranch }
export async function adminFetchHierarchy() {
  return request<Hierarchy>('/admin/hierarchy');
}
// Super admin: hand an agent (with all his users) or a single user to another admin (null = nobody).
export async function adminAssignUnowned(adminId: string) {
  return request<{ ok: true; rows: number }>('/admin/accounts/assign-unowned', { method: 'POST', body: JSON.stringify({ adminId }) });
}
export async function adminMoveAccount(accountId: string, adminId: string | null, agentId: string | null = null) {
  return request<{ ok: true }>(`/admin/accounts/${accountId}/admin`, { method: 'PATCH', body: JSON.stringify({ adminId, agentId }) });
}

// Agent commission report: 4% live / single result, 8% two or more results; lek (ALL) and euro (EUR) kept apart.
export interface CommissionMetrics { xhiro: number; fitim: number; pending: number; activeTickets: number; tickets: number; diferenca: number; percAgjentit: number; kompania: number }
export interface CommissionMetricsByCur { ALL: CommissionMetrics; EUR: CommissionMetrics }
export interface CommissionPlayer { id: string; name: string; username: string; isActive: boolean; currencies: CommissionMetricsByCur }
export interface CommissionRow { id: string | null; name: string; username: string; isActive: boolean; direct: boolean; currencies: CommissionMetricsByCur; players: CommissionPlayer[] }
export interface CommissionReportData {
  month: string; from?: string | null; to?: string | null; rates: { single: number; multi: number };
  groups: { admin: { id: string | null; name: string; username: string }; rows: CommissionRow[]; totals: CommissionMetricsByCur }[];
  totals: CommissionMetricsByCur;
}
// A report period: a day range (from / to, both included) or the old month ('YYYY-MM' / 'all').
export interface ReportPeriod { month?: string; from?: string; to?: string }
const periodQuery = (p?: string | ReportPeriod) => {
  const o: ReportPeriod = typeof p === 'string' ? { month: p } : (p || {});
  const qs = new URLSearchParams();
  if (o.from) qs.set('from', o.from);
  if (o.to) qs.set('to', o.to);
  if (!o.from && !o.to && o.month) qs.set('month', o.month);
  const q = qs.toString();
  return q ? `?${q}` : '';
};
export async function adminFetchCommissionReport(period?: string | ReportPeriod) {
  return request<CommissionReportData>(`/admin/reports/commission${periodQuery(period)}`);
}
export async function agentFetchCommissionReport(period?: string | ReportPeriod) {
  return request<CommissionReportData>(`/agent/reports/commission${periodQuery(period)}`);
}

export async function adminFetchMonthlyReport(month?: string) {
  const q = month ? `?month=${encodeURIComponent(month)}` : '';
  return request<AdminMonthlyReport>(`/admin/reports/monthly${q}`);
}

// --- Casino (server-authoritative: every game is deducted/resolved/paid
// out on the backend, never mutated purely client-side) ---

export interface PokerCard { suit: string; value: string; }

export interface SlotGameInfo {
  id: string;
  name: string;
  reels: number;
  paytable: Record<string, number>;
  twoCherries: number;
  rtp: number;
  hitFrequency: number;
  maxMultiplier: number;
}

export async function casinoSlotsGames() {
  return request<{ games: SlotGameInfo[] }>('/casino/slots/games');
}

export async function casinoSlotsSpin(stake: number, game = 'fruit') {
  return request<{ game: string; reels: string[]; multiplier: number; payout: number; balance: number }>('/casino/slots/spin', {
    method: 'POST',
    body: JSON.stringify({ stake, game }),
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

export async function casinoDiceRoll(stake: number, selectedBet: 'UNDER' | 'SEVEN' | 'OVER') {
  return request<{ dice: [number, number]; sum: number; result: 'UNDER' | 'SEVEN' | 'OVER'; payout: number; balance: number }>(
    '/casino/dice/roll',
    { method: 'POST', body: JSON.stringify({ stake, selectedBet }) }
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

export type FavoriteType = 'TEAM' | 'LEAGUE' | 'MATCH';
export interface Favorite { type: FavoriteType; value: string; }

export async function getFavorites() {
  return request<{ favorites: Favorite[] }>('/favorites');
}

export async function toggleFavorite(type: FavoriteType, value: string) {
  return request<{ favorites: Favorite[]; favorited: boolean }>('/favorites/toggle', {
    method: 'POST',
    body: JSON.stringify({ type, value }),
  });
}


// ---- Casino: who may open it, and the slot games ----
export type CasinoMode = 'off' | 'super' | 'all';
export async function casinoAccess() { return request<{ mode: CasinoMode; allowed: boolean; disabledGames?: string[] }>('/casino/access'); }
/** Super admin: off / only the super admin / everybody. */
export async function adminSetCasinoAccess(mode: CasinoMode) {
  return request<{ casinoAccess: CasinoMode }>('/admin/settings/casino-access', { method: 'PUT', body: JSON.stringify({ mode }) });
}
export interface CasinoReportRow { game: string; currency: 'ALL' | 'EUR'; rounds: number; staked: number; paid: number; houseResult: number }
export async function adminCasinoReport() { return request<{ rows: CasinoReportRow[] }>('/admin/casino/report'); }

export interface VideoSlotInfo {
  id: string; name: string; tagline: string; volatility: string; color: [string, string]; symbols: Record<string, string>;
  rtp: number; lines: number; paytable: Record<string, Record<string, number>>; scatterPay: Record<string, number>;
  freeSpins: Record<string, number>; category?: string; freeSpinMultiplier: number; wildExpand: boolean; scatterName: string; wildName: string;
}
export interface SlotSpin { grid: string[][]; wins: { line: number; symbol: string; count: number; pay: number }[]; scatters: number; free: boolean; win: number }
export interface SlotRound { spins: SlotSpin[]; payout: number; freeSpins: number; demo: boolean; balance?: number; balanceEur?: number }
export async function casinoSlotGames() {
  return request<{ games: VideoSlotInfo[]; stakes: { ALL: number[]; EUR: number[] }; demo: boolean; playing?: Record<string, number>; simulatedPlayers?: boolean }>('/casino/slot-games');
}
export async function casinoSlotSpin(id: string, stake: number, currency: 'ALL' | 'EUR') {
  return request<SlotRound>(`/casino/slot-games/${id}/spin`, { method: 'POST', body: JSON.stringify({ stake, currency }) });
}

export interface TumbleStep { wins: { symbol: string; count: number; pay: number; cells: [number, number][] }[]; multiplier: number; win: number; grid: string[][] }
export interface TumbleSpin { first: string[][]; free: boolean; scatters: number; scatterWin: number; win: number; steps: TumbleStep[] }
export interface TumbleRound { spins: TumbleSpin[]; payout: number; freeSpins: number; demo: boolean; balance?: number; balanceEur?: number }
export async function casinoTumbleInfo() {
  return request<{ stakes: { ALL: number[]; EUR: number[] }; demo: boolean; cols: number; rows: number; minCluster: number; paytable: Record<string, number[]>; scatterPay: Record<string, number>; freeSpins: number; maxWin: number }>('/casino/tumble/info');
}
export async function casinoTumbleSpin(stake: number, currency: 'ALL' | 'EUR') {
  return request<TumbleRound>('/casino/tumble/spin', { method: 'POST', body: JSON.stringify({ stake, currency }) });
}

export async function adminSetCasinoGames(disabled: string[]) {
  return request<{ casinoDisabledGames: string[] }>('/admin/settings/casino-games', { method: 'PUT', body: JSON.stringify({ disabled }) });
}

export type PlinkoRisk = 'LOW' | 'MEDIUM' | 'HIGH';
export async function casinoPlinkoConfig() {
  return request<{ rows: number[]; risks: PlinkoRisk[]; tables: Record<string, number[]> }>('/casino/plinko/config');
}
export async function casinoPlinkoDrop(stake: number, risk: PlinkoRisk, rows: number) {
  return request<{ path: number[]; bucket: number; multiplier: number; payout: number; balance: number }>(
    '/casino/plinko/drop', { method: 'POST', body: JSON.stringify({ stake, risk, rows }) });
}
export async function casinoMinesStart(stake: number, mines: number) {
  return request<{ roundId: string; mines: number; multiplier: number; nextMultiplier: number; balance: number }>(
    '/casino/mines/start', { method: 'POST', body: JSON.stringify({ stake, mines }) });
}
export async function casinoMinesReveal(roundId: string, index: number) {
  return request<{ safe: boolean; finished?: boolean; multiplier?: number; nextMultiplier?: number; revealed?: number; payout?: number; mines?: number[]; balance?: number }>(
    `/casino/mines/${roundId}/reveal`, { method: 'POST', body: JSON.stringify({ index }) });
}
export async function casinoMinesCashout(roundId: string) {
  return request<{ multiplier: number; payout: number; mines: number[]; balance: number }>(`/casino/mines/${roundId}/cashout`, { method: 'POST' });
}
export async function casinoDragonTigerDeal(stake: number, bet: 'DRAGON' | 'TIGER' | 'TIE') {
  return request<{ dragon: { suit: string; value: string }; tiger: { suit: string; value: string }; result: 'DRAGON' | 'TIGER' | 'TIE'; payout: number; balance: number }>(
    '/casino/dragon-tiger/deal', { method: 'POST', body: JSON.stringify({ stake, bet }) });
}

export async function casinoWheelSegments() {
  return request<{ segments: number[] }>('/casino/wheel/segments');
}
export async function casinoWheelSpin(stake: number) {
  return request<{ index: number; multiplier: number; payout: number; balance: number }>('/casino/wheel/spin', { method: 'POST', body: JSON.stringify({ stake }) });
}

export async function casinoKenoPaytable() {
  return request<{ pool: number; maxPicks: number; paytable: Record<string, Record<string, number>> }>('/casino/keno/paytable');
}
export async function casinoKenoPlay(stake: number, picks: number[]) {
  return request<{ drawn: number[]; hits: number; multiplier: number; payout: number; balance: number }>('/casino/keno/play', { method: 'POST', body: JSON.stringify({ stake, picks }) });
}
export async function casinoScratchPlay(stake: number) {
  return request<{ cells: number[]; multiplier: number; payout: number; balance: number }>('/casino/scratch/play', { method: 'POST', body: JSON.stringify({ stake }) });
}

// ---- Support (player writes, his admin and the super admin answer; staff replies carry no name) ----
export interface SupportThread {
  id: string; status: 'OPEN' | 'CLOSED'; ticketNo: number | null; matchLabel: string | null;
  createdAt: number; lastMessageAt: number; lastFrom: 'USER' | 'STAFF'; lastBody?: string; unread?: boolean;
  user?: { username: string; name: string; role?: string };
  /** The agent who looks after the player, if any. */
  agent?: { username: string; name: string } | null;
  /** Only the super admin gets this: the admin the player belongs to. */
  admin?: { username: string | null; name: string | null };
}
export interface SupportMessage { id: number; from: 'me' | 'support' | 'player' | 'staff'; body: string; at: number }
export interface SupportTicket {
  id: string; ticketNo: number | null; status: string; stake: number; totalOdds: number; potentialReturn: number; currency?: string; createdAt: number;
  legs: { match: string; market: string; selection: string; odds: number; status: string }[];
}
export async function supportThreads() { return request<{ threads: SupportThread[] }>('/support/threads'); }
export async function supportUnread() { return request<{ unread: number }>('/support/unread'); }
export async function supportThread(id: string) { return request<{ thread: SupportThread; messages: SupportMessage[] }>(`/support/threads/${encodeURIComponent(id)}`); }
export async function supportCreate(body: { message: string; betId?: string; matchLabel?: string }) {
  return request<{ id: string }>('/support/threads', { method: 'POST', body: JSON.stringify(body) });
}
export async function supportReply(id: string, message: string) {
  return request<{ ok: boolean }>(`/support/threads/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ message }) });
}
export async function supportInbox(status: 'OPEN' | 'CLOSED') { return request<{ threads: SupportThread[] }>(`/support/inbox?status=${status}`); }
export async function supportInboxUnread() { return request<{ unread: number }>('/support/inbox-unread'); }
export async function supportInboxThread(id: string) {
  return request<{ thread: SupportThread; messages: SupportMessage[]; ticket: SupportTicket | null }>(`/support/inbox/${encodeURIComponent(id)}`);
}
export async function supportInboxReply(id: string, message: string) {
  return request<{ ok: boolean }>(`/support/inbox/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ message }) });
}
export async function supportInboxStatus(id: string, status: 'OPEN' | 'CLOSED') {
  return request<{ ok: boolean }>(`/support/inbox/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status }) });
}

// ---- Crash / Hi-Lo / Hold & Win ----
export async function casinoCrashStart(stake: number, autoCashout?: number | null) {
  return request<{ roundId: string; growth: number; autoCashout: number | null; balance: number }>('/casino/crash/start', { method: 'POST', body: JSON.stringify({ stake, autoCashout: autoCashout || undefined }) });
}
export type CrashState = { status: 'RUNNING' | 'CRASHED' | 'WON'; multiplier?: number; crashPoint?: number; payout?: number; balance?: number };
export async function casinoCrashState(id: string) {
  return request<CrashState>(`/casino/crash/${id}/state`);
}
export async function casinoCrashCashout(id: string) {
  return request<CrashState>(`/casino/crash/${id}/cashout`, { method: 'POST', body: '{}' });
}
export type HiLoCard = { rank: number; suit: number };
export type HiLoOptions = { higher: number; lower: number };
export async function casinoHiLoStart(stake: number) {
  return request<{ roundId: string; card: HiLoCard; total: number; options: HiLoOptions; balance: number }>('/casino/hilo/start', { method: 'POST', body: JSON.stringify({ stake }) });
}
export async function casinoHiLoGuess(id: string, guess: 'higher' | 'lower') {
  return request<{ won: boolean; card: HiLoCard; total?: number; steps?: number; options?: HiLoOptions; payout?: number; finished: boolean; balance?: number }>(`/casino/hilo/${id}/guess`, { method: 'POST', body: JSON.stringify({ guess }) });
}
export async function casinoHiLoCashout(id: string) {
  return request<{ multiplier: number; payout: number; balance: number }>(`/casino/hilo/${id}/cashout`, { method: 'POST', body: '{}' });
}
export type HoldWinCoin = { cell: number; value: number };
export type HoldWinRound = { bonus: boolean; start: HoldWinCoin[]; respins: { landed: HoldWinCoin[]; lives: number }[]; full: boolean; multiplier: number; payout: number; balance: number };
export async function casinoHoldWinInfo() {
  return request<{ cols: number; rows: number; minTrigger: number; lives: number; coinTable: number[]; fullBoardBonus: number; maxWin: number }>('/casino/holdwin/info');
}
export async function casinoHoldWinPlay(stake: number) {
  return request<HoldWinRound>('/casino/holdwin/play', { method: 'POST', body: JSON.stringify({ stake }) });
}

// ---- Penalty / Tower (chain games), Horse Race, Three Cups ----
export type ChainGame = 'penalty' | 'tower';
export type ChainCfg = { doors: number; traps: number; maxSteps: number };
export async function casinoChainStart(game: ChainGame, stake: number, difficulty?: string) {
  return request<{ roundId: string; cfg: ChainCfg; step: number; balance: number }>(`/casino/${game}/start`, { method: 'POST', body: JSON.stringify({ stake, difficulty }) });
}
export async function casinoChainPick(game: ChainGame, id: string, choice: number) {
  return request<{ safe: boolean; traps: number[]; total?: number; steps?: number; finished: boolean; payout?: number; balance?: number }>(`/casino/${game}/${id}/pick`, { method: 'POST', body: JSON.stringify({ choice }) });
}
export async function casinoChainCashout(game: ChainGame, id: string) {
  return request<{ multiplier: number; payout: number; balance: number }>(`/casino/${game}/${id}/cashout`, { method: 'POST', body: '{}' });
}
export async function casinoTowerLevels() {
  return request<{ levels: Record<string, ChainCfg & { step: number }> }>('/casino/tower/levels');
}
export type Horse = { id: number; name: string; p: number; color: string; odds: number };
export async function casinoHorsesInfo() { return request<{ horses: Horse[]; token?: string }>('/casino/horses/info'); }
export async function casinoHorsesRace(stake: number, horse: number, token?: string) {
  return request<{ order: number[]; payout: number; odds: number; balance: number }>('/casino/horses/race', { method: 'POST', body: JSON.stringify({ stake, horse, token }) });
}
export async function casinoCupsPlay(stake: number, cup: number) {
  return request<{ start: number; swaps: [number, number][]; final: number; won: boolean; payout: number; multiplier: number; balance: number }>('/casino/cups/play', { method: 'POST', body: JSON.stringify({ stake, cup }) });
}

export type LiveWin = { simulated?: boolean; game: string; currency: 'ALL' | 'EUR'; stake: number; payout: number; multiplier: number; at: number; player: string };
export async function casinoLive() {
  return request<{ feed: LiveWin[]; playersLastHour: number; roundsLastHour: number; preview?: boolean }>('/casino/live');
}

// ---- Live Roulette ----
export type LiveRouletteState = {
  serverNow: number; round: number; phase: 'betting' | 'spin'; msLeft: number; cycleMs: number; betMs: number; result: number | null; history: number[];
  myBets: Record<string, number>; settled: { round: number; result: number; staked: number; payout: number }[]; balance: number; tablePlayers?: number; simulatedPlayers?: boolean;
};
export async function casinoLiveRouletteState() { return request<LiveRouletteState>('/casino/live-roulette/state'); }
export async function casinoLiveRouletteBet(round: number, bets: Record<string, number>) {
  return request<{ ok: boolean; balance: number }>('/casino/live-roulette/bet', { method: 'POST', body: JSON.stringify({ round, bets }) });
}

// ---- Live Horse Race ----
export type LiveHorsesState = {
  serverNow: number; round: number; phase: 'betting' | 'race'; msLeft: number; cycleMs: number; betMs: number; order: number[] | null; winners: number[];
  myBets: Record<string, number>; settled: { round: number; order: number[]; staked: number; payout: number }[]; balance: number; tablePlayers?: number; simulatedPlayers?: boolean; horses: Horse[];
};
export async function casinoLiveHorsesState() { return request<LiveHorsesState>('/casino/live-horses/state'); }
export async function casinoLiveHorsesBet(round: number, bets: Record<string, number>) {
  return request<{ ok: boolean; balance: number }>('/casino/live-horses/bet', { method: 'POST', body: JSON.stringify({ round, bets }) });
}

// ---- Dog Race (single + live) ----
export type Dog = { id: number; name: string; trap: number; p: number; color: string; odds: number };
export async function casinoDogsInfo() { return request<{ dogs: Dog[]; token?: string }>('/casino/dogs/info'); }
export async function casinoDogsRace(stake: number, dog: number, token?: string) {
  return request<{ order: number[]; payout: number; odds: number; balance: number }>('/casino/dogs/race', { method: 'POST', body: JSON.stringify({ stake, dog, token }) });
}
export type LiveDogsState = {
  serverNow: number; round: number; phase: 'betting' | 'race'; msLeft: number; cycleMs: number; betMs: number; order: number[] | null; winners: number[];
  myBets: Record<string, number>; settled: { round: number; order: number[]; staked: number; payout: number }[]; balance: number; tablePlayers?: number; simulatedPlayers?: boolean; runners: Dog[]; forecast?: (number | null)[][];
};
export async function casinoLiveDogsState() { return request<LiveDogsState>('/casino/live-dogs/state'); }
export async function casinoLiveDogsBet(round: number, bets: Record<string, number>) {
  return request<{ ok: boolean; balance: number }>('/casino/live-dogs/bet', { method: 'POST', body: JSON.stringify({ round, bets }) });
}

// ---- Live Crash / Live Keno ----
export type LiveCrashState = {
  serverNow: number; round: number; phase: 'betting' | 'flight' | 'crashed'; msLeft: number; t: number; cycleMs: number; betMs: number; growth: number; crashPoint: number | null;
  history: number[]; my: { round: number; auto: number | null; stake: number } | null;
  settled: { round: number; crashPoint: number; staked: number; payout: number; multiplier: number }[]; balance: number; tablePlayers?: number; simulatedPlayers?: boolean;
};
export async function casinoLiveCrashState() { return request<LiveCrashState>('/casino/live-crash/state'); }
export async function casinoLiveCrashBet(round: number, stake: number, autoCashout?: number | null) {
  return request<{ ok: boolean; balance: number }>('/casino/live-crash/bet', { method: 'POST', body: JSON.stringify({ round, stake, autoCashout: autoCashout || undefined }) });
}
export async function casinoLiveCrashCashout() {
  return request<{ multiplier: number; payout: number; crashed: boolean; balance: number }>('/casino/live-crash/cashout', { method: 'POST', body: '{}' });
}
export type LiveKenoState = {
  serverNow: number; round: number; phase: 'betting' | 'draw'; msLeft: number; cycleMs: number; betMs: number; drawn: number[] | null; tickets: { round: number; picks: number[]; stake: number }[];
  settled: { round: number; drawn: number[]; hits: number; staked: number; payout: number; multiplier: number }[]; balance: number; tablePlayers?: number; simulatedPlayers?: boolean;
};
export async function casinoLiveKenoState() { return request<LiveKenoState>('/casino/live-keno/state'); }
export async function casinoLiveKenoBet(round: number, stake: number, picks: number[]) {
  return request<{ ok: boolean; balance: number }>('/casino/live-keno/bet', { method: 'POST', body: JSON.stringify({ round, stake, picks }) });
}

// ---- Casino math profiles (super admin) ----
export interface CasinoCalibration { rounds: number; pWin: number; meanWin: number; rtpNat: number; sd: number; max: number; method: string }
export interface CasinoProfileValues { hitFrequency?: number; rtp?: number; volatility?: number; minBet: number; maxBet: number; maxWinMultiplier?: number }
export interface CasinoProfile {
  key: string; label: string; kind: 'outcome' | 'rtp' | 'bets'; group: string | null;
  defaults: CasinoProfileValues; values: CasinoProfileValues; calibration: CasinoCalibration | null; customised: boolean;
  rules: string | null;
  preview: { hitFrequency: number; rtp: number; houseEdge: number; netWinFrequency: number; volatilitySd: number; maxPayout: number; scale: number; capReached: boolean; buckets: [string, number][] } | null;
  measured: { rounds: number; hits: number; net: number; x5: number; x20: number; x100: number; staked: number; paid: number } | null;
}
export async function adminCasinoProfiles() { return request<{ profiles: CasinoProfile[] }>('/admin/casino/profiles'); }
export async function adminSaveCasinoProfile(key: string, values: Partial<CasinoProfileValues>) {
  return request<{ profiles: CasinoProfile[] }>(`/admin/casino/profiles/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(values) });
}
export async function adminResetCasinoProfile(key: string) {
  return request<{ profiles: CasinoProfile[] }>(`/admin/casino/profiles/${encodeURIComponent(key)}/reset`, { method: 'POST' });
}
export async function adminCasinoProfilesAudit() {
  return request<{ entries: { actor_username: string; action: string; target: string | null; details: string | null; created_at: number }[] }>('/admin/casino/profiles-audit');
}
export async function adminResetCasinoTestStats() { return request<{ removed: number }>('/admin/casino/reset-test-stats', { method: 'POST' }); }
