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
import { WheelCover, KenoCover, ScratchCover, TumbleCover } from './casino/CasinoCovers';
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

  const close = () => setActiveGame(null);
  const b = { userBalance, onSetBalance, onClose: close };
  const gameEl: Record<string, React.ReactNode> = {
    slots: <SlotMachine {...b} />, blackjack: <Blackjack {...b} />, roulette: <Roulette {...b} />, poker: <VideoPoker {...b} />,
    baccarat: <Baccarat {...b} />, plinko: <Plinko {...b} />, mines: <Mines {...b} />, dragontiger: <DragonTiger {...b} />,
    tumble: <TumbleSlot balance={userBalance} balanceEur={userBalanceEur} accountCurrency={accountCurrency} onBalances={onSetBalance} onClose={close} />,
    keno: <Keno {...b} />, scratch: <Scratch {...b} />, wheel: <Wheel {...b} />, dice: <Dice {...b} />,
  };
  // A game opens as its own full page (not a box inside the lobby): the lobby is replaced, the page starts at the top.
  useEffect(() => { if (activeGame) window.scrollTo(0, 0); }, [activeGame]);
  if (activeGame && gameEl[activeGame]) {
    return (
      <div className="fixed inset-0 z-[80] overflow-y-auto bg-[#0b0b10]">
        <div className="max-w-5xl mx-auto p-2 sm:p-4 min-h-full">{gameEl[activeGame]}</div>
      </div>
    );
  }

  // key = access key (what the super admin can switch off), game = what opens, img = photo cover in public/casino
  const TILES: { key: string; game: typeof activeGame; img?: string; art?: React.ReactNode; name: string }[] = [
    { key: 'slots', game: 'slots', img: 'slots', name: 'Super Slots' },
    { key: 'tumble', game: 'tumble', art: <TumbleCover />, name: 'Sugar Cascade' },
    { key: 'plinko', game: 'plinko', img: 'plinko', name: 'Plinko' },
    { key: 'mines', game: 'mines', img: 'mines', name: 'Mines' },
    { key: 'dragontiger', game: 'dragontiger', img: 'dragontiger', name: 'Dragon Tiger' },
    { key: 'wheel', game: 'wheel', art: <WheelCover />, name: 'Rrota e Fatit' },
    { key: 'keno', game: 'keno', art: <KenoCover />, name: 'Keno' },
    { key: 'scratch', game: 'scratch', art: <ScratchCover />, name: 'Gërvisht & Fito' },
    { key: 'baccarat', game: 'baccarat', img: 'baccarat', name: 'Baccarat' },
    { key: 'blackjack', game: 'blackjack', img: 'blackjack', name: 'Blackjack Pro' },
    { key: 'roulette', game: 'roulette', img: 'roulette', name: 'Roulette' },
    { key: 'videopoker', game: 'poker', img: 'videopoker', name: 'Video Poker' },
    { key: 'dice', game: 'dice', img: 'dice', name: 'Dice' },
  ];

  return (
    <div className="p-3 sm:p-6 text-white min-h-[80vh]">
      <h1 className="text-3xl sm:text-4xl font-bold italic mb-1">Casino <span className="text-brand-yellow">Classics</span></h1>
      <p className="text-sm opacity-70 mb-6">Slots dhe lojëra tavoline. Fitime të menjëhershme, pa pritje.</p>

      <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><span className="w-1 h-6 bg-brand-yellow rounded-full"></span>Slots</h3>
      {open('slots') && <div className="mb-10"><SlotGames balance={userBalance} balanceEur={userBalanceEur} accountCurrency={accountCurrency} onBalances={onSetBalance} /></div>}

      <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><span className="w-1 h-6 bg-brand-yellow rounded-full"></span>Lojëra</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-5">
        {TILES.filter((t) => open(t.key)).map((t) => (
          <button key={t.key} onClick={() => setActiveGame(t.game)} aria-label={t.name}
            className="lobby-card lobby-shine group relative aspect-[4/5] rounded-2xl overflow-hidden cursor-pointer shadow-xl border border-white/10 hover:border-brand-yellow/60 text-left">
            {t.img ? <img src={`/casino/${t.img}.jpg`} alt={t.name} loading="lazy" draggable={false} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" /> : t.art}
          </button>
        ))}
      </div>
    </div>
  );
};

export default CasinoHub;
