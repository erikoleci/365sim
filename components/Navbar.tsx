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
      {/* Top Bar — mirrors the 24/7-style layout: logo left, Sport/Live tabs center, Join/Hyr right */}
      <div className="max-w-[1450px] mx-auto w-full px-4 h-14 flex justify-between items-center">
        {/* Logo */}
        <div
          className="font-extrabold text-xl md:text-2xl tracking-tight text-brand-yellow cursor-pointer"
          onClick={() => { onNavigate('sports'); onGoHome(); }}
        >
          24<span className="text-white">/</span>7
        </div>

        {/* Center Sport / Live tabs */}
        <div className="flex gap-8 text-sm md:text-base font-semibold absolute left-1/2 -translate-x-1/2">
          <span
            onClick={() => { onNavigate('sports'); onGoHome(); }}
            className={`cursor-pointer pb-1 transition-colors ${currentView === 'sports' ? 'text-white border-b-2 border-brand-yellow' : 'text-white/70 hover:text-white'}`}
          >
            Sport
          </span>
          <span
            onClick={() => { onNavigate('sports'); onGoLive(); }}
            className="cursor-pointer pb-1 text-white/70 hover:text-white flex items-center gap-1"
          >
            Live
            {liveCount > 0 && <span className="text-[10px] bg-brand-accent text-black px-1.5 rounded-full font-bold">{liveCount}</span>}
          </span>
        </div>

        {/* User Utilities */}
        <div className="flex items-center gap-2 md:gap-3 text-xs">
          {currentUser.role === UserRole.ADMIN && (
            <button
              onClick={onOpenAdmin}
              className="bg-brand-headerDark hover:bg-black/20 text-brand-yellow px-2 md:px-3 py-1.5 rounded font-bold border border-brand-yellow/30 transition-colors uppercase tracking-wide text-[10px] md:text-xs whitespace-nowrap"
            >
              Admin
            </button>
          )}

          <div className="hidden md:flex items-center gap-2 mr-1 leading-tight">
            <span className="text-brand-yellow font-bold">{currentUser.balance.toFixed(2)} L</span>
          </div>

          {/* Join / Hyr pills, matching the reference screenshots */}
          <button className="bg-brand-yellow text-brand-headerDark font-bold px-3 py-1.5 rounded uppercase text-[11px] md:text-xs hover:brightness-95 transition">
            Join
          </button>
          <button
            onClick={onLogout}
            className="bg-brand-yellow text-brand-headerDark font-bold px-3 py-1.5 rounded uppercase text-[11px] md:text-xs hover:brightness-95 transition"
          >
            Hyr
          </button>
        </div>
      </div>

      {/* Secondary Nav Bar */}
      <div className="bg-[#282828] border-b border-brand-divider h-8 flex items-center px-4 max-w-[1450px] mx-auto w-full overflow-x-auto no-scrollbar">
         {currentView === 'sports' ? (
             <div className="flex gap-6 text-xs text-brand-textMuted whitespace-nowrap">
                 <span onClick={onGoHome} className="hover:text-brand-accent cursor-pointer font-bold text-white">Home</span>
                 <span onClick={onGoLive} className="hover:text-brand-accent cursor-pointer flex items-center gap-1">
                   Live In-Play
                   {liveCount > 0 && <span className="text-[10px] bg-brand-accent text-black px-1.5 rounded font-bold">{liveCount}</span>}
                 </span>
                 <span className="text-brand-accent cursor-default font-bold">Soccer</span>
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