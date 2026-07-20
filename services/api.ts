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

export async function fetchMatches(league?: string): Promise<{ matches: Match[]; hasLiveApiKey: boolean }> {
  const qs = league && league !== 'All Top Football' ? `?league=${encodeURIComponent(league)}` : '';
  return request(`/matches${qs}`);
}

export async function fetchLeagues(): Promise<{ key: string; title: string; group: string }[]> {
  const data = await request<{ leagues: { key: string; title: string; group: string }[] }>('/matches/leagues');
  return data.leagues;
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
    timestamp: b.created_at,
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

export async function adminCancelBet(betId: string) {
  return request<{ ok: true }>(`/admin/bets/${betId}/cancel`, { method: 'POST' });
}

export async function adminSettleMatch(matchId: string, homeScore: number, awayScore: number) {
  return request<{ ok: true; autoSettledLegs: number; leftPendingForManualReview: number; affectedBets: number }>(
    `/admin/matches/${matchId}/settle`,
    { method: 'POST', body: JSON.stringify({ homeScore, awayScore }) }
  );
}
