import React, { useEffect, useState } from 'react';
import { casinoAccess } from '../services/api';
import Plinko from './casino/Plinko';
import Mines from './casino/Mines';
import DragonTiger from './casino/DragonTiger';
import SlotMachine from './casino/SlotMachine';
import Blackjack from './casino/Blackjack';
import Roulette from './casino/Roulette';
import VideoPoker from './casino/VideoPoker';
import Baccarat from './casino/Baccarat';
import Dice from './casino/Dice';
import SlotGames from './casino/SlotGames';
import Wheel from './casino/Wheel';
import Keno from './casino/Keno';
import TumbleSlot from './casino/TumbleSlot';
import Scratch from './casino/Scratch';

interface CasinoHubProps {
  userBalance: number;
  userBalanceEur?: number;
  accountCurrency?: 'ALL' | 'EUR' | 'BOTH';
  onSetBalance: (balance: number, balanceEur?: number) => void;
  /** The super admin sees every game, also the ones closed to players (to test them). */
  showAllGames?: boolean;
}

const CasinoHub: React.FC<CasinoHubProps> = ({ userBalance, userBalanceEur = 0, accountCurrency = 'BOTH', onSetBalance, showAllGames = false }) => {
  const euroOnly = accountCurrency === 'EUR';
  const [activeGame, setActiveGame] = useState<'slots' | 'blackjack' | 'roulette' | 'poker' | 'baccarat' | 'dice' | 'plinko' | 'mines' | 'dragontiger' | 'wheel' | 'keno' | 'scratch' | 'tumble' | null>(null);
  const [disabled, setDisabled] = useState<string[]>([]);
  useEffect(() => { casinoAccess().then((a) => setDisabled(a.disabledGames || [])).catch(() => {}); }, []);
  // The table games are played in lek: a euro-only account gets the slots only.
  const open = (key: string) => (showAllGames || !disabled.includes(key)) && (!euroOnly || key === 'slots');

  if (activeGame === 'slots') return <SlotMachine userBalance={userBalance} onSetBalance={onSetBalance} onClose={() => setActiveGame(null)} />;
  if (activeGame === 'blackjack') return <Blackjack userBalance={userBalance} onSetBalance={onSetBalance} onClose={() => setActiveGame(null)} />;
  if (activeGame === 'roulette') return <Roulette userBalance={userBalance} onSetBalance={onSetBalance} onClose={() => setActiveGame(null)} />;
  if (activeGame === 'poker') return <VideoPoker userBalance={userBalance} onSetBalance={onSetBalance} onClose={() => setActiveGame(null)} />;
  if (activeGame === 'baccarat') return <Baccarat userBalance={userBalance} onSetBalance={onSetBalance} onClose={() => setActiveGame(null)} />;
  if (activeGame === 'plinko') return <Plinko userBalance={userBalance} onSetBalance={onSetBalance} onClose={() => setActiveGame(null)} />;
  if (activeGame === 'mines') return <Mines userBalance={userBalance} onSetBalance={onSetBalance} onClose={() => setActiveGame(null)} />;
  if (activeGame === 'dragontiger') return <DragonTiger userBalance={userBalance} onSetBalance={onSetBalance} onClose={() => setActiveGame(null)} />;
  if (activeGame === 'tumble') return <TumbleSlot balance={userBalance} balanceEur={userBalanceEur} accountCurrency={accountCurrency} onBalances={onSetBalance} onClose={() => setActiveGame(null)} />;
  if (activeGame === 'keno') return <Keno userBalance={userBalance} onSetBalance={onSetBalance} onClose={() => setActiveGame(null)} />;
  if (activeGame === 'scratch') return <Scratch userBalance={userBalance} onSetBalance={onSetBalance} onClose={() => setActiveGame(null)} />;
  if (activeGame === 'wheel') return <Wheel userBalance={userBalance} onSetBalance={onSetBalance} onClose={() => setActiveGame(null)} />;
  if (activeGame === 'dice') return <Dice userBalance={userBalance} onSetBalance={onSetBalance} onClose={() => setActiveGame(null)} />;

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
          Slots
      </h3>
      {open('slots') && <div className="mb-10"><SlotGames balance={userBalance} balanceEur={userBalanceEur} accountCurrency={accountCurrency} onBalances={onSetBalance} /></div>}

      {!euroOnly && (
      <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
          <span className="w-1 h-6 bg-brand-yellow rounded-full"></span>
          Featured Games
      </h3>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
          
          {open('tumble') && (
          <div onClick={() => setActiveGame('tumble')} className="lobby-card lobby-shine group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg border border-transparent hover:border-brand-yellow/50">
               <img src="/slots/candy-blast.jpg" alt="Sugar Cascade" loading="lazy" draggable={false} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
               <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10"></div>
               <div className="absolute bottom-4 left-4 z-20">
                  <div className="bg-pink-600 text-xs font-bold px-2 py-0.5 rounded w-fit mb-1">NEW · SHEMBJE</div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-brand-yellow transition-colors">Sugar Cascade</h3>
                  <p className="text-xs text-gray-200">8+ simbole paguajnë kudo · shumëzues</p>
               </div>
          </div>
          )}
          {open('keno') && (
          <div onClick={() => setActiveGame('keno')} className="lobby-card lobby-shine group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg border border-transparent hover:border-brand-yellow/50">
               <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10"></div>
               <div className="absolute bottom-4 left-4 z-20">
                  <div className="bg-emerald-600 text-xs font-bold px-2 py-0.5 rounded w-fit mb-1">NEW</div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-brand-yellow transition-colors">Keno</h3>
                  <p className="text-xs text-gray-300">Zgjidh numrat, fito deri 1000x</p>
               </div>
               <div className="h-full w-full bg-gradient-to-br from-emerald-900 to-black flex items-center justify-center text-8xl group-hover:scale-110 transition-transform duration-500">🎱</div>
          </div>
          )}
          {open('scratch') && (
          <div onClick={() => setActiveGame('scratch')} className="lobby-card lobby-shine group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg border border-transparent hover:border-brand-yellow/50">
               <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10"></div>
               <div className="absolute bottom-4 left-4 z-20">
                  <div className="bg-emerald-600 text-xs font-bold px-2 py-0.5 rounded w-fit mb-1">NEW</div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-brand-yellow transition-colors">Gërvisht & Fito</h3>
                  <p className="text-xs text-gray-300">Letra me çmime deri 50x</p>
               </div>
               <div className="h-full w-full bg-gradient-to-br from-orange-900 to-black flex items-center justify-center text-8xl group-hover:scale-110 transition-transform duration-500">🎟️</div>
          </div>
          )}
          {open('wheel') && (
          <div onClick={() => setActiveGame('wheel')} className="lobby-card lobby-shine group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg border border-transparent hover:border-brand-yellow/50">
               <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10"></div>
               <div className="absolute bottom-4 left-4 z-20">
                  <div className="bg-emerald-600 text-xs font-bold px-2 py-0.5 rounded w-fit mb-1">NEW</div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-brand-yellow transition-colors">Rrota e Fatit</h3>
                  <p className="text-xs text-gray-300">Rrotulloje dhe fito deri 8x</p>
               </div>
               <div className="h-full w-full bg-gradient-to-br from-fuchsia-900 to-black flex items-center justify-center text-8xl group-hover:scale-110 transition-transform duration-500">🎡</div>
          </div>
          )}
          {open('plinko') && (
          <div onClick={() => setActiveGame('plinko')} className="lobby-card lobby-shine group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg border border-transparent hover:border-brand-yellow/50">
               <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10"></div>
               <div className="absolute bottom-4 left-4 z-20">
                  <div className="bg-emerald-600 text-xs font-bold px-2 py-0.5 rounded w-fit mb-1">NEW</div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-brand-yellow transition-colors">Plinko</h3>
                  <p className="text-xs text-gray-300">Drop the ball, pick your risk</p>
               </div>
               <div className="h-full w-full bg-gradient-to-br from-indigo-900 to-black flex items-center justify-center text-8xl group-hover:scale-110 transition-transform duration-500">🔴</div>
          </div>
          )}
          {open('mines') && (
          <div onClick={() => setActiveGame('mines')} className="lobby-card lobby-shine group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg border border-transparent hover:border-brand-yellow/50">
               <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10"></div>
               <div className="absolute bottom-4 left-4 z-20">
                  <div className="bg-emerald-600 text-xs font-bold px-2 py-0.5 rounded w-fit mb-1">NEW</div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-brand-yellow transition-colors">Mines</h3>
                  <p className="text-xs text-gray-300">Open gems, avoid the bombs</p>
               </div>
               <div className="h-full w-full bg-gradient-to-br from-red-900 to-black flex items-center justify-center text-8xl group-hover:scale-110 transition-transform duration-500">💣</div>
          </div>
          )}
          {open('dragontiger') && (
          <div onClick={() => setActiveGame('dragontiger')} className="lobby-card lobby-shine group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg border border-transparent hover:border-brand-yellow/50">
               <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10"></div>
               <div className="absolute bottom-4 left-4 z-20">
                  <div className="bg-emerald-600 text-xs font-bold px-2 py-0.5 rounded w-fit mb-1">NEW</div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-brand-yellow transition-colors">Dragon Tiger</h3>
                  <p className="text-xs text-gray-300">One card each, highest wins</p>
               </div>
               <div className="h-full w-full bg-gradient-to-br from-amber-900 to-black flex items-center justify-center text-8xl group-hover:scale-110 transition-transform duration-500">🐉</div>
          </div>
          )}
          {/* Baccarat */}
          {open('baccarat') && (
          <div 
            onClick={() => setActiveGame('baccarat')}
            className="lobby-card lobby-shine group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg border border-transparent hover:border-[#d4af37]/50"
          >
               <div className="absolute inset-0 bg-gradient-to-br from-[#1a472a] to-black z-10"></div>
               <div className="absolute bottom-4 left-4 z-20">
                  <div className="bg-[#d4af37] text-black text-xs font-bold px-2 py-0.5 rounded w-fit mb-1">HIGH ROLLER</div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-[#d4af37] transition-colors">Baccarat</h3>
                  <p className="text-xs text-gray-300">Player or Banker?</p>
               </div>
               <div className="h-full w-full flex items-center justify-center z-10 relative">
                  <span className="text-7xl group-hover:scale-110 transition-transform duration-500">🎴</span>
              </div>
          </div>
          )}
          {/* Slot Card */}
          {open('slots') && (
          <div 
            onClick={() => setActiveGame('slots')}
            className="lobby-card lobby-shine group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg border border-transparent hover:border-brand-yellow/50"
          >
              <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10"></div>
              <div className="absolute bottom-4 left-4 z-20">
                  <div className="bg-purple-600 text-xs font-bold px-2 py-0.5 rounded w-fit mb-1">POPULAR</div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-brand-yellow transition-colors">Super Slots</h3>
                  <p className="text-xs text-gray-300">Win up to 300x stake</p>
              </div>
              <div className="h-full w-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-purple-800 to-black flex items-center justify-center text-8xl group-hover:scale-110 transition-transform duration-500">
                  🍒
              </div>
          </div>
          )}
          {/* Blackjack Card */}
          {open('blackjack') && (
          <div 
            onClick={() => setActiveGame('blackjack')}
            className="lobby-card lobby-shine group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg border border-transparent hover:border-brand-yellow/50"
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
          )}
          {/* Roulette Card */}
          {open('roulette') && (
          <div 
             onClick={() => setActiveGame('roulette')}
             className="lobby-card lobby-shine group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg border border-transparent hover:border-brand-yellow/50"
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
          )}
          {/* Video Poker Card */}
          {open('videopoker') && (
          <div 
             onClick={() => setActiveGame('poker')}
             className="lobby-card lobby-shine group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg border border-transparent hover:border-brand-yellow/50"
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
          )}
          {/* Dice Card */}
          {open('dice') && (
          <div
             onClick={() => setActiveGame('dice')}
             className="lobby-card lobby-shine group relative h-64 bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg border border-transparent hover:border-brand-yellow/50"
          >
               <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10"></div>
               <div className="absolute bottom-4 left-4 z-20">
                  <div className="bg-rose-600 text-xs font-bold px-2 py-0.5 rounded w-fit mb-1">NEW 3D</div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-brand-yellow transition-colors">Dice</h3>
                  <p className="text-xs text-gray-300">Under, Seven or Over</p>
               </div>
               <div className="h-full w-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-rose-900 to-black flex items-center justify-center text-8xl group-hover:scale-110 transition-transform duration-500">
                   🎲
               </div>
          </div>
          )}
      </div>
    </div>
  );
};

export default CasinoHub;