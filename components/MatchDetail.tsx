import React, { useState, useMemo } from 'react';
import { Match, MatchStatus } from '../types';

interface MatchDetailProps {
  match: Match;
  onClose: () => void;
  onBetClick: (match: Match, marketId: string, selectionId: string) => void;
  selectedIds: string[];
}

const MatchDetail: React.FC<MatchDetailProps> = ({ match, onClose, onBetClick, selectedIds }) => {
  const isFinished = match.status === MatchStatus.FINISHED;
  const [activeTab, setActiveTab] = useState<string>('All');

  // Extract unique categories
  const categories = useMemo(() => {
    const cats = new Set(match.markets.map(m => m.category || 'Other'));
    return ['All', ...Array.from(cats).sort()];
  }, [match]);

  const filteredMarkets = match.markets.filter(m => activeTab === 'All' || m.category === activeTab);

  const getButtonClass = (marketId: string, selectionId: string) => {
    const uniqueId = `${match.id}-${marketId}-${selectionId}`;
    const isSelected = selectedIds.includes(uniqueId);
    
    // Standard odds block style
    const base = "flex justify-between items-center p-3 cursor-pointer transition-colors border-b border-brand-divider last:border-0";
    if (isFinished) return `${base} opacity-50 cursor-default bg-brand-bg text-brand-textMuted`;
    if (isSelected) return `${base} bg-brand-text text-brand-headerDark font-bold`;
    return `${base} bg-brand-panel hover:bg-[#444] text-brand-text`;
  };

  return (
    <div className="bg-brand-bg text-brand-text h-full flex flex-col">
      {/* Match Header */}
      <div className="bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] bg-brand-headerDark/30 p-6 relative border-b border-brand-divider">
        <button onClick={onClose} className="absolute top-4 left-4 text-brand-textMuted hover:text-white text-xs font-bold flex items-center gap-1">
          ‹ Soccer
        </button>
        
        <div className="mt-4 text-center">
             <div className="text-xs text-brand-textMuted uppercase tracking-wider mb-2">{match.league}</div>
             <div className="flex justify-center items-center gap-8">
                 <div className="text-2xl font-bold text-white">{match.homeTeam}</div>
                 <div className="text-3xl text-brand-yellow font-mono">
                    {isFinished ? `${match.score?.home} - ${match.score?.away}` : 'v'}
                 </div>
                 <div className="text-2xl font-bold text-white">{match.awayTeam}</div>
             </div>
             {isFinished && (
                <div className="mt-2 text-xs text-brand-accent">
                    FT | HT: {match.score?.htHome}-{match.score?.htAway} | Corners: {match.score?.homeCorners}-{match.score?.awayCorners}
                </div>
             )}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="bg-[#333] border-b border-brand-divider overflow-x-auto no-scrollbar">
         <div className="flex">
            {categories.map(cat => (
                <button
                    key={cat}
                    onClick={() => setActiveTab(cat)}
                    className={`px-4 py-3 text-xs font-bold uppercase transition-colors whitespace-nowrap ${
                        activeTab === cat 
                        ? 'text-brand-yellow border-b-2 border-brand-yellow bg-[#3a3a3a]' 
                        : 'text-brand-textMuted hover:text-white hover:bg-[#3a3a3a]'
                    }`}
                >
                    {cat}
                </button>
            ))}
         </div>
      </div>

      {/* Markets Content */}
      <div className="p-2 space-y-2 overflow-y-auto flex-1 bg-[#282828]">
        {filteredMarkets.map(market => (
            <div key={market.id} className="bg-brand-panel rounded overflow-hidden mb-2">
                <div className="bg-[#383838] px-3 py-2 text-xs font-bold text-brand-text border-b border-[#444] flex justify-between">
                    <span>{market.name}</span>
                    <span className="text-[10px] text-brand-textMuted bg-black/20 px-1.5 py-0.5 rounded">Cash Out</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 divide-x divide-brand-bg/20">
                    {market.options.map(opt => (
                        <div 
                            key={opt.id} 
                            onClick={() => !isFinished && onBetClick(match, market.id, opt.id)}
                            className={getButtonClass(market.id, opt.id)}
                        >
                            <span className="text-xs text-brand-textMuted">{opt.name}</span>
                            <span className="font-bold text-brand-yellow text-sm">{opt.odds.toFixed(2)}</span>
                        </div>
                    ))}
                </div>
            </div>
        ))}
      </div>
    </div>
  );
};

export default MatchDetail;