import React from 'react';
import { useI18n } from '../../i18n';
import { COMING_SOON_SPORTS_SHORT } from './sports';

/** Top-of-home quick switcher: football active, the rest honestly disabled (no data for them yet). */
const SportIconStrip: React.FC = () => {
  const { t } = useI18n();
  return (
    <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar">
      <button className="shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded bg-[#333] border-b-2 border-brand-yellow text-white">
        <span className="text-lg leading-none" aria-hidden="true">⚽</span>
        <span className="text-[9px] uppercase tracking-wide">{t('Futboll')}</span>
      </button>
      {COMING_SOON_SPORTS_SHORT.map(([icon, name]) => (
        <div key={name} className="shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded text-brand-textMuted/40 cursor-not-allowed" title={t('Së shpejti')}>
          <span className="text-lg leading-none opacity-50" aria-hidden="true">{icon}</span>
          <span className="text-[9px] uppercase tracking-wide">{t(name)}</span>
        </div>
      ))}
    </div>
  );
};

export default SportIconStrip;
