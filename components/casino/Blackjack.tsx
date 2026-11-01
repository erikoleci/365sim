import React, { useEffect, useState } from 'react';
import { casinoBlackjackDeal, casinoBlackjackHit, casinoBlackjackStand } from '../../services/api';
import PlayingCard from './PlayingCard';
import { CroupierMood } from './Croupier';
import DealerPhoto from './DealerPhoto';
import Chip, { ChipStack } from './Chip';
import CoinBurst from './CoinBurst';

interface BlackjackProps {
  onSetBalance: (balance: number) => void;
  userBalance: number;
  onClose: () => void;
}

type Card = { suit: string; value: string; numValue: number } | null;

// Cards of the first deal fly in one after the other (player, dealer, player, dealer); later cards at once.
const CardView: React.FC<{ card: Card; hidden?: boolean; delay?: number }> = ({ card, hidden, delay = 0 }) => (
  <PlayingCard card={card} hidden={hidden || !card} delay={delay} />
);

const calcScore = (hand: Card[]) => {
  const cards = hand.filter((c): c is NonNullable<Card> => c !== null);
  let score = cards.reduce((acc, card) => acc + card.numValue, 0);
  let aces = cards.filter(c => c.value === 'A').length;
  while (score > 21 && aces > 0) {
    score -= 10;
    aces -= 1;
  }
  return score;
};

const Blackjack: React.FC<BlackjackProps> = ({ onSetBalance, userBalance, onClose }) => {
  const [gameState, setGameState] = useState<'BETTING' | 'PLAYING' | 'FINISHED'>('BETTING');
  const [playerHand, setPlayerHand] = useState<Card[]>([]);
  const [dealerHand, setDealerHand] = useState<Card[]>([]);
  const [stake, setStake] = useState(25);
  const [touched, setTouched] = useState(false);
  const [message, setMessage] = useState('Place your bet');
  const [roundId, setRoundId] = useState<string | null>(null);
  const [dealing, setDealing] = useState(false); // true for a moment after a deal: the first cards are staggered
  useEffect(() => { if (!dealing) return; const t = setTimeout(() => setDealing(false), 1400); return () => clearTimeout(t); }, [dealing]);
  const resultMood: CroupierMood = /win|blackjack/i.test(message) && !/dealer wins|house/i.test(message) ? 'win' : /bust|lose|lost|dealer wins|house/i.test(message) ? 'lose' : 'idle';
  const mood: CroupierMood = gameState === 'FINISHED' ? resultMood : dealing ? 'spinning' : 'idle';

  const dealGame = async () => {
    if (stake < 1) { setMessage('Place your bet'); return; }
    if (userBalance < stake) {
        setMessage('Insufficient Funds');
        return;
    }
    try {
        const res = await casinoBlackjackDeal(stake);
        setDealing(true);
        setRoundId(res.roundId);
        setPlayerHand(res.playerHand);
        setDealerHand(res.dealerHand);
        onSetBalance(res.balance);
        if (res.status === 'FINISHED') {
            setGameState('FINISHED');
            setMessage(res.message || '');
        } else {
            setGameState('PLAYING');
            setMessage('Hit or Stand?');
        }
    } catch (err: any) {
        setMessage(err?.message || 'Something went wrong');
    }
  };

  const hit = async () => {
    if (!roundId) return;
    try {
        const res = await casinoBlackjackHit(roundId);
        setPlayerHand(res.playerHand);
        setDealerHand(res.dealerHand);
        if (res.status === 'FINISHED') {
            setGameState('FINISHED');
            setMessage(res.message || 'BUST');
            if (typeof res.balance === 'number') onSetBalance(res.balance);
        }
    } catch (err: any) {
        setMessage(err?.message || 'Something went wrong');
    }
  };

  const stand = async () => {
    if (!roundId) return;
    setGameState('FINISHED');
    try {
        const res = await casinoBlackjackStand(roundId);
        setPlayerHand(res.playerHand);
        setDealerHand(res.dealerHand);
        setMessage(res.message);
        onSetBalance(res.balance);
    } catch (err: any) {
        setMessage(err?.message || 'Something went wrong');
    }
  };

  return (
    <div className="casino-felt flex flex-col items-center justify-between min-h-[600px] rounded-xl p-6 relative overflow-hidden">
       {gameState === 'FINISHED' && mood === 'win' && <CoinBurst />}
       <button onClick={onClose} className="absolute top-4 left-4 text-white/50 hover:text-white font-bold z-10">‹ Exit Table</button>
       
       <div className="text-center w-full">
           <h2 className="font-bold tracking-widest casino-gold-text mb-1">BLACKJACK PRO</h2>
           <div className="flex justify-center mb-2"><DealerPhoto dealer={1} mood={mood} size={104} /></div>
           <div className="flex justify-center gap-2 min-h-[100px] mb-4" style={{ transform: "perspective(700px) rotateX(14deg)" }}>
                {gameState === 'BETTING' ? (
                    <div className="w-16 h-[92px] border-2 border-dashed border-white/20 rounded-lg"></div>
                ) : (
                    dealerHand.map((c, i) => (
                        <CardView key={i} card={c} hidden={c === null} delay={dealing ? (i * 2 + 1) * 180 : 0} />
                    ))
                )}
           </div>
           {gameState === 'FINISHED' && (
               <div className="text-white font-bold bg-black/50 inline-block px-3 rounded-full border border-white/10">{calcScore(dealerHand)}</div>
           )}
       </div>

       <div key={message} className="text-2xl text-white font-bold my-4 drop-shadow-md win-pop">{message}</div>

       <div className="text-center w-full mb-8">
           {gameState !== 'BETTING' && (
             <div className="text-white font-bold bg-black/50 inline-block px-3 rounded-full border border-white/10 mb-2">{calcScore(playerHand)}</div>
           )}
           <div className="flex justify-center gap-2 min-h-[100px]" style={{ transform: "perspective(700px) rotateX(-8deg)" }}>
                {gameState === 'BETTING' ? (
                    <div className="w-16 h-[92px] border-2 border-dashed border-white/20 rounded-lg"></div>
                ) : (
                    playerHand.map((c, i) => <CardView key={i} card={c} delay={dealing ? i * 2 * 180 : 0} />)
                )}
           </div>
       </div>

       <div className="w-full max-w-lg bg-black/30 p-4 rounded-xl border-t border-white/10">
           {gameState === 'BETTING' || gameState === 'FINISHED' ? (
               <div className="flex items-center justify-between gap-4">
                   <div className="text-white">
                       <div className="text-xs opacity-70">Balance</div>
                       <div className="font-bold text-yellow-400">{userBalance.toFixed(2)}</div>
                   </div>
                   <div className="flex flex-col items-center gap-2">
                       <div className="flex items-center gap-2">
                           {[5, 25, 100, 500].map((v) => (
                               <button key={v} onClick={() => { setTouched(true); setStake((cur) => Math.min(5000, (cur === 25 && !touched ? 0 : cur) + v)); }} className="transition-transform hover:-translate-y-1 active:scale-95" aria-label={`Add ${v}`}>
                                   <Chip value={v} size={38} />
                               </button>
                           ))}
                       </div>
                       <div className="flex items-center gap-2 text-xs text-white">
                           <ChipStack value={stake} count={Math.min(5, Math.max(1, Math.ceil(stake / 100)))} size={24} />
                           <span className="font-bold text-yellow-400">{stake}</span>
                           <button onClick={() => { setTouched(true); setStake(0); }} className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20">Clear</button>
                       </div>
                   </div>
                   <button onClick={dealGame} className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold px-8 py-2 rounded-full shadow-lg transition-transform hover:scale-105">
                       {gameState === 'FINISHED' ? 'NEW DEAL' : 'DEAL'}
                   </button>
               </div>
           ) : (
               <div className="flex justify-center gap-4">
                   <button onClick={hit} className="bg-green-600 hover:bg-green-500 text-white font-bold px-8 py-3 rounded-full shadow-lg">HIT</button>
                   <button onClick={stand} className="bg-red-600 hover:bg-red-500 text-white font-bold px-8 py-3 rounded-full shadow-lg">STAND</button>
               </div>
           )}
       </div>
    </div>
  );
};

export default Blackjack;
