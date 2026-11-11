import { startMusic, stopMusic, musicPref, setMusicPref } from './casino/casinoMusic';
import LiveWins from './casino/LiveWins';
import GameBoundary from './casino/GameBoundary';
import DogRace from './casino/DogRace';
import LiveDogs from './casino/LiveDogs';
import LiveCrash from './casino/LiveCrash';
import LiveKeno from './casino/LiveKeno';
import LiveHorses from './casino/LiveHorses';
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
import { WheelCover, KenoCover, ScratchCover, TumbleCover } from './casino/CasinoCovers';
import Wheel from './casino/Wheel';
import GameLoader from './casino/GameLoader';
import Keno from './casino/Keno';
import TumbleSlot from './casino/TumbleSlot';
import Scratch from './casino/Scratch';
import Lobby from './casino/lobby/Lobby';
import type { Tile } from './casino/lobby/catalog';

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
  const [activeGame, setActiveGame] = useState<'slots' | 'blackjack' | 'roulette' | 'poker' | 'baccarat' | 'dice' | 'plinko' | 'mines' | 'dragontiger' | 'wheel' | 'keno' | 'scratch' | 'tumble' | 'crash' | 'hilo' | 'holdwin' | 'penalty' | 'tower' | 'horses' | 'cups' | 'liveroulette' | 'livehorses' | 'dogs' | 'livedogs' | 'livecrash' | 'livekeno' | null>(null);
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
    penalty: <Penalty {...b} />, tower: <Tower {...b} />, horses: <Horses {...b} />, cups: <Cups {...b} />, liveroulette: <LiveRoulette {...b} />, livehorses: <LiveHorses {...b} />, dogs: <DogRace {...b} />, livedogs: <LiveDogs {...b} />, livecrash: <LiveCrash {...b} />, livekeno: <LiveKeno {...b} />,
    crash: <Crash {...b} />, hilo: <HiLo {...b} />, holdwin: <HoldWin {...b} />,
  };
  // A game opens as its own full page (not a box inside the lobby): the lobby is replaced, the page starts at the top.
  useEffect(() => { if (activeGame) window.scrollTo(0, 0); }, [activeGame]);
  if (activeGame && gameEl[activeGame]) {
    return (
      <div className="fixed inset-0 z-[80] overflow-y-auto bg-[#0b0b10]">
        {musicBtn}
        <div className="max-w-5xl mx-auto p-2 sm:p-4 min-h-full"><GameBoundary key={activeGame} onBack={close}>{gameEl[activeGame]}</GameBoundary></div>
      </div>
    );
  }

  const play = (t: Tile) => setLoadingTile({ game: t.game, name: t.name, img: t.img ? `/casino/${t.img}.jpg` : undefined, art: t.art === 'wheel' ? <WheelCover /> : t.art === 'keno' ? <KenoCover /> : t.art === 'scratch' ? <ScratchCover /> : t.art === 'tumble' ? <TumbleCover /> : undefined });

  return (
    <div className="p-2 sm:p-4 text-white min-h-[80vh]">
      {musicBtn}
      {loadingTile && <GameLoader name={loadingTile.name} img={loadingTile.img} art={loadingTile.art} onDone={() => { setActiveGame(loadingTile.game); setLoadingTile(null); }} />}
      <Lobby balance={userBalance} balanceEur={userBalanceEur} currency={accountCurrency} isOpen={open} onPlay={play}
        slotsProps={{ balance: userBalance, balanceEur: userBalanceEur, accountCurrency, onBalances: onSetBalance }} />
    </div>
  );
};

export default CasinoHub;
