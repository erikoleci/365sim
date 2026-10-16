import React from 'react';
import { Match } from '../../types';
import { useI18n } from '../../i18n';
import { leagueCountry } from '../../utils/leagueGrouping';
import LeagueSectionHeader from './LeagueSectionHeader';
import MatchRowList from './MatchRowList';
import { MatchRowActions } from './types';

interface Props {
  sections: { league: string; matches: Match[] }[];
  total: number;
  hasSearch: boolean;
  leagueText: (key: string) => string;
  actions: MatchRowActions;
  onClose: () => void;
}

/** "Rezultate": matches that finished in the last 48 hours, newest first, grouped by league. */
const ResultsSection: React.FC<Props> = ({ sections, total, hasSearch, leagueText, actions, onClose }) => {
  const { t } = useI18n();
  return (
    <div id="results-section" className="bg-brand-panel rounded overflow-hidden shadow-sm border border-[#444] scroll-mt-4">
      <div className="bg-[#2a2a2a] px-3 py-2 text-xs font-bold text-white border-b border-[#444] flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <span className="uppercase tracking-wider">{t('Rezultate · 48 orët e fundit')}</span>
          {total > 0 && <span className="text-[10px] bg-[#555] text-white px-1.5 rounded font-bold">{total}</span>}
        </div>
        <button onClick={onClose} className="text-[10px] text-brand-textMuted hover:text-white uppercase tracking-wide">
          {t('Kthehu te Kryefaqja ✕')}
        </button>
      </div>
      {total === 0 ? (
        <div className="text-center text-brand-textMuted text-xs py-8 px-4">
          {hasSearch ? t('Nuk ka ndeshje të mbaruara në 48 orët e fundit për këtë kërkim.') : t('Nuk ka ndeshje të mbaruara në 48 orët e fundit.')}
        </div>
      ) : (
        sections.map(({ league, matches }) => (
          <div key={league}>
            <LeagueSectionHeader country={leagueCountry(league)} leagueTitle={leagueText(league)} count={matches.length} badgeClass="bg-[#555] text-white" />
            <MatchRowList matches={matches} actions={actions} />
          </div>
        ))
      )}
    </div>
  );
};

export default ResultsSection;
