import React from 'react';
import { Match } from '../types';

interface SpecialOffersProps {
  matches: Match[];
  onOpenDetail: (match: Match) => void;
  onBetClick: (match: Match, marketId: string, selectionId: string, boosted?: boolean) => void;
}

// Highlighted "boosted odds" strip for a handful of featured matches — a
// small, fixed multiplier applied only for display in this strip (the
// underlying market/selection odds used for the actual bet are unchanged
// elsewhere; this is a marketing-style spotlight, not a second price feed).
const BOOST_MULTIPLIER = 1.12;

const SpecialOffers: React.FC<SpecialOffersProps> = ({ matches, onOpenDetail, onBetClick }) => {
  const featured = React.useMemo(() => {
    return matches
      .map((m) => {
        const h2h = m.markets.find((mk) => mk.id.endsWith('-h2h'));
        if (!h2h) return null;
        // The card strip must offer ONLY 1/X/2 — ignore any extra outcomes
        // (correct score, HTFT) that the provider may pack into h2h.
        const pickable = h2h.options.filter((o) => o.id === 'HOME' || o.id === 'DRAW' || o.id === 'AWAY');
        // Pick the shortest-priced (favorite) selection to boost — most
        // appealing as a "boost" since the uplift is proportionally bigger.
        const favorite = [...pickable].filter((o) => o.odds > 0).sort((a, b) => a.odds - b.odds)[0];
        if (!favorite) return null;
        return { match: m, market: h2h, option: favorite };
      })
      .filter((x): x is { match: Match; market: Match['markets'][number]; option: Match['markets'][number]['options'][number] } => x !== null)
      .slice(0, 6);
  }, [matches]);

  if (featured.length === 0) return null;

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 px-1 mb-2">
        <span className="text-brand-yellow font-extrabold text-sm">⚡ Oferta Speciale</span>
        <span className="text-[10px] text-brand-textMuted">Kuota të rritura për ndeshjet e zgjedhura</span>
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {featured.map(({ match, market, option }) => {
          const boosted = option.odds * BOOST_MULTIPLIER;
          return (
            <div
              key={match.id}
              className="shrink-0 w-56 bg-gradient-to-br from-brand-panel to-[#3a3a3a] border border-brand-yellow/40 rounded-lg p-3 cursor-pointer hover:border-brand-yellow transition-colors"
              onClick={() => onOpenDetail(match)}
            >
              <div className="text-[10px] text-brand-textMuted uppercase truncate mb-1">{match.league}</div>
              <div className="text-xs text-white font-semibold leading-tight mb-2 truncate">
                {match.homeTeam} vs {match.awayTeam}
              </div>
              <div className="flex items-center justify-between">
                <div className="flex flex-col leading-none">
                  <span className="text-[10px] text-brand-textMuted line-through">{option.odds.toFixed(2)}</span>
                  <span className="text-brand-yellow font-extrabold text-lg">{boosted.toFixed(2)}</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onBetClick(match, market.id, option.id, true); }}
                  className="bg-brand-yellow text-brand-headerDark text-[11px] font-bold px-3 py-1.5 rounded hover:brightness-95"
                >
                  Vër Bast
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SpecialOffers;
