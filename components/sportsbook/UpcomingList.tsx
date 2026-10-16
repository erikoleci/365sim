import React from 'react';
import { useI18n } from '../../i18n';
import { countryFlag } from '../../utils/leagueGrouping';
import { dateKeyLabel } from '../../utils/dateLabels';
import { CountryGroup, groupMatchesByDate } from '../../utils/matchGrouping';
import LoadMoreSentinel from '../LoadMoreSentinel';
import MatchRowList from './MatchRowList';
import { MatchRowActions } from './types';

interface Props {
  groups: CountryGroup[];
  hiddenRows: number;
  onLoadMore: () => void;
  leagueText: (key: string) => string;
  actions: MatchRowActions;
}

/** Upcoming matches grouped country -> league -> day, like the reference sites. */
const UpcomingList: React.FC<Props> = ({ groups, hiddenRows, onLoadMore, leagueText, actions }) => {
  const { t, lang } = useI18n();
  return (
    <>
      {groups.map(([country, leagues]) => (
        <div key={country} className="bg-brand-panel rounded overflow-hidden shadow-sm">
          <div className="bg-[#2f2f2f] px-3 py-2 text-xs font-bold text-white border-b border-[#444] flex items-center gap-2 uppercase tracking-wider">
            <span aria-hidden="true">{countryFlag(country)}</span>
            <span>{t(country)}</span>
            <span className="ml-auto text-[10px] text-brand-textMuted font-normal">{t('{n} ligë', { n: leagues.length })}</span>
          </div>
          {leagues.map(([league, leagueMatches]) => (
            <div key={league} className="border-b border-brand-divider last:border-b-0">
              <div className="bg-[#383838] px-3 py-2 text-xs font-bold text-white flex items-center gap-2">
                <span className="w-1 h-3 rounded-full bg-brand-yellow"></span>
                <span>{leagueText(league)}</span>
                <span className="ml-auto text-[10px] text-brand-textMuted font-normal">{leagueMatches.length}</span>
              </div>
              {groupMatchesByDate(leagueMatches).map(([dateKey, dayMatches]) => (
                <div key={dateKey}>
                  <div className="bg-[#2b2b2b] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 border-b border-brand-bg/20">
                    <span className="text-brand-yellow">{dateKeyLabel(dateKey, t, lang)}</span>
                    <span className="text-brand-textMuted font-normal normal-case">{t('{n} ndeshje', { n: dayMatches.length })}</span>
                  </div>
                  <MatchRowList matches={dayMatches} actions={actions} />
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      {hiddenRows > 0 && <LoadMoreSentinel remaining={hiddenRows} onMore={onLoadMore} />}
    </>
  );
};

export default UpcomingList;
