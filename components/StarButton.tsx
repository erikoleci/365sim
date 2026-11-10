import React from 'react';
import { useI18n } from '../i18n';

/** The favourites star (team, league or match). Gold when on. */
const StarButton: React.FC<{ active: boolean; onClick: (e: React.MouseEvent) => void; size?: 'sm' | 'md' }> = ({ active, onClick, size = 'sm' }) => {
  const { t } = useI18n();
  return (
    <button
      onClick={onClick}
      className="shrink-0 leading-none p-1 -m-1 transition-transform active:scale-90"
      title={active ? t('Hiq nga të preferuarat') : t('Shto te të preferuarat')}
      aria-pressed={active}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" className={`${size === 'md' ? 'w-4 h-4' : 'w-3.5 h-3.5'} transition-colors ${active ? 'fill-brand-yellow stroke-brand-yellow drop-shadow-[0_0_3px_rgba(255,200,0,0.55)]' : 'fill-none stroke-brand-textMuted'}`} strokeWidth={1.5}>
        <path d="M10 1.5l2.6 5.27 5.82.85-4.21 4.1.99 5.8L10 14.9l-5.2 2.62.99-5.8-4.21-4.1 5.82-.85L10 1.5z" />
      </svg>
    </button>
  );
};

export default StarButton;
