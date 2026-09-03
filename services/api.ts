import { User, Match, Bet, BetSelectionItem } from '../types';

const TOKEN_KEY = 'betsim_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const resp = await fetch(`/api${path}`, { ...options, headers });
  const contentType = resp.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await resp.json() : null;

  if (!resp.ok) {
    const message = body?.error || `Request failed (${resp.status})`;
    throw new Error(message);
  }
  return body as T;
}

// --- Auth ---

export async function login(username: string, password: string): Promise<User> {
  const data = await request<{ token: string; user: User }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setToken(data.token);
  return data.user;
}

export async function register(name: string, username: string, password: string): Promise<User> {
  const data = await request<{ token: string; user: User }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, username, password }),
  });
  setToken(data.token);
  return data.user;
}

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

export async function fetchMatches(league?: string): Promise<{ matches: Match[]; source?: string }> {
  const qs = league && league !== 'All Top Football' ? `?league=${encodeURIComponent(league)}` : '';
  return request(`/matches${qs}`);
}

export async function fetchLeagues(): Promise<{ key: string; title: string; group: string }[]> {
  const data = await request<{ leagues: { key: string; title: string; group: string }[] }>('/matches/leagues');
  return data.leagues;
}

export interface LiveStatistics {
  minute: number | null;
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
}

export async function fetchMatchLiveDetail(matchId: string): Promise<{ statistics: LiveStatistics | null; events: MatchEvent[] }> {
  return request(`/matches/${matchId}/live-detail`);
}

// --- Bets ---

export async function placeBet(stake: number, type: 'SINGLE' | 'ACCUMULATOR', selections: BetSelectionItem[]) {
  return request<{ bet: { id: string; totalOdds: number; potentialReturn: number; stake: number }; balance: number }>(
    '/bets',
    {
      method: 'POST',
      body: JSON.stringify({
        stake,
        type,
        selections: selections.map((s) => ({
          matchId: s.matchId,
          matchHome: s.matchHome,
          matchAway: s.matchAway,
          marketId: s.marketId,
          marketName: s.marketName,
          selectionId: s.selectionId,
          selectionName: s.selectionName,
        })),
      }),
    }
  );
}

export async function fetchMyBets(): Promise<Bet[]> {
  const data = await request<{ bets: any[] }>('/bets');
  return data.bets.map(mapServerBet);
}

export async function cancelMyBet(betId: string): Promise<{ balance: number }> {
  return request<{ ok: true; balance: number }>(`/bets/${betId}/cancel`, { method: 'POST' });
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
    timestamp: Number(b.created_at),
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

export async function adminAddCredit(userId: string, amount: number) {
  return request<{ user: User }>(`/admin/users/${userId}/credit`, {
    method: 'POST',
    body: JSON.stringify({ amount }),
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
  turnover: number;
  openLiability: number;
  openBets: number;
  ggr: number;
  totalUsers: number;
}
export async function adminFetchDashboardKpi() {
  return request<AdminDashboardKpi>('/admin/dashboard/kpi');
}

export interface AdminExposureRow {
  match_id: string; match_home: string; match_away: string;
  market_id: string; market_name: string; selection_id: string; selection_name: string;
  ticket_count: number; total_exposure: number;
}
export async function adminFetchExposure() {
  const data = await request<{ exposure: AdminExposureRow[] }>('/admin/risk/exposure');
  return data.exposure;
}

export async function adminCancelBet(betId: string) {
  return request<{ ok: true }>(`/admin/bets/${betId}/cancel`, { method: 'POST' });
}

export async function adminSettleMatch(matchId: string, homeScore: number, awayScore: number) {
  return request<{ ok: true; autoSettledLegs: number; leftPendingForManualReview: number; affectedBets: number }>(
    `/admin/matches/${matchId}/settle`,
    { method: 'POST', body: JSON.stringify({ homeScore, awayScore }) }
  );
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
