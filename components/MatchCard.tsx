import React from 'react';
import { Match, MatchStatus } from '../types';

interface MatchRowProps {
  match: Match;
  onBetClick: (match: Match, marketId: string, selectionId: string) => void;
  onOpenDetail: (match: Match) => void;
  isAdmin: boolean;
  onSettleMatch: (match: Match) => void;
  isSimulating: boolean;
  selectedIds: string[]; // Array of `${matchId}-${marketId}-${selectionId}`
}

const MatchRow: React.FC<MatchRowProps> = ({ match, onBetClick, onOpenDetail, isAdmin, onSettleMatch, isSimulating, selectedIds }) => {
  const isFinished = match.status === MatchStatus.FINISHED;
  const isLive = match.status === MatchStatus.LIVE;
  
  // Extract 1X2 market for the main card view
  const matchWinnerMarket = match.markets.find(m => m.id === 'm_res');
  // Handle Sports with no Draw (e.g. Tennis) by checking market options length
  const isTwoWay = matchWinnerMarket?.options.length === 2;

  const getButtonClass = (marketId: string, selectionId: string) => {
    const uniqueId = `${match.id}-${marketId}-${selectionId}`;
    const isSelected = selectedIds.includes(uniqueId);
    
    // Grey block style standard for main odds
    const base = "flex-1 flex flex-col justify-center items-center h-full min-h-[40px] rounded cursor-pointer transition-colors text-xs font-bold mx-[1px]";
    
    if (isFinished) return `${base} opacity-40 cursor-default bg-brand-panel text-brand-textMuted`;
    if (isSelected) return `${base} bg-white text-brand-headerDark`;
    return `${base} bg-[#444] hover:bg-[#555] text-brand-yellow`;
  };

  const matchDate = new Date(match.startTime);
  const isToday = new Date().toDateString() === matchDate.toDateString();

  return (
    <div className={`flex flex-col md:flex-row border-b border-brand-divider bg-brand-panel hover:bg-[#3f3f3f] transition-colors group py-2 px-3 ${isLive ? 'border-l-4 border-l-brand-accent' : ''}`}>
      {/* Time & Teams Info */}
      <div className="flex-1 flex items-center cursor-pointer" onClick={() => onOpenDetail(match)}>
        <div className="text-xs text-brand-textMuted w-12 text-center flex flex-col items-center justify-center">
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
        
        <div className="flex-1 ml-3 border-l border-brand-divider pl-3 py-1">
           <div className={`flex justify-between items-center mb-1 ${isFinished ? 'opacity-80' : ''}`}>
             <span className="text-brand-text font-bold text-sm">{match.homeTeam}</span>
             {(isFinished || isLive) && (
                <span className={`font-bold ${isLive ? 'text-brand-yellow' : 'text-brand-accent'}`}>
                    {isLive ? (match.liveHomeScore ?? 0) : match.score?.home}
                </span>
             )}
           </div>
           <div className={`flex justify-between items-center ${isFinished ? 'opacity-80' : ''}`}>
             <span className="text-brand-text font-bold text-sm">{match.awayTeam}</span>
             {(isFinished || isLive) && (
                <span className={`font-bold ${isLive ? 'text-brand-yellow' : 'text-brand-accent'}`}>
                    {isLive ? (match.liveAwayScore ?? 0) : match.score?.away}
                </span>
             )}
           </div>
           
           {/* Grounding Source Indicator */}
           {match.sourceUrls && match.sourceUrls.length > 0 && (
             <div className="mt-1 flex gap-1">
                <a 
                  href={match.sourceUrls[0]} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  onClick={(e) => e.stopPropagation()}
                  className="text-[9px] text-brand-textMuted hover:text-brand-yellow bg-black/20 px-1 rounded flex items-center gap-1"
                >
                  Source Info ↗
                </a>
             </div>
           )}
        </div>
        
        {/* Market Count Indicator */}
        <div className="mx-4 text-xs text-brand-textMuted hover:text-white flex items-center">
             <span className="mr-1">{match.markets.length}</span>
             <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
             </svg>
        </div>
      </div>

      {/* Admin Quick Action */}
      {isAdmin && !isFinished && !isLive && (
         <div className="flex items-center px-2 border-r border-brand-divider mr-2">
            <button 
                onClick={(e) => { e.stopPropagation(); onSettleMatch(match); }}
                disabled={isSimulating}
                className="text-[10px] bg-brand-headerDark hover:bg-brand-header text-white px-2 py-1 rounded border border-brand-header"
            >
                {isSimulating ? '...' : 'Sim Result'}
            </button>
         </div>
      )}

      {/* Main 1X2 Odds Columns */}
      <div className={`w-full md:w-[35%] flex items-stretch gap-1 pt-2 md:pt-0`}>
        {matchWinnerMarket && matchWinnerMarket.options.map(opt => {
            // Filter out 'Draw' if odds are 0 (e.g. for Basketball/Tennis moneyline)
            if (opt.odds === 0) return null;
            return (
             <div 
                key={opt.id}
                onClick={() => !isFinished && onBetClick(match, matchWinnerMarket.id, opt.id)}
                className={getButtonClass(matchWinnerMarket.id, opt.id)}
            >
                <span className="text-brand-textMuted text-[10px] font-normal leading-none mb-0.5">{opt.name === 'Draw' ? 'Draw' : opt.name}</span>
                <span className="leading-none">{opt.odds.toFixed(2)}</span>
            </div>
            )
        })}
      </div>
    </div>
  );
};

export default React.memo(MatchRow);