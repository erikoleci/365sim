import React from 'react';
import { LANGUAGES, useI18n } from '../i18n';

interface LanguageSwitcherProps {
  className?: string;
}

// Two-way SQ / EN toggle. The choice is persisted by the LanguageProvider.
const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ className = '' }) => {
  const { lang, setLang, t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t('Gjuha')}
      className={`inline-flex items-center rounded border border-brand-divider overflow-hidden text-[10px] md:text-xs font-bold ${className}`}
    >
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLang(l.code)}
          aria-pressed={lang === l.code}
          title={l.name}
          className={`px-2 py-1 transition-colors ${
            lang === l.code ? 'bg-brand-yellow text-black' : 'text-brand-textMuted hover:text-white'
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
};

export default LanguageSwitcher;
