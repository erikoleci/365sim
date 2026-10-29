import { isAdminRole } from '../utils/roles';
import React from 'react';
import { User, UserRole } from '../types';
import { useI18n } from '../i18n';
import LanguageSwitcher from './LanguageSwitcher';
import { CASINO_ENABLED } from '../utils/features';

interface NavbarProps {
  currentUser: User;
  onLogout: () => void;
  onOpenAdmin: () => void;
  currentView: 'sports' | 'casino';
  onNavigate: (view: 'sports' | 'casino') => void;
  onGoHome: () => void;
  onGoLive: () => void;
  onGoResults: () => void;
  resultsCount?: number;
  onGoSoccer: () => void;
  activeTab: 'home' | 'live' | 'results' | 'soccer';
  liveCount: number;
  // Small screens: opens the football menu drawer (shown as the first item of the second bar).
  onOpenMenu?: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ currentUser, onLogout, onOpenAdmin, currentView, onNavigate, onGoHome, onGoLive, onGoResults, onGoSoccer, activeTab, liveCount, resultsCount, onOpenMenu }) => {
  const { t } = useI18n();
  return (
    <nav className="bg-brand-header text-brand-text text-sm sticky top-0 z-50 shadow-md flex flex-col">
      {/* Top Bar */}
      <div className="w-full px-2 sm:px-4 h-14 flex justify-between items-center gap-2">
        {/* Logo & Nav Section */}
        <div className="flex items-center gap-4 md:gap-6 min-w-0">
          <div className="flex items-center gap-2">
            <div 
              className="font-bold text-lg sm:text-xl md:text-2xl tracking-tighter italic text-white cursor-pointer whitespace-nowrap"
              onClick={() => onNavigate('sports')}
            >
              bet<span className="text-brand-yellow">365</span>sim
            </div>
          </div>
          <div className="hidden md:flex gap-4 text-brand-text/90 text-xs md:text-sm font-medium">
            <span 
                onClick={() => onNavigate('sports')}
                className={`cursor-pointer transition-opacity ${currentView === 'sports' ? 'text-white opacity-100 font-bold border-b-2 border-brand-yellow' : 'hover:text-white opacity-70'}`}
            >
                SPORTS
            </span>
            {CASINO_ENABLED && (
            <span 
                onClick={() => onNavigate('casino')}
                className={`cursor-pointer transition-opacity ${currentView === 'casino' ? 'text-white opacity-100 font-bold border-b-2 border-brand-yellow' : 'hover:text-white opacity-70'}`}
            >
                CASINO
            </span>
            )}
          </div>
        </div>

        {/* User Utilities */}
        <div className="flex items-center gap-1.5 sm:gap-2 md:gap-4 text-xs shrink-0">
          {(isAdminRole(currentUser.role) || currentUser.role === UserRole.AGENT) && (
            <button 
              data-admin-toggle
              onClick={onOpenAdmin}
              className="bg-brand-headerDark hover:bg-black/20 text-brand-yellow px-2 md:px-3 py-1.5 rounded font-bold border border-brand-yellow/30 transition-colors uppercase tracking-wide text-[10px] md:text-xs whitespace-nowrap"
            >
              {currentUser.role === UserRole.AGENT ? t('Userat e Mi') : 'Admin'}
            </button>
          )}

          <LanguageSwitcher />

          <div className="flex items-center gap-2 cursor-pointer group">
             <div className="text-right leading-tight">
                <div className="text-white font-bold hidden md:block">{currentUser.name}</div>
                <div className="text-brand-yellow font-bold whitespace-nowrap">
                  {currentUser.balance.toFixed(2)} <span className="hidden md:inline">L</span>
                </div>
                <div className="text-brand-yellow font-bold whitespace-nowrap text-[11px] md:text-xs">
                  {(currentUser.balanceEur ?? 0).toFixed(2)} €
                </div>
             </div>
          </div>
          
          <button onClick={onLogout} className="text-brand-textMuted hover:text-white text-xs ml-1">
              ✕
          </button>
        </div>
      </div>
      
      {/* Secondary Nav Bar (Hidden on Mobile for cleaner look, or simplified) */}
      <div className="bg-[#282828] border-b border-brand-divider h-9 md:h-8 flex items-center gap-3 px-2 sm:px-4 w-full overflow-x-auto no-scrollbar">
         {/* Phones: the primary sections and the football menu live here (the top bar has no room). */}
         <div className="md:hidden flex items-center gap-3 shrink-0 text-[11px] font-bold uppercase">
           {currentView === 'sports' && onOpenMenu && (
             <button onClick={onOpenMenu} aria-label={t('Hap Futboll dhe ligat')} className="flex items-center gap-1 text-brand-yellow">
               <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" className="w-4 h-4 fill-current" aria-hidden="true"><path fillRule="evenodd" d="M3 5h14a1 1 0 100-2H3a1 1 0 000 2zm0 6h14a1 1 0 100-2H3a1 1 0 000 2zm0 6h14a1 1 0 100-2H3a1 1 0 000 2z" clipRule="evenodd" /></svg>
               {t('Futboll')}
             </button>
           )}
           <span onClick={() => onNavigate('sports')} className={currentView === 'sports' ? 'text-white' : 'text-brand-text/60'}>SPORTS</span>
           {CASINO_ENABLED && <span onClick={() => onNavigate('casino')} className={currentView === 'casino' ? 'text-white' : 'text-brand-text/60'}>CASINO</span>}
           <span className="w-px h-4 bg-brand-divider" aria-hidden="true" />
         </div>
         {currentView === 'sports' ? (
             <div className="flex gap-3 sm:gap-6 text-[11px] sm:text-xs text-brand-textMuted whitespace-nowrap">
                 <button onClick={onGoHome} aria-current={activeTab === 'home' ? 'page' : undefined} className={`cursor-pointer transition-colors hover:text-brand-accent ${activeTab === 'home' ? 'font-bold text-white' : ''}`}>Home</button>
                 <button onClick={onGoLive} aria-current={activeTab === 'live' ? 'page' : undefined} className={`cursor-pointer flex items-center gap-1 transition-colors hover:text-brand-accent ${activeTab === 'live' ? 'font-bold text-white' : ''}`}>
                   Live In-Play
                   {liveCount > 0 && <span className="text-[10px] bg-brand-accent text-black px-1.5 rounded font-bold">{liveCount}</span>}
                 </button>
                 <button onClick={onGoResults} aria-current={activeTab === 'results' ? 'page' : undefined} className={`cursor-pointer flex items-center gap-1 transition-colors hover:text-brand-accent ${activeTab === 'results' ? 'font-bold text-white' : ''}`}>
                   {t('Rezultate')}
                   {!!resultsCount && <span className="text-[10px] bg-[#555] text-white px-1.5 rounded font-bold">{resultsCount}</span>}
                 </button>
                 <button onClick={onGoSoccer} aria-current={activeTab === 'soccer' ? 'page' : undefined} className={`cursor-pointer transition-colors hover:text-brand-accent ${activeTab === 'soccer' ? 'font-bold text-white' : ''}`}>Soccer</button>
             </div>
         ) : (
             <div className="flex gap-3 sm:gap-6 text-[11px] sm:text-xs text-brand-textMuted whitespace-nowrap">
                 <span className="text-white font-bold cursor-pointer">Lobby</span>
                 <span className="hover:text-brand-yellow cursor-pointer">Slots</span>
                 <span className="hover:text-brand-yellow cursor-pointer">Live Casino</span>
                 <span className="hover:text-brand-yellow cursor-pointer">Table Games</span>
             </div>
         )}
      </div>
    </nav>
  );
};

export default Navbar;