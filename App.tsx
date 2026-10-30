import { isAdminRole, isSuperAdminRole } from './utils/roles';
import React, { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import Navbar from './components/Navbar';
import MatchDetail from './components/MatchDetail';
import OwnerDashboard from './components/OwnerDashboard';
import AgentUsersPanel from './components/AgentUsersPanel';
import Login from './components/Login';
import CasinoHub from './components/CasinoHub';
import BetSlipPanels from './components/sportsbook/BetSlipPanels';
import SlipBlockedToast from './components/SlipBlockedToast';
import SportsbookHome from './components/sportsbook/SportsbookHome';
import SportsSidebar from './components/sportsbook/SportsSidebar';
import { MatchRowActions } from './components/sportsbook/types';
import { User, UserRole } from './types';
import * as api from './services/api';
import { withBalance } from './utils/withBalance';
import { ALL_LEAGUES } from './utils/leagueFilters';
import { useAuth } from './hooks/useAuth';
import { useFavorites } from './hooks/useFavorites';
import { useMatchesFeed } from './hooks/useMatchesFeed';
import { useMatchDetail } from './hooks/useMatchDetail';
import { useLiveSocket } from './hooks/useLiveSocket';
import { useScreenNav } from './hooks/useScreenNav';
import { useSportsbookViews } from './hooks/useSportsbookViews';
import { useBetSlip } from './hooks/useBetSlip';
import { useMyBets } from './hooks/useMyBets';
import { useAdminActions } from './hooks/useAdminActions';
import { useDismissOnOutsideClick } from './hooks/useDismissOnOutsideClick';

const ROW_SLICE = 60; // match rows drawn per step of the "load more" list

const FullScreenSpinner: React.FC = () => (
  <div className="min-h-screen bg-brand-bg flex items-center justify-center">
    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-yellow"></div>
  </div>
);

/**
 * App shell: decides what to show (login, owner dashboard, or the sportsbook/casino) and wires the
 * hooks together. The state and behaviour live in hooks/, the screens in components/.
 */
const App: React.FC = () => {
  const { currentUser, setCurrentUser, authChecked } = useAuth();
  const [currentView, setCurrentView] = useState<'sports' | 'casino'>('sports');
  const [showAdmin, setShowAdmin] = useState(false);
  // Football menu drawer on small screens (opened from the Navbar, rendered by SportsSidebar).
  const [menuDrawerOpen, setMenuDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState('ALL'); // 'ALL' or 'YYYY-MM-DD' (Albania's calendar)
  const [navTab, setNavTab] = useState<'home' | 'soccer'>('home'); // which top tab was chosen last
  const [rowBudget, setRowBudget] = useState(ROW_SLICE);

  const nav = useScreenNav();
  const sportsEnabled = !!currentUser && currentView === 'sports';

  const feed = useMatchesFeed(sportsEnabled, currentUser?.id ?? null);
  const { detailMatch, setDetailMatchFull } = useMatchDetail(nav.detailMatchId, feed.matches);
  const { myBets, loadMyBets, reset: resetMyBets } = useMyBets(currentUser);
  useLiveSocket({ enabled: sportsEnabled, setMatches: feed.setMatches, setDetailMatchFull, reloadMatches: feed.loadMatches, matches: feed.matches, onMatchEnded: loadMyBets });

  const { favoriteTeams, favoriteLeagues, toggleFavorite } = useFavorites(currentUser);

  const slip = useBetSlip({
    currentUser,
    setCurrentUser,
    onPlaced: useCallback(async () => { nav.setIsMobileSlipOpen(false); await loadMyBets(); }, [nav.setIsMobileSlipOpen, loadMyBets]),
  });

  const [casinoAllowed, setCasinoAllowed] = useState(false);
  useEffect(() => {
    if (!currentUser || isAdminRole(currentUser.role)) { setCasinoAllowed(false); return; }
    api.casinoAccess().then((r) => setCasinoAllowed(r.allowed)).catch(() => setCasinoAllowed(false));
  }, [currentUser?.id, currentUser?.role]);
  const applyBalance = useCallback((balance: number, balanceEur?: number) => setCurrentUser((u) => withBalance(u, balance, balanceEur)), [setCurrentUser]);
  const admin = useAdminActions({
    currentUser,
    setCurrentUser,
    panelOpen: showAdmin,
    reloadMatches: feed.loadMatches,
    reloadMyBets: loadMyBets,
    applyBalance,
  });

  const views = useSportsbookViews({
    matches: feed.matches,
    leagueNames: feed.leagueNames,
    searchQuery,
    currentLeague: nav.currentLeague,
    selectedDate,
    rowBudget,
    favoriteTeams,
    favoriteLeagues,
  });

  // A new filter starts the list from its first slice again.
  useEffect(() => { setRowBudget(ROW_SLICE); }, [nav.currentLeague, selectedDate, nav.showLiveOnly, searchQuery]);

  // The agent panel closes on a click outside <main> (the admin toggle button is exempt).
  const mainRef = useRef<HTMLElement | null>(null);
  useDismissOnOutsideClick(showAdmin, mainRef, useCallback(() => setShowAdmin(false), []), '[data-admin-toggle]');

  const handleLogout = () => {
    api.logout();
    setCurrentUser(null);
    slip.reset();
    resetMyBets();
    admin.reset();
    feed.reset();
    nav.resetForLogout();
    setShowAdmin(false);
    setCurrentView('sports');
  };

  const onToggleFavoriteTeam = useCallback((team: string) => toggleFavorite('TEAM', team), [toggleFavorite]);
  const openMatchById = nav.openMatch;
  const rowActions: MatchRowActions = useMemo(() => ({
    onBetClick: slip.toggleSelection,
    onOpenDetail: (match) => openMatchById(match.id),
    isAdmin: isSuperAdminRole(currentUser?.role), // manual settle / simulate on a match: super admin only
    onSettleMatch: admin.settleMatch,
    simulatingMatchId: admin.simulatingMatchId,
    selectedIds: slip.selectedIds,
    favoriteTeams,
    onToggleFavoriteTeam,
  }), [slip.toggleSelection, slip.selectedIds, openMatchById, currentUser?.role, admin.settleMatch, admin.simulatingMatchId, favoriteTeams, onToggleFavoriteTeam]);

  if (!authChecked) return <FullScreenSpinner />;
  if (!currentUser) return <Login onAuthenticated={(user: User) => setCurrentUser(user)} />;

  // The owner (ADMIN) gets a separate, read-first page and never the sportsbook/casino shell, so
  // the owner has no way to place a bet or play. Reports first; management is one tab away.
  if (isAdminRole(currentUser.role)) {
    return (
      <OwnerDashboard
        currentUser={currentUser}
        onLogout={handleLogout}
        users={admin.adminUsers}
        allBets={admin.adminAllBets}
        onCreateUser={admin.createUser}
        onDeleteUser={admin.deleteUser}
        onAddCredit={admin.addCredit}
        onResetPassword={admin.resetPassword}
        onCancelBet={admin.cancelBet}
        onSetBalance={applyBalance}
      />
    );
  }

  const goHome = () => {
    startTransition(() => { setNavTab('home'); nav.goToOdds(); setSelectedDate('ALL'); });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const goSoccer = () => {
    startTransition(() => { setNavTab('soccer'); nav.goToOdds(); });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const activeTab = nav.showLiveOnly ? 'live' : nav.showResults ? 'results' : nav.currentLeague === ALL_LEAGUES ? navTab : 'soccer';

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text flex flex-col font-sans selection:bg-brand-header selection:text-white pb-16 md:pb-0">
      <Navbar
        currentUser={currentUser}
        onLogout={handleLogout}
        onOpenAdmin={() => setShowAdmin(!showAdmin)}
        currentView={currentView}
        casinoEnabled={casinoAllowed}
        onNavigate={setCurrentView}
        activeTab={activeTab}
        onGoHome={goHome}
        onGoLive={nav.goToLive}
        onGoSoccer={goSoccer}
        onGoResults={nav.goToResults}
        resultsCount={views.resultsList.length}
        liveCount={views.liveMatches.length}
        onOpenMenu={() => setMenuDrawerOpen(true)}
      />

      <div className="flex-1 flex w-full pt-4 px-2 lg:px-4 gap-2 relative">
        {currentView === 'sports' && (
          <SportsSidebar
            currentLeague={nav.currentLeague}
            showLiveOnly={nav.showLiveOnly}
            showResults={nav.showResults}
            liveCount={views.liveMatches.length}
            resultsCount={views.resultsList.length}
            leaguesByCountry={views.leaguesByCountry}
            leagueText={views.leagueText}
            goToOdds={nav.goToOdds}
            goToLeague={nav.goToLeague}
            goToLive={nav.goToLive}
            goToResults={nav.goToResults}
            drawerOpen={menuDrawerOpen}
            onDrawerOpenChange={setMenuDrawerOpen}
          />
        )}

        <main ref={mainRef} className="flex-1 min-w-0 mb-20 md:mb-0">
          {showAdmin && currentUser.role === UserRole.AGENT ? (
            <AgentUsersPanel currentUser={currentUser} onBalanceChanged={applyBalance} />
          ) : casinoAllowed && currentView === 'casino' ? (
            <CasinoHub userBalance={currentUser.balance} userBalanceEur={currentUser.balanceEur ?? 0} onSetBalance={applyBalance} />
          ) : detailMatch ? (
            <MatchDetail
              // A full remount when the viewed match changes: otherwise the ticking clocks of
              // MatchDetail/LivePitch keep counting from the PREVIOUS match's minute.
              key={detailMatch.id}
              match={detailMatch}
              leagueLabel={views.leagueText(detailMatch.league)}
              onClose={nav.goBack}
              onBetClick={slip.toggleSelection}
              selectedIds={slip.selectedIds}
            />
          ) : (
            <SportsbookHome
              currentLeague={nav.currentLeague}
              showLiveOnly={nav.showLiveOnly}
              showResults={nav.showResults}
              closeLive={() => { nav.setShowLiveOnly(false); nav.setShowResults(false); }}
              closeResults={() => nav.setShowResults(false)}
              goToOdds={nav.goToOdds}
              goToLeague={nav.goToLeague}
              goToLive={nav.goToLive}
              goToResults={nav.goToResults}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              dateOptions={views.dateOptions}
              isLoading={feed.isLoading}
              loadError={feed.loadError}
              onRetry={() => feed.loadMatches()}
              favoriteTeams={favoriteTeams}
              leaguesByCountry={views.leaguesByCountry}
              liveMatches={views.liveMatches}
              liveLeagueSections={views.liveLeagueSections}
              resultsList={views.resultsList}
              resultsSections={views.resultsSections}
              topLeagueMatches={views.topLeagueMatches}
              featuredMatches={views.featuredMatches}
              todayMatches={views.todayMatches}
              upcomingByCountry={views.upcomingByCountry}
              visibleGroups={views.visibleGroups}
              hiddenRows={views.hiddenRows}
              dateFallbackActive={views.dateFallbackActive}
              onLoadMore={() => setRowBudget((n) => n + ROW_SLICE)}
              searchSuggestions={views.searchSuggestions}
              leagueText={views.leagueText}
              leagueLabel={views.leagueLabel}
              actions={rowActions}
              openMatchById={openMatchById}
            />
          )}
        </main>

        <SlipBlockedToast list={slip.blockedNotice?.list ?? null} onDismiss={slip.dismissBlockedNotice} />

        {currentView === 'sports' && (
          <BetSlipPanels
            selections={slip.selections}
            myBets={myBets}
            userBalance={currentUser.balance}
            userBalanceEur={currentUser.balanceEur ?? 0}
            betError={slip.betError}
            isMobileSlipOpen={nav.isMobileSlipOpen}
            onOpenMobileSlip={() => nav.setIsMobileSlipOpen(true)}
            onCloseMobileSlip={nav.goBack}
            onRemoveSelection={slip.removeSelection}
            onClearAll={slip.clearSelections}
            onPlaceBet={slip.placeBet}
            onCancelBet={admin.cancelBet}
          />
        )}
      </div>
    </div>
  );
};

export default App;
