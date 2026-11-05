import { startMusic, stopMusic, musicPref, setMusicPref } from './casino/casinoMusic';
import LiveWins from './casino/LiveWins';
import LiveRoulette from './casino/LiveRoulette';
import Penalty from './casino/Penalty';
import Tower from './casino/Tower';
import Horses from './casino/Horses';
import Cups from './casino/Cups';
import Crash from './casino/Crash';
import HiLo from './casino/HiLo';
import HoldWin from './casino/HoldWin';
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
import { WheelCover, KenoCover, ScratchCover, TumbleCover, PlainCover } from './casino/CasinoCovers';
import Wheel from './casino/Wheel';
import GameLoader from './casino/GameLoader';
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
  const [activeGame, setActiveGame] = useState<'slots' | 'blackjack' | 'roulette' | 'poker' | 'baccarat' | 'dice' | 'plinko' | 'mines' | 'dragontiger' | 'wheel' | 'keno' | 'scratch' | 'tumble' | 'crash' | 'hilo' | 'holdwin' | 'penalty' | 'tower' | 'horses' | 'cups' | 'liveroulette' | null>(null);
  const [disabled, setDisabled] = useState<string[]>([]);
  useEffect(() => { casinoAccess().then((a) => setDisabled(a.disabledGames || [])).catch(() => {}); }, []);
  // The table games are played in lek: a euro-only account gets the slots only.
  const open = (key: string) => (showAllGames || !disabled.includes(key)) && (!euroOnly || key === 'slots');

  const [loadingTile, setLoadingTile] = useState<{ game: NonNullable<typeof activeGame>; name: string; img?: string; art?: React.ReactNode } | null>(null);
  // Lounge music: starts at the first tap in the casino (browsers block autoplay), unless the player turned it off; stops when leaving.
  const [music, setMusic] = useState(musicPref());
  useEffect(() => {
    if (!music) { stopMusic(); return undefined; }
    const go = () => startMusic();
    window.addEventListener('pointerdown', go, { once: true });
    return () => window.removeEventListener('pointerdown', go);
  }, [music]);
  useEffect(() => () => stopMusic(), []);
  const musicBtn = (
    <button onClick={() => { const v = !music; setMusic(v); setMusicPref(v); if (v) startMusic(); else stopMusic(); }} aria-label={music ? 'Turn music off' : 'Turn music on'}
      className="fixed bottom-4 right-4 z-[96] w-11 h-11 rounded-full bg-black/70 border border-yellow-500/50 text-lg shadow-lg hover:bg-black/90 active:scale-95">{music ? '🎵' : '🔇'}</button>
  );
  const close = () => setActiveGame(null);
  const b = { userBalance, onSetBalance, onClose: close };
  const gameEl: Record<string, React.ReactNode> = {
    slots: <SlotMachine {...b} />, blackjack: <Blackjack {...b} />, roulette: <Roulette {...b} />, poker: <VideoPoker {...b} />,
    baccarat: <Baccarat {...b} />, plinko: <Plinko {...b} />, mines: <Mines {...b} />, dragontiger: <DragonTiger {...b} />,
    tumble: <TumbleSlot balance={userBalance} balanceEur={userBalanceEur} accountCurrency={accountCurrency} onBalances={onSetBalance} onClose={close} />,
    keno: <Keno {...b} />, scratch: <Scratch {...b} />, wheel: <Wheel {...b} />, dice: <Dice {...b} />,
    penalty: <Penalty {...b} />, tower: <Tower {...b} />, horses: <Horses {...b} />, cups: <Cups {...b} />, liveroulette: <LiveRoulette {...b} />,
    crash: <Crash {...b} />, hilo: <HiLo {...b} />, holdwin: <HoldWin {...b} />,
  };
  // A game opens as its own full page (not a box inside the lobby): the lobby is replaced, the page starts at the top.
  useEffect(() => { if (activeGame) window.scrollTo(0, 0); }, [activeGame]);
  if (activeGame && gameEl[activeGame]) {
    return (
      <div className="fixed inset-0 z-[80] overflow-y-auto bg-[#0b0b10]">
        {musicBtn}
        <div className="max-w-5xl mx-auto p-2 sm:p-4 min-h-full">{gameEl[activeGame]}</div>
      </div>
    );
  }

  // key = access key (what the super admin can switch off), game = what opens, img = photo cover in public/casino
  const TILES: { key: string; game: typeof activeGame; img?: string; art?: React.ReactNode; name: string }[] = [
    { key: 'slots', game: 'slots', img: 'slots', name: 'Super Slots' },
    { key: 'tumble', game: 'tumble', art: <TumbleCover />, name: 'Sugar Cascade' },
    { key: 'liveroulette', game: 'liveroulette', art: <PlainCover title="LIVE ROULETTE" sub="One shared wheel · a spin every 30s" from="#065f46" to="#022c22" />, name: 'Live Roulette' },
    { key: 'penalty', game: 'penalty', art: <PlainCover title="PENALTY SHOOTOUT" sub="Beat the keeper, chain the goals" from="#14532d" to="#0b1b3a" />, name: 'Penalty Shootout' },
    { key: 'horses', game: 'horses', art: <PlainCover title="HORSE RACE" sub="Back a horse, win up to 13x" from="#166534" to="#78350f" />, name: 'Horse Race' },
    { key: 'tower', game: 'tower', art: <PlainCover title="GOLD TOWER" sub="Climb the floors, dodge the traps" from="#78350f" to="#1c1917" />, name: 'Gold Tower' },
    { key: 'cups', game: 'cups', art: <PlainCover title="THREE CUPS" sub="Find the ball, win 2.85x" from="#7f1d1d" to="#1c0a05" />, name: 'Three Cups' },
    { key: 'crash', game: 'crash', art: <PlainCover title="CRASH" sub="Cash out before it blows" from="#0f172a" to="#7c2d12" />, name: 'Crash' },
    { key: 'holdwin', game: 'holdwin', art: <PlainCover title="HOLD & WIN" sub="Lock coins, fill the board" from="#3b0764" to="#78350f" />, name: 'Hold & Win' },
    { key: 'hilo', game: 'hilo', art: <PlainCover title="HI-LO" sub="Higher or lower? Chain your wins" from="#065f46" to="#022c22" />, name: 'Hi-Lo' },
    { key: 'plinko', game: 'plinko', img: 'plinko', name: 'Plinko' },
    { key: 'mines', game: 'mines', img: 'mines', name: 'Mines' },
    { key: 'dragontiger', game: 'dragontiger', img: 'dragontiger', name: 'Dragon Tiger' },
    { key: 'wheel', game: 'wheel', art: <WheelCover />, name: 'Wheel of Fortune' },
    { key: 'keno', game: 'keno', art: <KenoCover />, name: 'Keno' },
    { key: 'scratch', game: 'scratch', art: <ScratchCover />, name: 'Scratch & Win' },
    { key: 'baccarat', game: 'baccarat', img: 'baccarat', name: 'Baccarat' },
    { key: 'blackjack', game: 'blackjack', img: 'blackjack', name: 'Blackjack Pro' },
    { key: 'roulette', game: 'roulette', img: 'roulette', name: 'Roulette' },
    { key: 'videopoker', game: 'poker', img: 'videopoker', name: 'Video Poker' },
    { key: 'dice', game: 'dice', img: 'dice', name: 'Dice' },
  ];

  return (
    <div className="p-3 sm:p-6 text-white min-h-[80vh]">
      {musicBtn}
      {loadingTile && <GameLoader name={loadingTile.name} img={loadingTile.img} art={loadingTile.art} onDone={() => { setActiveGame(loadingTile.game); setLoadingTile(null); }} />}
      <h1 className="text-3xl sm:text-4xl font-bold italic mb-1">Casino <span className="text-brand-yellow">Classics</span></h1>
      <p className="text-sm opacity-70 mb-6">Slots and table games. Instant wins, no waiting.</p>

      <LiveWins />

      <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><span className="w-1 h-6 bg-brand-yellow rounded-full"></span>Slots</h3>
      {open('slots') && <div className="mb-10"><SlotGames balance={userBalance} balanceEur={userBalanceEur} accountCurrency={accountCurrency} onBalances={onSetBalance} /></div>}

      <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><span className="w-1 h-6 bg-brand-yellow rounded-full"></span>Games</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-5">
        {TILES.filter((t) => open(t.key)).map((t) => (
          <button key={t.key} onClick={() => setLoadingTile({ game: t.game as NonNullable<typeof activeGame>, name: t.name, img: t.img ? `/casino/${t.img}.jpg` : undefined, art: t.art })} aria-label={t.name}
            className="lobby-card lobby-shine group relative aspect-[4/5] rounded-2xl overflow-hidden cursor-pointer shadow-xl border border-white/10 hover:border-brand-yellow/60 text-left">
            {t.img ? <img src={`/casino/${t.img}.jpg`} alt={t.name} loading="lazy" draggable={false} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" /> : t.art}
          </button>
        ))}
      </div>
    </div>
  );
};

export default CasinoHub;
