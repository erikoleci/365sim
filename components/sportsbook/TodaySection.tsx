import React, { useState } from 'react';
import { Match } from '../../types';
import { useI18n } from '../../i18n';
import MatchRowList from './MatchRowList';
import { MatchRowActions } from './types';

interface Props {
  matches: Match[];
  actions: MatchRowActions;
}

/** "Ndeshjet Sot (n)": collapsible list of today's matches, live ones first. */
const TodaySection: React.FC<Props> = ({ matches, actions }) => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="bg-brand-panel rounded overflow-hidden shadow-sm">
      <button
        onClick={() => setIsOpen((o) => !o)}
        className="w-full bg-[#2f2f2f] px-3 py-2 text-xs font-bold text-white border-b border-[#444] uppercase tracking-wider flex items-center justify-between"
      >
        <span>{t('Ndeshjet Sot ({n})', { n: matches.length })}</span>
        <span className={`transition-transform ${isOpen ? '' : '-rotate-90'}`}>▾</span>
      </button>
      {isOpen && <MatchRowList matches={matches} actions={actions} />}
    </div>
  );
};

export default TodaySection;
