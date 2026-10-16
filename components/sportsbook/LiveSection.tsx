import React from 'react';
import { Match } from '../../types';
import { useI18n } from '../../i18n';
import LeagueSectionHeader from './LeagueSectionHeader';
import MatchRowList from './MatchRowList';
import { MatchRowActions } from './types';

interface Props {
  sections: { country: string; league: string; matches: Match[] }[];
  total: number;
  leagueText: (key: string) => string;
  actions: MatchRowActions;
  onClose: () => void;
}

/** "Live Tani": every live match, grouped by league. Shown even when empty (that is the point). */
const LiveSection: React.FC<Props> = ({ sections, total, leagueText, actions, onClose }) => {
  const { t } = useI18n();
  return (
    <div id="live-section" className="bg-brand-panel rounded overflow-hidden shadow-sm border border-brand-accent/30 scroll-mt-4">
      <div className="bg-[#2a1f1f] px-3 py-2 text-xs font-bold text-white border-b border-[#444] flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-accent"></span>
          </span>
          <span className="text-brand-accent uppercase tracking-wider">{t('Live Tani')}</span>
          {total > 0 && <span className="text-[10px] bg-brand-accent text-black px-1.5 rounded font-bold">{total}</span>}
        </div>
        <button onClick={onClose} className="text-[10px] text-brand-textMuted hover:text-white uppercase tracking-wide">
          {t('Kthehu te Kryefaqja ✕')}
        </button>
      </div>
      {total === 0 ? (
        <div className="text-center text-brand-textMuted text-xs py-8 px-4">{t('Nuk ka asnjë ndeshje live aktualisht.')}</div>
      ) : (
        sections.map(({ country, league, matches }) => (
          <div key={league}>
            <LeagueSectionHeader country={country} leagueTitle={leagueText(league)} count={matches.length} badgeClass="bg-brand-accent text-black" />
            <MatchRowList matches={matches} actions={actions} />
          </div>
        ))
      )}
    </div>
  );
};

export default LiveSection;
