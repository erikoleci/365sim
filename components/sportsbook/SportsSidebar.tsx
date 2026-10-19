import React, { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { ALL_LEAGUES, FAVORITES, countryFromFilter, isCountryFilter } from '../../utils/leagueFilters';
import { leagueCountry } from '../../utils/leagueGrouping';
import LeagueMenu from './LeagueMenu';
import { ScreenActions } from './types';

interface Props extends ScreenActions {
  currentLeague: string;
  showLiveOnly: boolean;
  showResults: boolean;
  liveCount: number;
  resultsCount: number;
  leaguesByCountry: [string, string[]][];
  leagueText: (key: string) => string;
  // The drawer can be controlled by the parent (the Navbar owns the button that opens it).
  drawerOpen?: boolean;
  onDrawerOpenChange?: (open: boolean) => void;
}

/**
 * The football menu: a permanent column on large screens, and the same menu as a drawer from the
 * left (opened by a floating button) on small ones, so both always show exactly the same list.
 */
const SportsSidebar: React.FC<Props> = (props) => {
  const { t } = useI18n();
  const { currentLeague, drawerOpen, onDrawerOpenChange } = props;
  const [internalOpen, setInternalOpen] = useState(false);
  const isDrawerOpen = drawerOpen ?? internalOpen;
  const setIsDrawerOpen = (open: boolean) => (onDrawerOpenChange ? onDrawerOpenChange(open) : setInternalOpen(open));

  // Which country group is expanded: follows the selected league (picking one from the chip strip,
  // or going home, opens/closes the right group) while the person can still open others to browse.
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null);
  useEffect(() => {
    if (currentLeague === ALL_LEAGUES || currentLeague === FAVORITES) setExpandedCountry(null);
    else if (isCountryFilter(currentLeague)) setExpandedCountry(countryFromFilter(currentLeague));
    else setExpandedCountry(leagueCountry(currentLeague));
  }, [currentLeague]);

  const { drawerOpen: _d, onDrawerOpenChange: _c, ...menuProps } = props;
  const menu = (onNavigated?: () => void) => (
    <LeagueMenu {...menuProps} expandedCountry={expandedCountry} onToggleCountry={setExpandedCountry} onNavigated={onNavigated} />
  );

  return (
    <>
      <aside className="hidden lg:block w-60 xl:w-72 flex-shrink-0">
        <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto custom-scrollbar bg-brand-panel rounded border border-[#444] shadow-sm">
          <div className="bg-[#383838] px-3 py-3 text-xs font-bold text-brand-text border-b border-[#444] uppercase sticky top-0 z-10">
            <span>{t('Sportet')}</span>
          </div>
          {menu()}
        </div>
      </aside>

      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" onClick={() => setIsDrawerOpen(false)}>
          <div className="w-72 max-w-[85vw] h-full bg-brand-panel overflow-y-auto custom-scrollbar shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="bg-[#383838] px-3 py-3 text-xs font-bold text-brand-text border-b border-[#444] uppercase flex justify-between items-center sticky top-0 z-10">
              <span>{t('Sportet')}</span>
              <button onClick={() => setIsDrawerOpen(false)} className="text-brand-textMuted hover:text-white text-lg leading-none px-1">✕</button>
            </div>
            {menu(() => setIsDrawerOpen(false))}
          </div>
        </div>
      )}
    </>
  );
};

export default SportsSidebar;
