import React from 'react';

export interface BannerInfo { id: number; kind: 'GOAL' | 'GOAL_DISALLOWED' | 'YELLOW_CARD' | 'RED_CARD'; team: string; score?: string; minute?: string }

// A short strip on top of the match page for a goal, a disallowed goal or a card. It appears for ~3 s
// (the parent clears it), sits over the content (fixed height, no layout shift) and never blocks a tap.
const STYLE: Record<BannerInfo['kind'], { bg: string; icon: string; label: string }> = {
  GOAL: { bg: 'bg-green-600', icon: '⚽', label: 'GOL!' },
  GOAL_DISALLOWED: { bg: 'bg-gray-600', icon: '🚫', label: 'GOL I ANULUAR' },
  YELLOW_CARD: { bg: 'bg-yellow-500 text-black', icon: '🟨', label: 'KARTON I VERDHË' },
  RED_CARD: { bg: 'bg-red-600', icon: '🟥', label: 'KARTON I KUQ' },
};

const EventBanner: React.FC<{ banner: BannerInfo | null }> = ({ banner }) => {
  if (!banner) return null;
  const s = STYLE[banner.kind];
  return (
    <div key={banner.id} className="pointer-events-none fixed top-2 inset-x-0 z-[70] flex justify-center px-3" aria-live="polite">
      <div className={`event-banner ${s.bg} text-white font-bold rounded-full shadow-2xl px-4 py-2 text-sm flex items-center gap-2 max-w-full`}>
        <span>{s.icon}</span>
        <span className="uppercase tracking-wide">{s.label}</span>
        <span className="truncate">{banner.team}</span>
        {banner.minute ? <span className="tabular-nums opacity-90">{banner.minute}</span> : null}
        {banner.score ? <span className="tabular-nums bg-black/25 rounded px-1.5">{banner.score}</span> : null}
      </div>
    </div>
  );
};

export default EventBanner;
