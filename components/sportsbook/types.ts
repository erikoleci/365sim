import { Match } from '../../types';

/** What a match row needs from the page: picking odds, opening a match, favourites, admin settling. */
export interface MatchRowActions {
  onBetClick: (match: Match, marketId: string, selectionId: string, boosted?: boolean) => void;
  onOpenDetail: (match: Match) => void;
  isAdmin: boolean;
  onSettleMatch: (match: Match, homeScore: number, awayScore: number) => void;
  simulatingMatchId: string | null;
  selectedIds: string[];
  favoriteTeams: Set<string>;
  onToggleFavoriteTeam: (team: string) => void;
}

/** The screen changes the sportsbook components can ask for. */
export interface ScreenActions {
  goToOdds: () => void;
  goToLeague: (leagueKey: string) => void;
  goToLive: () => void;
  goToResults: () => void;
}
