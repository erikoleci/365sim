import React from 'react';
import { Match } from '../../types';
import { useI18n } from '../../i18n';
import MatchRowList from './MatchRowList';
import { MatchRowActions } from './types';

/** "★ Të preferuarat": the coming and live matches of the user's starred teams and matches, on top of the home page. */
const FavoritesSection: React.FC<{ matches: Match[]; actions: MatchRowActions }> = ({ matches, actions }) => {
  const { t } = useI18n();
  return (
    <div className="bg-brand-panel rounded overflow-hidden shadow-sm border border-brand-yellow/30">
      <div className="px-3 py-2 text-xs font-bold text-brand-yellow border-b border-[#444] flex items-center gap-2 uppercase tracking-wider" style={{ background: 'linear-gradient(90deg, rgba(255,200,0,0.14), rgba(255,200,0,0.02))' }}>
        <svg viewBox="0 0 20 20" className="w-3.5 h-3.5 fill-brand-yellow" aria-hidden="true"><path d="M10 1.5l2.6 5.27 5.82.85-4.21 4.1.99 5.8L10 14.9l-5.2 2.62.99-5.8-4.21-4.1 5.82-.85L10 1.5z" /></svg>
        <span>{t('Të preferuarat')}</span>
        <span className="ml-auto text-[10px] bg-brand-yellow text-black px-1.5 rounded font-bold">{matches.length}</span>
      </div>
      <MatchRowList matches={matches} actions={actions} />
    </div>
  );
};

export default FavoritesSection;
