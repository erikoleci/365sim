import React, { useState, useEffect } from 'react';

interface BlackjackProps {
  onBalanceUpdate: (amount: number) => void;
  userBalance: number;
  onClose: () => void;
}

type Card = { suit: string; value: string; numValue: number };
const SUITS = ['♠', '♥', '♦', '♣'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const getCardColor = (suit: string) => (suit === '♥' || suit === '♦' ? 'text-red-500' : 'text-black');

const CardView: React.FC<{ card: Card, hidden?: boolean }> = ({ card, hidden }) => (
  <div className={`w-16 h-24 bg-white rounded flex flex-col items-center justify-center border-2 border-gray-300 shadow-md ${hidden ? 'bg-blue-800 border-white' : ''}`}>
      {!hidden && (
          <>
            <div className={`text-xl font-bold ${getCardColor(card.suit)}`}>{card.value}</div>
            <div className={`text-2xl ${getCardColor(card.suit)}`}>{card.suit}</div>
          </>
      )}
  </div>
);

const Blackjack: React.FC<BlackjackProps> = ({ onBalanceUpdate, userBalance, onClose }) => {
  const [gameState, setGameState] = useState<'BETTING' | 'PLAYING' | 'DEALER_TURN' | 'FINISHED'>('BETTING');
  const [deck, setDeck] = useState<Card[]>([]);
  const [playerHand, setPlayerHand] = useState<Card[]>([]);
  const [dealerHand, setDealerHand] = useState<Card[]>([]);
  const [stake, setStake] = useState(25);
  const [message, setMessage] = useState('Place your bet');
  
  // Create and Shuffle Deck
  const createDeck = () => {
    const newDeck: Card[] = [];
    for (const suit of SUITS) {
      for (const val of VALUES) {
        let num = parseInt(val);
        if (['J', 'Q', 'K'].includes(val)) num = 10;
        if (val === 'A') num = 11;
        newDeck.push({ suit, value: val, numValue: num });
      }
    }
    return newDeck.sort(() => Math.random() - 0.5);
  };

  const calcScore = (hand: Card[]) => {
    let score = hand.reduce((acc, card) => acc + card.numValue, 0);
    let aces = hand.filter(c => c.value === 'A').length;
    while (score > 21 && aces > 0) {
      score -= 10;
      aces -= 1;
    }
    return score;
  };

  const dealGame = () => {
    if (userBalance < stake) {
        setMessage('Insufficient Funds');
        return;
    }
    onBalanceUpdate(-stake);
    const d = createDeck();
    const pHand = [d.pop()!, d.pop()!];
    const dHand = [d.pop()!, d.pop()!];
    
    setDeck(d);
    setPlayerHand(pHand);
    setDealerHand(dHand);
    setGameState('PLAYING');
    setMessage('Hit or Stand?');

    // Check Instant Blackjack
    if (calcScore(pHand) === 21) {
        if (calcScore(dHand) === 21) {
            endGame('PUSH', pHand, dHand, 1); // Push
        } else {
            endGame('BLACKJACK', pHand, dHand, 2.5); // 3:2 payout (stake back + 1.5x)
        }
    }
  };

  const hit = () => {
    const newCard = deck.pop()!;
    const newHand = [...playerHand, newCard];
    setPlayerHand(newHand);
    const score = calcScore(newHand);
    
    if (score > 21) {
        endGame('BUST', newHand, dealerHand, 0);
    }
  };

  const stand = () => {
    setGameState('DEALER_TURN');
    let dHand = [...dealerHand];
    let dDeck = [...deck];
    
    // Dealer logic: Hit on soft 17? Let's say stand on all 17s for simplicity
    while (calcScore(dHand) < 17) {
        dHand.push(dDeck.pop()!);
    }
    setDealerHand(dHand);
    setDeck(dDeck);
    
    const pScore = calcScore(playerHand);
    const dScore = calcScore(dHand);

    if (dScore > 21) {
        endGame('DEALER BUST', playerHand, dHand, 2);
    } else if (pScore > dScore) {
        endGame('YOU WIN', playerHand, dHand, 2);
    } else if (pScore === dScore) {
        endGame('PUSH', playerHand, dHand, 1);
    } else {
        endGame('DEALER WINS', playerHand, dHand, 0);
    }
  };

  const endGame = (msg: string, pHand: Card[], dHand: Card[], multiplier: number) => {
    setGameState('FINISHED');
    setMessage(msg);
    if (multiplier > 0) {
        onBalanceUpdate(Number((stake * multiplier).toFixed(2)));
    }
  };

  return (
    <div className="flex flex-col items-center justify-between min-h-[600px] bg-[#0f4d2a] rounded-xl p-6 border-[10px] border-[#2f2f2f] shadow-2xl relative">
       <button onClick={onClose} className="absolute top-4 left-4 text-white/50 hover:text-white font-bold z-10">‹ Exit Table</button>
       
       <div className="text-center w-full">
           <h2 className="text-yellow-400 font-bold tracking-widest opacity-50 mb-4">BLACKJACK PRO</h2>
           <div className="flex justify-center gap-2 min-h-[100px] mb-4">
                {gameState === 'BETTING' ? (
                    <div className="w-16 h-24 border-2 border-dashed border-white/20 rounded"></div>
                ) : (
                    dealerHand.map((c, i) => (
                        <CardView key={i} card={c} hidden={gameState === 'PLAYING' && i === 0} />
                    ))
                )}
           </div>
           {gameState !== 'BETTING' && gameState !== 'PLAYING' && (
               <div className="text-white font-bold bg-black/40 inline-block px-3 rounded">{calcScore(dealerHand)}</div>
           )}
       </div>

       <div className="text-2xl text-white font-bold my-4 drop-shadow-md">{message}</div>

       <div className="text-center w-full mb-8">
           {gameState !== 'BETTING' && (
             <div className="text-white font-bold bg-black/40 inline-block px-3 rounded mb-2">{calcScore(playerHand)}</div>
           )}
           <div className="flex justify-center gap-2 min-h-[100px]">
                {gameState === 'BETTING' ? (
                    <div className="w-16 h-24 border-2 border-dashed border-white/20 rounded"></div>
                ) : (
                    playerHand.map((c, i) => <CardView key={i} card={c} />)
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
                   <div className="flex items-center gap-2">
                       <button onClick={() => setStake(Math.max(5, stake - 5))} className="bg-white/10 hover:bg-white/20 text-white w-8 h-8 rounded">-</button>
                       <div className="text-white font-bold w-12 text-center">{stake}</div>
                       <button onClick={() => setStake(stake + 5)} className="bg-white/10 hover:bg-white/20 text-white w-8 h-8 rounded">+</button>
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