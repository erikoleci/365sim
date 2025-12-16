export enum UserRole {
  USER = 'USER',
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
}

export enum MatchStatus {
  UPCOMING = 'UPCOMING',
  LIVE = 'LIVE',
  FINISHED = 'FINISHED'
}

export interface MatchOdds {
  home: number;
  draw: number;
  away: number;
}

export interface MarketOption {
  id: string;
  name: string;
  odds: number;
}

export interface Market {
  id: string;
  name: string;
  category: string;
  options: MarketOption[];
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
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  status: MatchStatus;
  score?: MatchScore;
  summary?: string;
  markets: Market[];
  sourceUrls?: string[]; // For grounding attribution
  // Live Data
  isLive?: boolean;
  currentMinute?: string;
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
  LOST = 'LOST'
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
  matchDetails?: {
    homeTeam: string;
    awayTeam: string;
  };
}