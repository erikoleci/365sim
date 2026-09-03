import React, { useState, useMemo } from 'react';
import { Match, MatchStatus } from '../types';
import LivePitch from './LivePitch';

interface MatchDetailProps {
  match: Match;
  onClose: () => void;
  onBetClick: (match: Match, marketId: string, selectionId: string) => void;
  selectedIds: string[];
}

const MatchDetail: React.FC<MatchDetailProps> = ({ match, onClose, onBetClick, selectedIds }) => {
  const isFinished = match.status === MatchStatus.FINISHED;
  const [activeTab, setActiveTab] = useState<string>('All');

  const CATEGORY_LABELS: Record<string, string> = {
    All: 'Kryesore',
    main: '45/90',
    goals: 'Golat',
    btts: 'Gol/JoGol',
    handicap: 'Azian',
    cards: 'Kartona',
    corners: 'Korne',
    scorers: 'Golashenues',
    other: 'Speciale',
  };

  // Extract unique categories
  const categories = useMemo(() => {
    const cats = new Set(match.markets.map(m => m.category || 'other'));
    return ['All', ...Array.from(cats).sort()];
  }, [match]);

  const filteredMarkets = match.markets.filter(m => activeTab === 'All' || m.category === activeTab);

  const getButtonClass = (marketId: string, selectionId: string) => {
    const uniqueId = `${match.id}-${marketId}-${selectionId}`;
    const isSelected = selectedIds.includes(uniqueId);
    
    // Standard odds block style
    const base = "flex items-center justify-center gap-2 py-3 px-2 cursor-pointer transition-colors text-center";
    if (isFinished) return `${base} opacity-50 cursor-default bg-[#4a4a4a] text-brand-textMuted`;
    if (isSelected) return `${base} bg-brand-yellow text-brand-headerDark font-bold`;
    return `${base} bg-[#4a4a4a] hover:bg-[#565656] text-brand-text`;
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
             {match.status === MatchStatus.LIVE && (
               <div className="mb-4">
                 <LivePitch match={match} />
               </div>
             )}
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
                    {CATEGORY_LABELS[cat] || cat}
                </button>
            ))}
         </div>
      </div>

      {/* Markets Content */}
      <div className="p-2 space-y-2 overflow-y-auto flex-1 bg-[#282828]">
        {filteredMarkets.map(market => {
            const cols = Math.min(market.options.length, 3) || 1;
            return (
            <div key={market.id} className="overflow-hidden mb-2">
                <div className="bg-brand-header px-3 py-2 text-xs font-bold text-white">
                    {market.name}
                </div>
                <div
                    className="grid gap-px bg-brand-bg"
                    style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                >
                    {market.options.map(opt => {
                        const isSelected = selectedIds.includes(`${match.id}-${market.id}-${opt.id}`);
                        return (
                        <div
                            key={opt.id}
                            onClick={() => !isFinished && onBetClick(match, market.id, opt.id)}
                            className={getButtonClass(market.id, opt.id)}
                        >
                            <span className={`text-xs ${isSelected ? 'text-brand-headerDark' : 'text-brand-text'}`}>{opt.name}</span>
                            <span className={`font-bold text-sm ${isSelected ? 'text-brand-headerDark' : 'text-brand-yellow'}`}>{opt.odds.toFixed(2)}</span>
                        </div>
                        );
                    })}
                </div>
            </div>
            );
        })}
      </div>
    </div>
  );
};

export default MatchDetail;