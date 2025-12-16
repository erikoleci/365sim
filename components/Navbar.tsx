import React from 'react';
import { User, UserRole } from '../types';

interface NavbarProps {
  currentUser: User;
  onLogout: () => void;
  onOpenAdmin: () => void;
  currentView: 'sports' | 'casino';
  onNavigate: (view: 'sports' | 'casino') => void;
}

const Navbar: React.FC<NavbarProps> = ({ currentUser, onLogout, onOpenAdmin, currentView, onNavigate }) => {
  return (
    <nav className="bg-brand-header text-brand-text text-sm sticky top-0 z-50 shadow-md flex flex-col">
      {/* Top Bar */}
      <div className="max-w-[1450px] mx-auto w-full px-4 h-14 flex justify-between items-center">
        {/* Logo Section */}
        <div className="flex items-center gap-6">
          <div 
            className="font-bold text-2xl tracking-tighter italic text-white cursor-pointer"
            onClick={() => onNavigate('sports')}
          >
            bet<span className="text-brand-yellow">365</span>sim
          </div>
          <div className="hidden md:flex gap-6 text-brand-text/90 text-sm font-medium">
            <span 
                onClick={() => onNavigate('sports')}
                className={`cursor-pointer transition-opacity ${currentView === 'sports' ? 'text-white opacity-100 font-bold' : 'hover:text-white opacity-70'}`}
            >
                SPORTS
            </span>
            <span 
                onClick={() => onNavigate('casino')}
                className={`cursor-pointer transition-opacity ${currentView === 'casino' ? 'text-white opacity-100 font-bold' : 'hover:text-white opacity-70'}`}
            >
                CASINO
            </span>
          </div>
        </div>

        {/* User Utilities */}
        <div className="flex items-center gap-4 text-xs">
          {currentUser.role === UserRole.ADMIN && (
            <button 
              onClick={onOpenAdmin}
              className="bg-brand-headerDark hover:bg-black/20 text-brand-yellow px-3 py-1.5 rounded font-bold border border-brand-yellow/30 transition-colors uppercase tracking-wide"
            >
              Admin Panel
            </button>
          )}

          <div className="flex items-center gap-3 cursor-pointer group">
             <div className="text-right">
                <div className="text-white font-bold group-hover:underline">{currentUser.name}</div>
                <div className="text-brand-yellow font-bold">Balance: {currentUser.balance.toFixed(2)} L</div>
             </div>
             <img src={currentUser.avatar} className="w-8 h-8 rounded-full border-2 border-brand-headerDark" alt="avatar" />
          </div>
          
          <button 
              onClick={onLogout}
              className="text-brand-textMuted hover:text-white text-xs"
            >
              Logout
            </button>
        </div>
      </div>
      
      {/* Secondary Nav Bar */}
      <div className="bg-[#282828] border-b border-brand-divider h-8 flex items-center px-4 max-w-[1450px] mx-auto w-full overflow-x-auto no-scrollbar">
         {currentView === 'sports' ? (
             <div className="flex gap-6 text-xs text-brand-textMuted whitespace-nowrap">
                 <span className="hover:text-brand-accent cursor-pointer font-bold text-white">Home</span>
                 <span className="hover:text-brand-accent cursor-pointer">Soccer</span>
             </div>
         ) : (
             <div className="flex gap-6 text-xs text-brand-textMuted whitespace-nowrap">
                 <span className="text-white font-bold cursor-pointer">Home</span>
                 <span className="hover:text-brand-yellow cursor-pointer">Slots</span>
                 <span className="hover:text-brand-yellow cursor-pointer">Table Games</span>
             </div>
         )}
      </div>
    </nav>
  );
};

export default Navbar;