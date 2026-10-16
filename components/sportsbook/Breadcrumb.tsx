import React from 'react';
import { useI18n } from '../../i18n';
import { countryFromFilter, isCountryFilter } from '../../utils/leagueFilters';
import { leagueCountry } from '../../utils/leagueGrouping';

interface Props {
  showLiveOnly: boolean;
  showResults: boolean;
  currentLeague: string;
  leagueText: (key: string) => string;
  onHome: () => void;
}

/** "Futboll / <Country> - <League>" context bar, shown once the person drilled into something. */
const Breadcrumb: React.FC<Props> = ({ showLiveOnly, showResults, currentLeague, leagueText, onHome }) => {
  const { t } = useI18n();
  const bold = 'text-brand-text font-semibold';
  return (
    <div className="bg-[#2a2a2a] border border-brand-divider rounded px-3 py-2 text-xs text-brand-textMuted flex items-center justify-between gap-2">
      <span className="truncate">
        <span className={bold}>{t('Futboll')}</span>
        {showLiveOnly ? (
          <span> / <span className="text-brand-accent font-semibold">Live InPlay</span></span>
        ) : showResults ? (
          <span> / <span className={bold}>{t('Rezultate (48 orët e fundit)')}</span></span>
        ) : isCountryFilter(currentLeague) ? (
          <span> / <span className={bold}>{t(countryFromFilter(currentLeague))}</span></span>
        ) : (
          <span> / <span className={bold}>{t(leagueCountry(currentLeague))} - {leagueText(currentLeague)}</span></span>
        )}
      </span>
      <button onClick={onHome} className="shrink-0 text-[10px] uppercase tracking-wide text-brand-textMuted hover:text-white">
        {t('← Kryefaqja')}
      </button>
    </div>
  );
};

export default Breadcrumb;
