import React from 'react';
import { Match } from '../types';

interface LiveNowWidgetProps {
  liveMatches: Match[];
  onOpenDetail: (match: Match) => void;
}

// Compact "who's live right now" card for the right rail, under the Bet Slip —
// mirrors the reference bet365-style layout without duplicating the full
// LIVE section that already lives in the main match list.
const LiveNowWidget: React.FC<LiveNowWidgetProps> = ({ liveMatches, onOpenDetail }) => {
  const preview = liveMatches.slice(0, 4);

  return (
    <div className="bg-brand-panel rounded overflow-hidden shadow-sm">
      <div className="bg-[#383838] px-3 py-2 text-xs font-bold text-white border-b border-[#444] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-accent"></span>
          </span>
          <span className="uppercase tracking-wider">Live Now</span>
        </div>
        {liveMatches.length > 0 && (
          <button
            onClick={() => document.getElementById('live-section')?.scrollIntoView({ behavior: 'smooth' })}
            className="text-[10px] text-brand-textMuted hover:text-brand-yellow font-normal normal-case"
          >
            Shiko të gjitha
          </button>
        )}
      </div>

      {preview.length === 0 ? (
        <div className="px-3 py-4 text-center text-brand-textMuted text-xs">
          Nuk ka ndeshje live për momentin.
        </div>
      ) : (
        <div className="divide-y divide-brand-divider">
          {preview.map((match) => {
            const h2h = match.markets.find((m) => m.id.endsWith('-h2h'));
            return (
              <button
                key={match.id}
                onClick={() => onOpenDetail(match)}
                className="w-full text-left px-3 py-2.5 hover:bg-[#444] transition-colors"
              >
                <div className="flex justify-between items-start gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="flex justify-between gap-2">
                      <span className="text-white text-xs font-bold truncate">{match.homeTeam}</span>
                      <span className="text-brand-yellow text-xs font-mono font-bold">{match.liveHomeScore ?? 0}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-white text-xs font-bold truncate">{match.awayTeam}</span>
                      <span className="text-brand-yellow text-xs font-mono font-bold">{match.liveAwayScore ?? 0}</span>
                    </div>
                  </div>
                  <span className="shrink-0 text-brand-accent text-[10px] font-bold animate-pulse whitespace-nowrap">
                    {match.currentMinute || 'LIVE'}
                  </span>
                </div>
                {h2h && (
                  <div className="flex gap-1">
                    {h2h.options.map((opt) => (
                      <div key={opt.id} className="flex-1 bg-[#444] rounded text-center py-1">
                        <div className="text-brand-textMuted text-[9px] leading-none mb-0.5">
                          {opt.id === 'DRAW' ? 'X' : opt.id === 'HOME' ? '1' : '2'}
                        </div>
                        <div className="text-brand-yellow text-[11px] font-bold leading-none">{opt.odds.toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default LiveNowWidget;
