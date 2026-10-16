import React from 'react';
import { useI18n } from '../../i18n';
import { countryFlag } from '../../utils/leagueGrouping';

interface Props {
  country: string;
  leagueTitle: string;
  count: number;
  /** Badge colours: results use a neutral badge, live uses the accent. */
  badgeClass: string;
}

/** "🏴 PREMIER LEAGUE · Anglia  12" header used inside the results and live sections. */
const LeagueSectionHeader: React.FC<Props> = ({ country, leagueTitle, count, badgeClass }) => {
  const { t } = useI18n();
  return (
    <div className="bg-[#2a2a2a] px-3 py-2 text-[11px] font-bold text-white flex items-center gap-1.5 border-b border-[#333]">
      <span aria-hidden="true">{countryFlag(country)}</span>
      <span className="uppercase tracking-wide">{leagueTitle}</span>
      <span className="text-brand-textMuted font-normal">· {t(country)}</span>
      <span className={`ml-auto text-[10px] px-1.5 rounded font-bold ${badgeClass}`}>{count}</span>
    </div>
  );
};

export default LeagueSectionHeader;
