import React from 'react';
import { Match, MatchStatus } from '../types';

interface MatchRowProps {
  match: Match;
  onBetClick: (match: Match, marketId: string, selectionId: string) => void;
  onOpenDetail: (match: Match) => void;
  isAdmin: boolean;
  onSettleMatch: (match: Match) => void;
  isSimulating: boolean;
  selectedIds: string[]; 
}

const MatchRow: React.FC<MatchRowProps> = ({ match, onBetClick, onOpenDetail, isAdmin, onSettleMatch, isSimulating, selectedIds }) => {
  const isFinished = match.status === MatchStatus.FINISHED;
  const isLive = match.status === MatchStatus.LIVE;
  const matchWinnerMarket = match.markets.find(m => m.id === 'm_res');

  const getButtonClass = (marketId: string, selectionId: string) => {
    const uniqueId = `${match.id}-${marketId}-${selectionId}`;
    const isSelected = selectedIds.includes(uniqueId);
    const base = "flex-1 flex flex-col justify-center items-center h-10 md:h-full min-h-[40px] rounded cursor-pointer transition-colors text-xs font-bold mx-[1px]";
    if (isFinished) return `${base} opacity-40 cursor-default bg-brand-panel text-brand-textMuted`;
    if (isSelected) return `${base} bg-white text-brand-headerDark`;
    return `${base} bg-[#444] hover:bg-[#555] text-brand-yellow`;
  };

  const matchDate = new Date(match.startTime);
  const isToday = new Date().toDateString() === matchDate.toDateString();

  return (
    <div className={`flex flex-col md:flex-row border-b border-brand-divider bg-brand-panel hover:bg-[#3f3f3f] transition-colors group py-3 px-3 ${isLive ? 'border-l-4 border-l-brand-accent' : ''}`}>
      
      {/* Time & Teams Info */}
      <div className="flex-1 flex items-center cursor-pointer mb-3 md:mb-0" onClick={() => onOpenDetail(match)}>
        <div className="text-xs text-brand-textMuted w-10 text-center flex flex-col items-center justify-center shrink-0">
           {isLive ? (
               <div className="text-brand-accent animate-pulse font-bold">
                   {match.currentMinute || "LIVE"}
               </div>
           ) : (
               <>
                <div className={isToday ? "text-brand-text" : "text-brand-textMuted"}>
                    {matchDate.getHours()}:{matchDate.getMinutes().toString().padStart(2, '0')}
                </div>
                {!isToday && <div className="text-[10px]">{matchDate.getDate()}/{matchDate.getMonth() + 1}</div>}
               </>
           )}
        </div>
        
        <div className="flex-1 ml-3 border-l border-brand-divider pl-3 py-1 overflow-hidden">
           <div className="flex flex-col gap-1.5">
               {/* Home Team */}
               <div className={`flex justify-between items-center ${isFinished ? 'opacity-80' : ''}`}>
                 <span className="text-brand-text font-bold text-sm truncate pr-2">{match.homeTeam}</span>
                 {(isFinished || isLive) && (
                    <span className={`font-mono font-bold text-lg w-8 text-right leading-none ${isLive ? 'text-brand-yellow drop-shadow-md' : 'text-brand-accent'}`}>
                        {isLive ? (match.liveHomeScore ?? 0) : match.score?.home}
                    </span>
                 )}
               </div>
               
               {/* Away Team */}
               <div className={`flex justify-between items-center ${isFinished ? 'opacity-80' : ''}`}>
                 <span className="text-brand-text font-bold text-sm truncate pr-2">{match.awayTeam}</span>
                 {(isFinished || isLive) && (
                    <span className={`font-mono font-bold text-lg w-8 text-right leading-none ${isLive ? 'text-brand-yellow drop-shadow-md' : 'text-brand-accent'}`}>
                        {isLive ? (match.liveAwayScore ?? 0) : match.score?.away}
                    </span>
                 )}
               </div>
           </div>
        </div>
        
        {/* Detail Chevron */}
        <div className="mx-2 text-brand-textMuted">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
        </div>
      </div>

      {/* Admin Button */}
      {isAdmin && !isFinished && !isLive && (
         <div className="flex items-center justify-end md:justify-center md:px-2 md:border-r md:border-brand-divider mb-2 md:mb-0">
            <button 
                onClick={(e) => { e.stopPropagation(); onSettleMatch(match); }}
                disabled={isSimulating}
                className="text-[10px] bg-brand-headerDark hover:bg-brand-header text-white px-2 py-1 rounded border border-brand-header w-full md:w-auto"
            >
                {isSimulating ? '...' : 'Sim Result'}
            </button>
         </div>
      )}

      {/* Odds Buttons */}
      <div className={`w-full md:w-[35%] flex items-stretch gap-1`}>
        {matchWinnerMarket && matchWinnerMarket.options.map(opt => {
            if (opt.odds === 0) return null;
            return (
             <div 
                key={opt.id}
                onClick={() => !isFinished && onBetClick(match, matchWinnerMarket.id, opt.id)}
                className={getButtonClass(matchWinnerMarket.id, opt.id)}
            >
                <span className="text-brand-textMuted text-[10px] font-normal leading-none mb-0.5">{opt.name === 'Draw' ? 'X' : opt.name === match.homeTeam ? '1' : '2'}</span>
                <span className="leading-none">{opt.odds.toFixed(2)}</span>
            </div>
            )
        })}
      </div>
    </div>
  );
};

export default React.memo(MatchRow);