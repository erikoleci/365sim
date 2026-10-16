import React from 'react';
import { useI18n } from '../../i18n';
import { ALL_LEAGUES, FAVORITES, countryFilterKey } from '../../utils/leagueFilters';
import { countryFlag } from '../../utils/leagueGrouping';
import { COMING_SOON_SPORTS } from './sports';
import { ScreenActions } from './types';

interface Props extends ScreenActions {
  currentLeague: string;
  showLiveOnly: boolean;
  showResults: boolean;
  liveCount: number;
  resultsCount: number;
  leaguesByCountry: [string, string[]][];
  expandedCountry: string | null;
  onToggleCountry: (country: string | null) => void;
  leagueText: (key: string) => string;
  /** Called after any navigation (the small-screen drawer closes itself). */
  onNavigated?: () => void;
}

const ROW = 'w-full text-left px-3 border-b border-brand-bg/10 flex items-center transition-colors';
const ACTIVE = 'bg-[#444] text-white font-bold';
const ACTIVE_BAR = `${ACTIVE} border-l-4 border-l-brand-yellow`;

const LiveDot = () => (
  <span className="relative flex h-2 w-2">
    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75"></span>
    <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-accent"></span>
  </span>
);

/** The "Sportet" menu body: football shortcuts, countries with their leagues, upcoming sports. */
const LeagueMenu: React.FC<Props> = ({
  currentLeague, showLiveOnly, showResults, liveCount, resultsCount, leaguesByCountry, expandedCountry,
  onToggleCountry, leagueText, goToOdds, goToLeague, goToLive, goToResults, onNavigated,
}) => {
  const { t } = useI18n();
  const go = (action: () => void) => () => { action(); onNavigated?.(); };

  return (
    <>
      <div className="w-full px-3 py-2.5 border-b border-brand-bg/10 flex items-center gap-2.5 bg-[#444] text-white font-bold">
        <span aria-hidden="true" className="text-base leading-none">⚽</span>
        <span className="uppercase tracking-wider">{t('Futboll')}</span>
        {liveCount > 0 && <span className="text-[10px] bg-brand-accent text-black px-1.5 rounded font-bold">{liveCount}</span>}
      </div>

      <div className="bg-[#2b2b2b] border-b border-[#444]">
        <button
          onClick={go(goToOdds)}
          className={`${ROW} py-3 gap-2 uppercase tracking-wider hover:bg-[#444] hover:text-white ${currentLeague === ALL_LEAGUES && !showLiveOnly ? ACTIVE_BAR : ''}`}
        >
          <span>{t('Të gjitha ndeshjet')}</span>
        </button>
        <button
          onClick={go(() => goToLeague(FAVORITES))}
          className={`${ROW} py-3 gap-2 hover:bg-[#444] hover:text-white ${currentLeague === FAVORITES ? ACTIVE_BAR : ''}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" className="w-3.5 h-3.5 fill-brand-yellow"><path d="M10 1.5l2.6 5.27 5.82.85-4.21 4.1.99 5.8L10 14.9l-5.2 2.62.99-5.8-4.21-4.1 5.82-.85L10 1.5z" /></svg>
          <span className="uppercase tracking-wider">{t('Të Preferuarat')}</span>
        </button>
        <button onClick={go(goToLive)} className={`${ROW} py-3 gap-2 ${showLiveOnly ? ACTIVE : ''}`}>
          <LiveDot />
          <span className="uppercase tracking-wider">In-Play / Live</span>
          {liveCount > 0 && <span className="text-[10px] bg-brand-accent text-black px-1.5 rounded font-bold">{liveCount}</span>}
        </button>
        <button onClick={go(goToResults)} className={`${ROW} py-3 gap-2 ${showResults ? ACTIVE : ''}`}>
          <span className="uppercase tracking-wider">{t('Rezultate')}</span>
          {resultsCount > 0 && <span className="text-[10px] bg-[#555] text-white px-1.5 rounded font-bold">{resultsCount}</span>}
        </button>

        <div className="flex flex-col text-xs text-brand-textMuted">
          {leaguesByCountry.map(([country, leagues]) => {
            const isOpen = expandedCountry === country;
            const countryKey = countryFilterKey(country);
            const countryActive = currentLeague === countryKey;
            return (
              <div key={country}>
                <div className={`w-full flex items-stretch bg-[#333] border-b border-brand-bg/10 ${countryActive ? 'border-l-4 border-l-brand-yellow' : ''}`}>
                  <button
                    onClick={go(() => goToLeague(countryKey))}
                    className={`flex-1 min-w-0 text-left px-3 py-2 hover:bg-[#3a3a3a] text-brand-text font-bold uppercase text-[10px] tracking-wider transition-colors ${countryActive ? 'text-white bg-[#444]' : ''}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden="true">{countryFlag(country)}</span>
                      <span className="truncate">{t(country)}</span>
                      <span className="ml-auto text-[9px] text-brand-textMuted font-normal shrink-0">{leagues.length}</span>
                    </span>
                  </button>
                  <button
                    onClick={() => onToggleCountry(isOpen ? null : country)}
                    className="px-3 text-brand-textMuted hover:text-white hover:bg-[#3a3a3a] transition-colors"
                    aria-label={isOpen ? t('Mbyll ligat e {country}', { country: t(country) }) : t('Hap ligat e {country}', { country: t(country) })}
                  >
                    {isOpen ? '▾' : '▸'}
                  </button>
                </div>
                {isOpen && (
                  <button
                    onClick={go(() => goToLeague(countryKey))}
                    className={`px-3 py-2 pl-6 w-full text-left text-[10px] uppercase tracking-wider hover:bg-[#444] hover:text-white transition-colors border-b border-brand-bg/10 ${countryActive ? ACTIVE : 'text-brand-yellow'}`}
                  >
                    {t('Të gjitha ligat ({n})', { n: leagues.length })}
                  </button>
                )}
                {isOpen && leagues.map((league) => (
                  <button
                    key={league}
                    onClick={go(() => goToLeague(league))}
                    className={`px-3 py-2.5 pl-6 hover:bg-[#444] hover:text-white transition-colors border-b border-brand-bg/10 flex justify-between items-center text-left w-full ${currentLeague === league ? ACTIVE_BAR : ''}`}
                  >
                    <span className="truncate">{leagueText(league)}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {COMING_SOON_SPORTS.map(([icon, name]) => (
        <div key={name} className="w-full text-left px-3 py-2.5 border-b border-brand-bg/10 flex items-center gap-2.5 text-brand-textMuted/50 cursor-not-allowed select-none">
          <span aria-hidden="true" className="text-base leading-none opacity-50">{icon}</span>
          <span className="uppercase tracking-wider">{t(name)}</span>
          <span className="ml-auto text-[9px] normal-case font-normal shrink-0">{t('Së shpejti')}</span>
        </div>
      ))}
    </>
  );
};

export default LeagueMenu;
