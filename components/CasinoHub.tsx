import React, { useState } from 'react';
import SlotMachine from './casino/SlotMachine';
import Blackjack from './casino/Blackjack';
import Roulette from './casino/Roulette';
import VideoPoker from './casino/VideoPoker';
import Baccarat from './casino/Baccarat';
import Crash from './casino/Crash';

interface CasinoHubProps {
  userBalance: number;
  onUpdateBalance: (amount: number) => void;
}

const CasinoHub: React.FC<CasinoHubProps> = ({ userBalance, onUpdateBalance }) => {
  const [activeGame, setActiveGame] = useState<'slots' | 'blackjack' | 'roulette' | 'poker' | 'baccarat' | 'crash' | null>(null);

  if (activeGame === 'slots') return <SlotMachine userBalance={userBalance} onBalanceUpdate={onUpdateBalance} onClose={() => setActiveGame(null)} />;
  if (activeGame === 'blackjack') return <Blackjack userBalance={userBalance} onBalanceUpdate={onUpdateBalance} onClose={() => setActiveGame(null)} />;
  if (activeGame === 'roulette') return <Roulette userBalance={userBalance} onBalanceUpdate={onUpdateBalance} onClose={() => setActiveGame(null)} />;
  if (activeGame === 'poker') return <VideoPoker userBalance={userBalance} onBalanceUpdate={onUpdateBalance} onClose={() => setActiveGame(null)} />;
  if (activeGame === 'baccarat') return <Baccarat userBalance={userBalance} onBalanceUpdate={onUpdateBalance} onClose={() => setActiveGame(null)} />;
  if (activeGame === 'crash') return <Crash userBalance={userBalance} onBalanceUpdate={onUpdateBalance} onClose={() => setActiveGame(null)} />;

  return (
    <div className="p-6 text-white min-h-[80vh]">
      {/* Hero Banner */}
      <div className="bg-gradient-to-r from-purple-900 to-indigo-900 rounded-2xl p-8 mb-8 relative overflow-hidden shadow-xl border border-white/10">
          <div className="relative z-10">
            <h1 className="text-4xl font-bold italic mb-2">Casino <span className="text-brand-yellow">Classics</span></h1>
            <p className="text-lg opacity-80 mb-6 max-w-lg">Play the hottest slots and tables. Instant wins, no waiting.</p>
            <div className="inline-flex items-center bg-black/30 rounded-full px-4 py-1 text-sm border border-brand-yellow/30">
                <span className="text-brand-yellow mr-2">●</span> Jackpot: <span className="font-bold ml-1">1,240,593.00 L</span>
            </div>
          </div>
          <div className="absolute right-0 top-0 h-full w-1/2 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
      </div>

      <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
          <span className="w-1 h-6 bg-brand-yellow rounded-full"></span>
          Featured Games
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
          
          {/* Crash / Aviator */}
          <div 
            onClick={() => setActiveGame('crash')}
            className="group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg hover:shadow-2xl hover:scale-[1.02] transition-all border border-transparent hover:border-brand-accent/50"
          >
              <div className="absolute inset-0 bg-gradient-to-br from-[#161b2e] to-black z-10"></div>
              <div className="absolute bottom-4 left-4 z-20">
                  <div className="bg-brand-accent text-brand-bg text-xs font-bold px-2 py-0.5 rounded w-fit mb-1 animate-pulse">TRENDING</div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-brand-accent transition-colors">CRASH</h3>
                  <p className="text-xs text-gray-300">Cash out before it crashes!</p>
              </div>
              <div className="absolute top-4 right-4 z-20 text-brand-accent font-mono text-xl group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform">↗</div>
              <div className="h-full w-full flex items-center justify-center z-10 relative">
                  <span className="text-7xl group-hover:scale-110 transition-transform duration-500">🚀</span>
              </div>
          </div>

          {/* Baccarat */}
          <div 
            onClick={() => setActiveGame('baccarat')}
            className="group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg hover:shadow-2xl hover:scale-[1.02] transition-all border border-transparent hover:border-[#d4af37]/50"
          >
               <div className="absolute inset-0 bg-gradient-to-br from-[#1a472a] to-black z-10"></div>
               <div className="absolute bottom-4 left-4 z-20">
                  <div className="bg-[#d4af37] text-black text-xs font-bold px-2 py-0.5 rounded w-fit mb-1">HIGH ROLLER</div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-[#d4af37] transition-colors">Baccarat</h3>
                  <p className="text-xs text-gray-300">Player or Banker?</p>
               </div>
               <div className="h-full w-full flex items-center justify-center z-10 relative">
                  <span className="text-7xl group-hover:scale-110 transition-transform duration-500">👔</span>
              </div>
          </div>

          {/* Slot Card */}
          <div 
            onClick={() => setActiveGame('slots')}
            className="group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg hover:shadow-2xl hover:scale-[1.02] transition-all border border-transparent hover:border-brand-yellow/50"
          >
              <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10"></div>
              <div className="absolute bottom-4 left-4 z-20">
                  <div className="bg-purple-600 text-xs font-bold px-2 py-0.5 rounded w-fit mb-1">POPULAR</div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-brand-yellow transition-colors">Super Slots</h3>
                  <p className="text-xs text-gray-300">Win up to 100x stake</p>
              </div>
              <div className="h-full w-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-purple-800 to-black flex items-center justify-center text-8xl group-hover:scale-110 transition-transform duration-500">
                  🍒
              </div>
          </div>

          {/* Blackjack Card */}
          <div 
            onClick={() => setActiveGame('blackjack')}
            className="group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg hover:shadow-2xl hover:scale-[1.02] transition-all border border-transparent hover:border-brand-yellow/50"
          >
              <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10"></div>
              <div className="absolute bottom-4 left-4 z-20">
                  <div className="bg-green-600 text-xs font-bold px-2 py-0.5 rounded w-fit mb-1">TABLE</div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-brand-yellow transition-colors">Blackjack Pro</h3>
                  <p className="text-xs text-gray-300">RTP 99.5%</p>
              </div>
              <div className="h-full w-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-green-800 to-black flex items-center justify-center text-8xl group-hover:scale-110 transition-transform duration-500">
                  ♠️
              </div>
          </div>

          {/* Roulette Card */}
          <div 
             onClick={() => setActiveGame('roulette')}
             className="group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg hover:shadow-2xl hover:scale-[1.02] transition-all border border-transparent hover:border-brand-yellow/50"
          >
               <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10"></div>
               <div className="absolute bottom-4 left-4 z-20">
                  <div className="bg-red-600 text-xs font-bold px-2 py-0.5 rounded w-fit mb-1">CLASSIC</div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-brand-yellow transition-colors">Roulette</h3>
                  <p className="text-xs text-gray-300">European Rules</p>
               </div>
               <div className="h-full w-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-red-900 to-black flex items-center justify-center text-8xl group-hover:scale-110 transition-transform duration-500">
                   🎡
               </div>
          </div>

          {/* Video Poker Card */}
          <div 
             onClick={() => setActiveGame('poker')}
             className="group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg hover:shadow-2xl hover:scale-[1.02] transition-all border border-transparent hover:border-brand-yellow/50"
          >
               <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10"></div>
               <div className="absolute bottom-4 left-4 z-20">
                  <div className="bg-blue-600 text-xs font-bold px-2 py-0.5 rounded w-fit mb-1">POKER</div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-brand-yellow transition-colors">Video Poker</h3>
                  <p className="text-xs text-gray-300">Jacks or Better</p>
               </div>
               <div className="h-full w-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900 to-black flex items-center justify-center text-8xl group-hover:scale-110 transition-transform duration-500">
                   🃏
               </div>
          </div>
      </div>
    </div>
  );
};

export default CasinoHub;