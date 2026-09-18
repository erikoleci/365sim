import React from 'react';
import { Match, MatchStatus } from '../types';
import { formatMatchTime, formatMatchDayMonth, isSameAlbaniaDay, albaniaTodayKey } from '../utils/albaniaTime';
import { getMatchWinnerMarket } from './MatchCard';

interface FeaturedMatchCardProps {
  match: Match;
  onBetClick: (match: Match, marketId: string, selectionId: string) => void;
  onOpenDetail: (match: Match) => void;
  selectedIds: string[];
}

// Compact card for the horizontal "Ndeshjet Kryesore" scroller shown on the
// Soccer/home view -- id+time top-left, teams stacked, 1/X/2 buttons below.
// The full grouped list (Country -> League -> date -> MatchRow) stays the
// primary browsing surface; this is just a quick-glance strip above it.
const FeaturedMatchCard: React.FC<FeaturedMatchCardProps> = ({ match, onBetClick, onOpenDetail, selectedIds }) => {
  const isFinished = match.status === MatchStatus.FINISHED;
  const isLive = match.status === MatchStatus.LIVE;
  const matchWinnerMarket = getMatchWinnerMarket(match);
  const isToday = isSameAlbaniaDay(match.startTime, albaniaTodayKey());
  const shortId = match.id.replace(/^l365-/, '');

  const getButtonClass = (marketId: string, selectionId: string) => {
    const uniqueId = `${match.id}-${marketId}-${selectionId}`;
    const isSelected = selectedIds.includes(uniqueId);
    const base = 'flex-1 flex flex-col items-center justify-center min-h-[36px] rounded text-[11px] font-bold transition-colors';
    if (isFinished) return `${base} opacity-40 cursor-default bg-[#333] text-brand-textMuted`;
    if (isSelected) return `${base} bg-white text-brand-headerDark cursor-pointer`;
    return `${base} bg-[#3a3a3a] hover:bg-[#484848] text-brand-yellow cursor-pointer`;
  };

  return (
    <div className="shrink-0 w-36 sm:w-52 snap-start bg-brand-panel border border-brand-divider rounded overflow-hidden hover:border-brand-yellow/50 transition-colors">
      <button onClick={() => onOpenDetail(match)} className="w-full text-left px-2.5 pt-2 pb-2">
        <div className="flex items-center justify-between text-[10px] text-brand-textMuted mb-1.5">
          <span className={isLive ? 'text-brand-accent font-bold animate-pulse' : ''}>
            {isLive ? (match.currentMinute ? `${match.currentMinute}'` : 'LIVE') : isToday ? formatMatchTime(match.startTime) : formatMatchDayMonth(match.startTime)}
          </span>
          <span className="opacity-60 hidden sm:inline">{shortId}</span>
        </div>
        <div className="text-xs font-bold text-brand-text truncate">{match.homeTeam}</div>
        <div className="text-xs font-bold text-brand-text truncate">{match.awayTeam}</div>
      </button>
      {matchWinnerMarket && (
        <div className="flex gap-1 px-2 pb-2">
          {matchWinnerMarket.options.map((opt) =>
            opt.suspended ? (
              <div key={opt.id} className="flex-1 flex items-center justify-center min-h-[36px] rounded text-[11px] opacity-40" title="Tregu është pezulluar përkohësisht">🔒</div>
            ) : (
              <button
                key={opt.id}
                onClick={() => !isFinished && onBetClick(match, matchWinnerMarket.id, opt.id)}
                className={getButtonClass(matchWinnerMarket.id, opt.id)}
              >
                {opt.odds.toFixed(2)}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
};

export default React.memo(FeaturedMatchCard);
