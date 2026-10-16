import React from 'react';
import { Match } from '../../types';
import { useI18n } from '../../i18n';
import { ALL_LEAGUES, FAVORITES } from '../../utils/leagueFilters';
import { leagueCountry } from '../../utils/leagueGrouping';
import { DateOption } from '../../utils/dateLabels';
import { CountryGroup } from '../../utils/matchGrouping';
import Breadcrumb from './Breadcrumb';
import DateStrip from './DateStrip';
import FeaturedStrip from './FeaturedStrip';
import LiveSection from './LiveSection';
import MobileChipStrip from './MobileChipStrip';
import ResultsSection from './ResultsSection';
import SearchBar from './SearchBar';
import SportIconStrip from './SportIconStrip';
import TodaySection from './TodaySection';
import UpcomingList from './UpcomingList';
import { MatchRowActions, ScreenActions } from './types';

interface Props extends ScreenActions {
  // screen
  currentLeague: string;
  showLiveOnly: boolean;
  showResults: boolean;
  closeLive: () => void;
  closeResults: () => void;
  // filters
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedDate: string;
  onSelectDate: (value: string) => void;
  dateOptions: DateOption[];
  // data
  isLoading: boolean;
  loadError: string | null;
  onRetry: () => void;
  favoriteTeams: Set<string>;
  leaguesByCountry: [string, string[]][];
  liveMatches: Match[];
  liveLeagueSections: { country: string; league: string; matches: Match[] }[];
  resultsList: Match[];
  resultsSections: { league: string; matches: Match[] }[];
  topLeagueMatches: { key: string | null; list: Match[] };
  featuredMatches: Match[];
  todayMatches: Match[];
  upcomingByCountry: CountryGroup[];
  visibleGroups: CountryGroup[];
  hiddenRows: number;
  dateFallbackActive: boolean;
  onLoadMore: () => void;
  searchSuggestions: { teams: string[]; leagues: string[]; matches: Match[] };
  leagueText: (key: string) => string;
  leagueLabel: (key: string) => string;
  actions: MatchRowActions;
  openMatchById: (matchId: string) => void;
}

const PANEL_MESSAGE = 'flex flex-col justify-center items-center h-64 bg-brand-panel rounded border border-brand-divider';

/** The sportsbook's main column: filters on top, then results / live / highlights / upcoming matches. */
const SportsbookHome: React.FC<Props> = (p) => {
  const { t } = useI18n();
  const isRoot = !p.showLiveOnly && !p.showResults && p.currentLeague === ALL_LEAGUES;
  const isDrilledDown = p.showLiveOnly || p.showResults || (p.currentLeague !== ALL_LEAGUES && p.currentLeague !== FAVORITES);
  const openMatch = p.actions.onOpenDetail;

  const body = () => {
    if (p.loadError) {
      return (
        <div className={`${PANEL_MESSAGE} gap-3`}>
          <div className="text-brand-textMuted text-sm text-center px-4">{t(p.loadError)}</div>
          <button onClick={p.onRetry} className="bg-brand-yellow hover:bg-yellow-400 text-brand-bg font-bold px-4 py-2 rounded text-sm">
            {t('Provo Përsëri')}
          </button>
        </div>
      );
    }
    if (p.isLoading) {
      return (
        <div className={PANEL_MESSAGE}>
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-yellow mb-4"></div>
          <div className="text-brand-textMuted text-xs animate-pulse">{t('Duke ngarkuar ndeshjet...')}</div>
        </div>
      );
    }
    return (
      <>
        {p.showResults && (
          <ResultsSection sections={p.resultsSections} total={p.resultsList.length} hasSearch={!!p.searchQuery} leagueText={p.leagueText} actions={p.actions} onClose={p.closeResults} />
        )}
        {p.showLiveOnly && (
          <LiveSection sections={p.liveLeagueSections} total={p.liveMatches.length} leagueText={p.leagueText} actions={p.actions} onClose={p.closeLive} />
        )}

        {!p.showLiveOnly && !p.showResults && p.dateFallbackActive && (
          <div className="bg-[#3a3320] border border-brand-yellow/40 text-brand-yellow text-xs rounded px-3 py-2 flex items-center justify-between gap-2">
            <span>{t('Nuk ka ndeshje për datën e zgjedhur — po shfaqen ndeshjet e ardhshme, të ndara sipas datës.')}</span>
            <button onClick={() => p.onSelectDate('ALL')} className="shrink-0 underline hover:text-white uppercase text-[10px] tracking-wide">
              {t('Të gjitha datat')}
            </button>
          </div>
        )}

        {isRoot && p.topLeagueMatches.key && p.topLeagueMatches.list.length > 0 && (
          <FeaturedStrip
            matches={p.topLeagueMatches.list}
            onBetClick={p.actions.onBetClick}
            onOpenDetail={openMatch}
            selectedIds={p.actions.selectedIds}
            linkedTitle={{
              label: `${t(leagueCountry(p.topLeagueMatches.key))} ${p.leagueText(p.topLeagueMatches.key)}`,
              onClick: () => p.goToLeague(p.topLeagueMatches.key!),
            }}
          />
        )}
        {isRoot && p.featuredMatches.length > 0 && (
          <FeaturedStrip title={t('Ndeshjet Kryesore')} matches={p.featuredMatches} onBetClick={p.actions.onBetClick} onOpenDetail={openMatch} selectedIds={p.actions.selectedIds} />
        )}
        {isRoot && p.todayMatches.length > 0 && <TodaySection matches={p.todayMatches} actions={p.actions} />}

        {!p.showLiveOnly && !p.showResults && (
          p.upcomingByCountry.length === 0 ? (
            <div className={`${PANEL_MESSAGE} text-center px-6`}>
              <div className="text-brand-textMuted text-sm mb-2">{t('Asnjë ndeshje e disponueshme.')}</div>
              <div className="text-brand-textMuted text-xs opacity-70">
                {p.selectedDate !== 'ALL'
                  ? t('Nuk ka ndeshje të planifikuara për këtë datë në këtë kampionat. Provo "Të gjitha" ose një datë tjetër.')
                  : t('Ky kampionat mund të jetë aktualisht pa ndeshje të planifikuara (pushim sezonal) — provo përsëri më vonë, ose zgjidh një kampionat tjetër nga lista.')}
              </div>
            </div>
          ) : (
            <UpcomingList groups={p.visibleGroups} hiddenRows={p.hiddenRows} onLoadMore={p.onLoadMore} leagueText={p.leagueText} actions={p.actions} />
          )
        )}
      </>
    );
  };

  return (
    <div className="space-y-3 md:space-y-4">
      {isRoot && <SportIconStrip />}
      {isDrilledDown && (
        <Breadcrumb showLiveOnly={p.showLiveOnly} showResults={p.showResults} currentLeague={p.currentLeague} leagueText={p.leagueText} onHome={p.goToOdds} />
      )}
      <MobileChipStrip
        currentLeague={p.currentLeague} showLiveOnly={p.showLiveOnly} showResults={p.showResults}
        liveCount={p.liveMatches.length} resultsCount={p.resultsList.length} leaguesByCountry={p.leaguesByCountry}
        goToOdds={p.goToOdds} goToLeague={p.goToLeague} goToLive={p.goToLive} goToResults={p.goToResults}
      />
      <DateStrip options={p.dateOptions} selected={p.selectedDate} onSelect={p.onSelectDate} />
      <SearchBar
        query={p.searchQuery} onQueryChange={p.onSearchChange} suggestions={p.searchSuggestions}
        favoriteTeams={p.favoriteTeams} leagueText={p.leagueText} leagueLabel={p.leagueLabel}
        onPickLeague={p.goToLeague} onPickMatch={p.openMatchById}
      />
      {body()}
    </div>
  );
};

export default SportsbookHome;
