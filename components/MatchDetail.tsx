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
  const isLive = match.status === MatchStatus.LIVE;
  const [activeTab, setActiveTab] = useState<string>('All');

  const categories = useMemo(() => {
    const cats = new Set(match.markets.map((m) => m.category || 'Other'));
    return ['All', ...Array.from(cats).sort()];
  }, [match]);

  const filteredMarkets = match.markets.filter((m) => activeTab === 'All' || m.category === activeTab);

  const getButtonClass = (marketId: string, selectionId: string) => {
    const uniqueId = `${match.id}-${marketId}-${selectionId}`;
    const isSelected = selectedIds.includes(uniqueId);
    const base = 'flex justify-between items-center gap-2 p-3 cursor-pointer transition-colors rounded-lg border';
    if (isFinished) return `${base} opacity-40 cursor-default bg-brand-surface border-brand-border text-brand-textFaint`;
    if (isSelected) return `${base} bg-brand-accent text-brand-bg border-brand-accent font-bold`;
    return `${base} bg-brand-surface2 hover:bg-brand-surfaceHover border-brand-border text-brand-text`;
  };

  return (
    <div className="bg-brand-bg text-brand-text h-full flex flex-col">
      {/* Match Header */}
      <div className="bg-brand-header p-6 relative border-b border-brand-border">
        <button onClick={onClose} className="absolute top-4 left-4 text-brand-textMuted hover:text-brand-text text-xs font-semibold flex items-center gap-1 transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          Futboll
        </button>

        <div className="mt-4 text-center">
          <div className="text-xs text-brand-textFaint uppercase tracking-wider mb-3 flex items-center justify-center gap-2">
            {match.league}
            {isLive && (
              <span className="flex items-center gap-1 text-brand-live font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-live animate-pulseLive" /> {match.currentMinute || 'LIVE'}
              </span>
            )}
          </div>
          <div className="flex justify-center items-center gap-6 md:gap-8">
            <div className="text-lg md:text-2xl font-bold text-brand-text text-right flex-1">{match.homeTeam}</div>
            <div className="text-2xl md:text-3xl text-brand-accent font-mono font-bold tabular-nums shrink-0">
              {isFinished || isLive ? `${isLive ? match.liveHomeScore ?? 0 : match.score?.home} - ${isLive ? match.liveAwayScore ?? 0 : match.score?.away}` : 'vs'}
            </div>
            <div className="text-lg md:text-2xl font-bold text-brand-text text-left flex-1">{match.awayTeam}</div>
          </div>
          {isFinished && (
            <div className="mt-3 text-xs text-brand-textMuted">
              E përfunduar &middot; Pjesa I: {match.score?.htHome}-{match.score?.htAway} &middot; Kënde: {match.score?.homeCorners}-{match.score?.awayCorners}
            </div>
          )}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="bg-brand-header border-b border-brand-border overflow-x-auto no-scrollbar">
        <div className="flex px-2 gap-1 py-2">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveTab(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide transition-colors whitespace-nowrap ${
                activeTab === cat ? 'bg-brand-accentSoft text-brand-accent' : 'text-brand-textMuted hover:text-brand-text hover:bg-brand-surfaceHover'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Markets Content */}
      <div className="p-3 space-y-3 overflow-y-auto flex-1 bg-brand-bg">
        {filteredMarkets.map((market) => (
          <div key={market.id} className="bg-brand-surface rounded-xl overflow-hidden border border-brand-border">
            <div className="px-3 py-2.5 text-xs font-semibold text-brand-text border-b border-brand-border">{market.name}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5 p-1.5">
              {market.options.map((opt) => (
                <div key={opt.id} onClick={() => !isFinished && onBetClick(match, market.id, opt.id)} className={getButtonClass(market.id, opt.id)}>
                  <span className="text-xs truncate">{opt.name}</span>
                  <span className="font-bold text-sm tabular-nums shrink-0">{opt.odds.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {filteredMarkets.length === 0 && <div className="text-center text-brand-textFaint text-sm mt-10">Nuk ka tregje në këtë kategori.</div>}
      </div>
    </div>
  );
};

export default MatchDetail;
