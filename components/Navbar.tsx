import React, { useState } from 'react';
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

const NavLink: React.FC<{ active?: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
      active ? 'bg-brand-accentSoft text-brand-accent' : 'text-brand-textMuted hover:text-brand-text hover:bg-brand-surfaceHover'
    }`}
  >
    {children}
  </button>
);

const Navbar: React.FC<NavbarProps> = ({ currentUser, onLogout, onOpenAdmin, currentView, onNavigate, onGoHome, onGoLive, liveCount }) => {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="bg-brand-header/95 backdrop-blur border-b border-brand-border sticky top-0 z-50 flex flex-col">
      {/* Top Bar */}
      <div className="max-w-[1440px] mx-auto w-full px-4 h-16 flex justify-between items-center gap-4">
        <div className="flex items-center gap-3 md:gap-6">
          <button
            className="flex items-center gap-2 font-display font-extrabold text-lg md:text-xl text-brand-text"
            onClick={() => onNavigate('sports')}
            aria-label="365sim home"
          >
            <span className="w-8 h-8 rounded-lg bg-brand-accent/15 border border-brand-accent/30 flex items-center justify-center text-brand-accent">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3 6 6 1-4.5 4.5L18 20l-6-3-6 3 1.5-6.5L3 9l6-1z" />
              </svg>
            </span>
            365<span className="text-brand-accent">sim</span>
          </button>

          <div className="hidden md:flex items-center gap-1">
            <NavLink active={currentView === 'sports'} onClick={() => onNavigate('sports')}>Sports</NavLink>
            <NavLink active={currentView === 'casino'} onClick={() => onNavigate('casino')}>Casino</NavLink>
          </div>
        </div>

        {/* Search (visual placeholder — wired up in a follow-up pass) */}
        <div className="hidden lg:flex flex-1 max-w-md">
          <div className="w-full flex items-center gap-2 bg-brand-surface border border-brand-border rounded-lg px-3 py-2 text-brand-textFaint text-sm">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4.3-4.3" /></svg>
            Search matches, teams, leagues…
            <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-brand-border text-brand-textFaint">⌘K</kbd>
          </div>
        </div>

        {/* User Utilities */}
        <div className="flex items-center gap-2 md:gap-3">
          {currentUser.role === UserRole.ADMIN && (
            <button
              onClick={onOpenAdmin}
              className="hidden md:flex items-center gap-1.5 bg-brand-surface hover:bg-brand-surfaceHover text-brand-yellow px-3 py-1.5 rounded-lg font-semibold text-xs border border-brand-border transition-colors"
            >
              Admin
            </button>
          )}

          <div className="flex items-center gap-2 bg-brand-surface border border-brand-border rounded-lg pl-2 pr-1 py-1">
            <div className="text-right leading-tight">
              <div className="text-[11px] text-brand-textFaint hidden md:block">{currentUser.name}</div>
              <div className="text-brand-accent font-bold text-sm tabular-nums">{currentUser.balance.toFixed(2)} <span className="text-[10px] text-brand-textFaint">L</span></div>
            </div>
            <img src={currentUser.avatar} className="w-7 h-7 rounded-full border border-brand-border" alt="" />
          </div>

          <button onClick={onLogout} aria-label="Log out" className="text-brand-textFaint hover:text-brand-text w-8 h-8 flex items-center justify-center rounded-lg hover:bg-brand-surfaceHover transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          </button>

          <button
            className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-brand-surfaceHover text-brand-text"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden flex flex-col gap-1 px-4 pb-3 animate-fadeIn">
          <NavLink active={currentView === 'sports'} onClick={() => { onNavigate('sports'); setMenuOpen(false); }}>Sports</NavLink>
          <NavLink active={currentView === 'casino'} onClick={() => { onNavigate('casino'); setMenuOpen(false); }}>Casino</NavLink>
          {currentUser.role === UserRole.ADMIN && (
            <button onClick={() => { onOpenAdmin(); setMenuOpen(false); }} className="text-left px-3 py-1.5 rounded-lg text-sm font-semibold text-brand-yellow hover:bg-brand-surfaceHover">
              Admin Panel
            </button>
          )}
        </div>
      )}

      {/* Secondary Nav Bar */}
      <div className="bg-brand-bg border-t border-brand-border/60 h-10 flex items-center px-4 max-w-[1440px] mx-auto w-full overflow-x-auto no-scrollbar">
        {currentView === 'sports' ? (
          <div className="flex gap-1 text-sm whitespace-nowrap">
            <NavLink onClick={onGoHome}>Home</NavLink>
            <button
              onClick={onGoLive}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-brand-textMuted hover:text-brand-text hover:bg-brand-surfaceHover transition-colors"
            >
              {liveCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-brand-live animate-pulseLive" />}
              Live In-Play
              {liveCount > 0 && <span className="text-[10px] bg-brand-live/20 text-brand-live px-1.5 py-0.5 rounded font-bold">{liveCount}</span>}
            </button>
            <span className="px-3 py-1.5 rounded-lg text-sm font-semibold text-brand-accent bg-brand-accentSoft">Soccer</span>
            <span className="px-3 py-1.5 rounded-lg text-sm font-medium text-brand-textFaint cursor-not-allowed" title="Së shpejti">Tennis</span>
            <span className="px-3 py-1.5 rounded-lg text-sm font-medium text-brand-textFaint cursor-not-allowed" title="Së shpejti">Basketball</span>
          </div>
        ) : (
          <div className="flex gap-1 text-sm whitespace-nowrap">
            <span className="px-3 py-1.5 rounded-lg font-semibold text-brand-text bg-brand-surfaceHover">Lobby</span>
            <span className="px-3 py-1.5 rounded-lg font-medium text-brand-textMuted hover:text-brand-yellow cursor-pointer">Slots</span>
            <span className="px-3 py-1.5 rounded-lg font-medium text-brand-textMuted hover:text-brand-yellow cursor-pointer">Live Casino</span>
            <span className="px-3 py-1.5 rounded-lg font-medium text-brand-textMuted hover:text-brand-yellow cursor-pointer">Table Games</span>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
