export enum UserRole {
  USER = 'USER',
  AGENT = 'AGENT',
  ADMIN = 'ADMIN'
}

export interface User {
  id: string;
  name: string;
  username: string;
  password: string;
  balance: number;
  role: UserRole;
  avatar: string;
  isActive?: boolean;
  agentId?: string | null;
  // % of an AGENT's users' net gaming result (GGR) owed to them; 0/absent
  // for USER and ADMIN rows. See server/routes/admin.js commission endpoint.
  commissionRate?: number;
}

export enum MatchStatus {
  UPCOMING = 'UPCOMING',
  LIVE = 'LIVE',
  FINISHED = 'FINISHED'
}

export interface MarketOption {
  id: string;
  name: string;
  odds: number;
  // True when this price is the provider's "market temporarily suspended"
  // placeholder (see isSuspendedPrice in server/oddsUtils.js), not a real
  // bettable quote.
  suspended?: boolean;
}

export interface Market {
  id: string;
  name: string;
  category: string;
  options: MarketOption[];
  // True only when EVERY option in this market is suspended.
  suspended?: boolean;
}

export interface MatchScore {
  home: number;
  away: number;
  htHome: number;
  htAway: number;
  homeYellowCards: number;
  awayYellowCards: number;
  homeCorners: number;
  awayCorners: number;
  scorers: string[];
}

export interface Match {
  id: string;
  league: string; 
  // Provider's own numeric league/country identifiers (LondonPro365
  // league.id / league.country_id), alongside the existing slugged
  // `league` display key -- absent for a match imported before this field
  // existed (older matches_cache rows), so always optional. Prefer these
  // over string-matching `league` wherever an exact, stable identifier is
  // needed (filtering, admin lookups) instead of name comparison.
  leagueId?: string;
  countryId?: string;
  homeTeam: string;
  awayTeam: string;
  // Real crest URL, only present when the source provider supplies one.
  // Absent (not a placeholder photo) when no provider logo is available.
  homeTeamLogo?: string;
  awayTeamLogo?: string;
  startTime: string;
  status: MatchStatus;
  score?: MatchScore;
  summary?: string;
  markets: Market[];
  sourceUrls?: string[]; // For grounding attribution
  // Live Data
  isLive?: boolean;
  currentMinute?: string;
  // True when currentMinute is a wall-clock estimate from kickoff time
  // (the provider sent no minute) -- the UI prefixes it with "~".
  currentMinuteEstimated?: boolean;
  // Server-side epoch-ms timestamp of when currentMinute was last actually
  // observed to change (see migrations/0002_live_minute_updated_at.sql).
  // Lets the ticking clock resync from a real reference instead of the
  // client's own receive time -- see useTickingClock in MatchCard.tsx.
  currentMinuteUpdatedAt?: number;
  // What the provider's pitch shows right now (from the gamedetails VC code);
  // null/undefined when unknown. Never guessed.
  liveAction?: { side: 'home' | 'away' | null; kind: string; label: string } | null;
  liveStatus?: string;
  // Set by the server when the same real fixture exists under two provider ids and the
  // live data (score/minute/events/socket messages) belongs to this other id.
  liveSourceId?: string;
  liveHomeScore?: number;
  liveAwayScore?: number;
}

export enum BetSelection {
  HOME = 'HOME',
  DRAW = 'DRAW',
  AWAY = 'AWAY'
}

export enum BetStatus {
  PENDING = 'PENDING',
  WON = 'WON',
  LOST = 'LOST',
  VOID = 'VOID'
}

export interface BetSelectionItem {
  matchId: string;
  matchHome: string;
  matchAway: string;
  marketId: string;
  marketName: string;
  selectionId: string;
  selectionName: string;
  odds: number;
  status: BetStatus;
  // True when this selection came from the Special Offers boost strip —
  // the server independently re-verifies eligibility before honoring it.
  boosted?: boolean;
  // Set locally (never sent to the server) right after a placeBet attempt
  // comes back ODDS_CHANGED, so the slip can show "was X, now Y" on just
  // the selection(s) that actually moved instead of a generic error toast.
  // Cleared the moment the ticket is placed or the person edits the slip.
  previousOdds?: number;
}

export interface Bet {
  id: string;
  userId: string;
  type: 'SINGLE' | 'ACCUMULATOR';
  selections: BetSelectionItem[];
  stake: number;
  totalOdds: number;
  potentialReturn: number;
  status: BetStatus;
  timestamp: number;
  // Server verdict: false for tickets placed live / on a match that has started.
  cancellable?: boolean;
  matchDetails?: {
    homeTeam: string;
    awayTeam: string;
  };
}