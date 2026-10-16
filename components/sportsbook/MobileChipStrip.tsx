import React from 'react';
import { useI18n } from '../../i18n';
import { ALL_LEAGUES, countryFilterKey } from '../../utils/leagueFilters';
import { countryFlag } from '../../utils/leagueGrouping';
import { ScreenActions } from './types';

interface Props extends ScreenActions {
  currentLeague: string;
  showLiveOnly: boolean;
  showResults: boolean;
  liveCount: number;
  resultsCount: number;
  leaguesByCountry: [string, string[]][];
}

const chip = (active: boolean) => `whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold ${active ? 'bg-brand-yellow text-black' : 'bg-brand-panel text-white'}`;

/** Small-screen replacement for the side menu: live, results, all, and one chip per country. */
const MobileChipStrip: React.FC<Props> = ({
  currentLeague, showLiveOnly, showResults, liveCount, resultsCount, leaguesByCountry, goToOdds, goToLeague, goToLive, goToResults,
}) => {
  const { t } = useI18n();
  return (
    <div className="lg:hidden flex gap-2 overflow-x-auto pb-2 no-scrollbar">
      <button onClick={goToLive} className={`${chip(showLiveOnly)} flex items-center gap-1.5`}>
        <span className="w-1.5 h-1.5 rounded-full bg-brand-accent animate-pulse"></span>
        LIVE {liveCount > 0 && `(${liveCount})`}
      </button>
      <button onClick={goToResults} className={chip(showResults)}>
        {t('Rezultate').toUpperCase()} {resultsCount > 0 && `(${resultsCount})`}
      </button>
      <button onClick={goToOdds} className={chip(currentLeague === ALL_LEAGUES)}>{t('Të Gjitha')}</button>
      {leaguesByCountry.map(([country, leagues]) => {
        const key = countryFilterKey(country);
        const active = currentLeague === key;
        return (
          <button key={country} onClick={() => goToLeague(key)} className={`${chip(active)} flex items-center gap-1.5`}>
            <span aria-hidden="true">{countryFlag(country)}</span>
            {t(country)}
            <span className={`text-[10px] font-normal ${active ? 'text-black/60' : 'text-brand-textMuted'}`}>{leagues.length}</span>
          </button>
        );
      })}
    </div>
  );
};

export default MobileChipStrip;
