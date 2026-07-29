import React from 'react';
import { User, UserRole } from '../types';

interface NavbarProps {
  currentUser: User;
  onLogout: () => void;
  onOpenAdmin: () => void;
  currentView: 'sports' | 'casino';
  onNavigate: (view: 'sports' | 'casino') => void;
  onGoHome: () => void;
  onGoLive: () => void;
  liveCount: number;
}

const Navbar: React.FC<NavbarProps> = ({ currentUser, onLogout, onOpenAdmin, currentView, onNavigate, onGoHome, onGoLive, liveCount }) => {
  return (
    <nav className="bg-brand-header text-brand-text text-sm sticky top-0 z-50 shadow-md flex flex-col">
      {/* Top Bar */}
      <div className="max-w-[1450px] mx-auto w-full px-4 h-14 flex justify-between items-center">
        {/* Logo & Nav Section */}
        <div className="flex items-center gap-4 md:gap-6">
          <div 
            className="font-bold text-xl md:text-2xl tracking-tighter italic text-white cursor-pointer"
            onClick={() => onNavigate('sports')}
          >
            bet<span className="text-brand-yellow">365</span>sim
          </div>
          <div className="flex gap-4 text-brand-text/90 text-xs md:text-sm font-medium">
            <span 
                onClick={() => onNavigate('sports')}
                className={`cursor-pointer transition-opacity ${currentView === 'sports' ? 'text-white opacity-100 font-bold border-b-2 border-brand-yellow' : 'hover:text-white opacity-70'}`}
            >
                SPORTS
            </span>
            <span 
                onClick={() => onNavigate('casino')}
                className={`cursor-pointer transition-opacity ${currentView === 'casino' ? 'text-white opacity-100 font-bold border-b-2 border-brand-yellow' : 'hover:text-white opacity-70'}`}
            >
                CASINO
            </span>
          </div>
        </div>

        {/* User Utilities */}
        <div className="flex items-center gap-2 md:gap-4 text-xs">
          {currentUser.role === UserRole.ADMIN && (
            <button 
              onClick={onOpenAdmin}
              className="hidden md:block bg-brand-headerDark hover:bg-black/20 text-brand-yellow px-3 py-1.5 rounded font-bold border border-brand-yellow/30 transition-colors uppercase tracking-wide"
            >
              Admin
            </button>
          )}

          <div className="flex items-center gap-2 cursor-pointer group">
             <div className="text-right leading-tight">
                <div className="text-white font-bold hidden md:block">{currentUser.name}</div>
                <div className="text-brand-yellow font-bold">{currentUser.balance.toFixed(2)} <span className="hidden md:inline">L</span></div>
             </div>
             <img src={currentUser.avatar} className="w-8 h-8 rounded-full border-2 border-brand-headerDark" alt="avatar" />
          </div>
          
          <button onClick={onLogout} className="text-brand-textMuted hover:text-white text-xs ml-1">
              ✕
          </button>
        </div>
      </div>
      
      {/* Secondary Nav Bar (Hidden on Mobile for cleaner look, or simplified) */}
      <div className="bg-[#282828] border-b border-brand-divider h-8 flex items-center px-4 max-w-[1450px] mx-auto w-full overflow-x-auto no-scrollbar">
         {currentView === 'sports' ? (
             <div className="flex gap-6 text-xs text-brand-textMuted whitespace-nowrap">
                 <span onClick={onGoHome} className="hover:text-brand-accent cursor-pointer font-bold text-white">Home</span>
                 <span onClick={onGoLive} className="hover:text-brand-accent cursor-pointer flex items-center gap-1">
                   Live In-Play
                   {liveCount > 0 && <span className="text-[10px] bg-brand-accent text-black px-1.5 rounded font-bold">{liveCount}</span>}
                 </span>
                 <span className="text-brand-accent cursor-default font-bold">Soccer</span>
                 <span className="opacity-40 cursor-not-allowed" title="Së shpejti">Tennis</span>
                 <span className="opacity-40 cursor-not-allowed" title="Së shpejti">Basketball</span>
             </div>
         ) : (
             <div className="flex gap-6 text-xs text-brand-textMuted whitespace-nowrap">
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