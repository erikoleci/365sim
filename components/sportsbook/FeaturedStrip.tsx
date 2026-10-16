import React from 'react';
import FeaturedMatchCard from '../FeaturedMatchCard';
import { Match } from '../../types';

interface Props {
  matches: Match[];
  onBetClick: (match: Match, marketId: string, selectionId: string, boosted?: boolean) => void;
  onOpenDetail: (match: Match) => void;
  selectedIds: string[];
  /** Plain text title, or null when `onTitleClick` renders a button instead. */
  title?: string;
  /** A clickable title (the league name) that opens that league. */
  linkedTitle?: { label: string; onClick: () => void };
}

const TITLE = 'w-full bg-[#2f2f2f] px-3 py-2 text-xs font-bold text-white border-b border-[#444] uppercase tracking-wider';

/** A horizontally scrolling strip of featured match cards under a title. */
const FeaturedStrip: React.FC<Props> = ({ matches, onBetClick, onOpenDetail, selectedIds, title, linkedTitle }) => (
  <div className="bg-brand-panel rounded overflow-hidden shadow-sm">
    {linkedTitle ? (
      <button onClick={linkedTitle.onClick} className={`${TITLE} text-left hover:text-brand-yellow`}>{linkedTitle.label}</button>
    ) : (
      <div className={TITLE}>{title}</div>
    )}
    <div className="flex gap-2 overflow-x-auto p-2.5 custom-scrollbar snap-x snap-mandatory">
      {matches.map((match) => (
        <FeaturedMatchCard key={match.id} match={match} onBetClick={onBetClick} onOpenDetail={onOpenDetail} selectedIds={selectedIds} />
      ))}
    </div>
  </div>
);

export default FeaturedStrip;
