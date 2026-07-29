import React from 'react';
import { Match, MatchStatus } from '../types';
import { formatMatchTime, formatMatchDayMonth, isSameAlbaniaDay, albaniaTodayKey } from '../utils/albaniaTime';

interface MatchRowProps {
  match: Match;
  onBetClick: (match: Match, marketId: string, selectionId: string) => void;
  onOpenDetail: (match: Match) => void;
  isAdmin: boolean;
  onSettleMatch: (match: Match, homeScore: number, awayScore: number) => void;
  isSimulating: boolean;
  selectedIds: string[];
}

const MatchRow: React.FC<MatchRowProps> = ({ match, onBetClick, onOpenDetail, isAdmin, onSettleMatch, isSimulating, selectedIds }) => {
  const isFinished = match.status === MatchStatus.FINISHED;
  const isLive = match.status === MatchStatus.LIVE;
  const matchWinnerMarket = match.markets.find((m) => m.id.endsWith('-h2h'));
  const marketCount = match.markets.length;

  const getButtonClass = (marketId: string, selectionId: string) => {
    const uniqueId = `${match.id}-${marketId}-${selectionId}`;
    const isSelected = selectedIds.includes(uniqueId);
    const base = 'flex-1 flex flex-col justify-center items-center h-12 md:h-full min-h-[44px] rounded-lg cursor-pointer transition-all text-sm font-bold active:scale-[0.97]';
    if (isFinished) return `${base} opacity-30 cursor-default bg-brand-surface text-brand-textFaint`;
    if (isSelected) return `${base} bg-brand-accent text-brand-bg shadow-[0_0_0_1px_rgba(34,230,163,0.4)]`;
    return `${base} bg-brand-surface2 hover:bg-brand-surfaceHover text-brand-text border border-brand-border`;
  };

  const isToday = isSameAlbaniaDay(match.startTime, albaniaTodayKey());

  return (
    <div
      className={`flex flex-col md:flex-row bg-brand-surface hover:bg-brand-surface2 transition-colors group py-3 px-3 md:px-4 border-b border-brand-border last:border-b-0 first:rounded-t-xl last:rounded-b-xl ${
        isLive ? 'relative' : ''
      }`}
    >
      {isLive && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-brand-live rounded-l-xl" />}

      {/* Time & Teams Info */}
      <div className="flex-1 flex items-center cursor-pointer mb-3 md:mb-0 min-w-0" onClick={() => onOpenDetail(match)}>
        <div className="text-xs w-12 text-center flex flex-col items-center justify-center shrink-0">
          {isLive ? (
            <div className="flex flex-col items-center gap-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-live animate-pulseLive" />
              <span className="text-brand-live font-bold text-[11px]">{match.currentMinute || 'LIVE'}</span>
            </div>
          ) : (
            <>
              <div className={isToday ? 'text-brand-text font-semibold' : 'text-brand-textMuted'}>{formatMatchTime(match.startTime)}</div>
              {!isToday && <div className="text-[10px] text-brand-textFaint">{formatMatchDayMonth(match.startTime)}</div>}
            </>
          )}
        </div>

        <div className="flex-1 ml-3 border-l border-brand-border pl-3 py-0.5 overflow-hidden min-w-0">
          <div className="flex flex-col gap-1.5">
            <div className={`flex justify-between items-center ${isFinished ? 'opacity-70' : ''}`}>
              <span className="text-brand-text font-semibold text-sm truncate pr-2">{match.homeTeam}</span>
              {(isFinished || isLive) && (
                <span className={`font-mono font-bold text-base w-7 text-right leading-none tabular-nums ${isLive ? 'text-brand-live' : 'text-brand-text'}`}>
                  {isLive ? match.liveHomeScore ?? 0 : match.score?.home}
                </span>
              )}
            </div>
            <div className={`flex justify-between items-center ${isFinished ? 'opacity-70' : ''}`}>
              <span className="text-brand-text font-semibold text-sm truncate pr-2">{match.awayTeam}</span>
              {(isFinished || isLive) && (
                <span className={`font-mono font-bold text-base w-7 text-right leading-none tabular-nums ${isLive ? 'text-brand-live' : 'text-brand-text'}`}>
                  {isLive ? match.liveAwayScore ?? 0 : match.score?.away}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="hidden md:flex flex-col items-center gap-0.5 mx-2 text-brand-textFaint shrink-0">
          <span className="text-[10px] font-medium">+{marketCount}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>

      {/* Admin Button */}
      {isAdmin && !isFinished && !isLive && (
        <div className="flex items-center justify-end md:justify-center md:px-2 mb-2 md:mb-0 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              const homeStr = window.prompt(`Gola ${match.homeTeam} (shtëpi):`);
              if (homeStr === null) return;
              const awayStr = window.prompt(`Gola ${match.awayTeam} (mysafir):`);
              if (awayStr === null) return;
              const homeScore = parseInt(homeStr, 10);
              const awayScore = parseInt(awayStr, 10);
              if (Number.isNaN(homeScore) || Number.isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
                window.alert('Rezultat i pavlefshëm.');
                return;
              }
              onSettleMatch(match, homeScore, awayScore);
            }}
            disabled={isSimulating}
            className="text-[10px] bg-brand-surface2 hover:bg-brand-surfaceHover text-brand-textMuted px-2 py-1.5 rounded-lg border border-brand-border w-full md:w-auto font-semibold"
          >
            {isSimulating ? '…' : 'Settle'}
          </button>
        </div>
      )}

      {/* Odds Buttons */}
      <div className="w-full md:w-[32%] flex items-stretch gap-1.5 shrink-0">
        {matchWinnerMarket &&
          matchWinnerMarket.options.map((opt) => {
            if (opt.odds === 0) return null;
            const label = opt.id === 'DRAW' ? 'X' : opt.id === 'HOME' ? '1' : opt.id === 'AWAY' ? '2' : '';
            return (
              <div key={opt.id} onClick={() => !isFinished && onBetClick(match, matchWinnerMarket.id, opt.id)} className={getButtonClass(matchWinnerMarket.id, opt.id)}>
                <span className="text-[10px] font-medium leading-none mb-1 opacity-60">{label}</span>
                <span className="leading-none tabular-nums">{opt.odds.toFixed(2)}</span>
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default React.memo(MatchRow);
