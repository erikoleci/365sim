import React, { useState, useEffect } from 'react';

interface BaccaratProps {
  onBalanceUpdate: (amount: number) => void;
  userBalance: number;
  onClose: () => void;
}

type Card = { suit: string; value: string; numValue: number };
const SUITS = ['♠', '♥', '♦', '♣'];
const VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const getCardColor = (suit: string) => (suit === '♥' || suit === '♦' ? 'text-red-500' : 'text-black');

// Baccarat Value: 10, J, Q, K = 0. A = 1. Others face value.
const getBaccaratValue = (val: string) => {
    if (['10', 'J', 'Q', 'K'].includes(val)) return 0;
    if (val === 'A') return 1;
    return parseInt(val);
};

const CardView: React.FC<{ card: Card }> = ({ card }) => (
  <div className="w-16 h-24 bg-white rounded flex flex-col items-center justify-center border-2 border-gray-300 shadow-md transform transition-transform hover:scale-105">
      <div className={`text-xl font-bold ${getCardColor(card.suit)}`}>{card.value}</div>
      <div className={`text-2xl ${getCardColor(card.suit)}`}>{card.suit}</div>
  </div>
);

const Baccarat: React.FC<BaccaratProps> = ({ onBalanceUpdate, userBalance, onClose }) => {
  const [gameState, setGameState] = useState<'BETTING' | 'DEALING' | 'FINISHED'>('BETTING');
  const [playerHand, setPlayerHand] = useState<Card[]>([]);
  const [bankerHand, setBankerHand] = useState<Card[]>([]);
  const [selectedBet, setSelectedBet] = useState<'PLAYER' | 'BANKER' | 'TIE' | null>(null);
  const [stake, setStake] = useState(50);
  const [message, setMessage] = useState('Select a hand to bet on');
  const [winner, setWinner] = useState<'PLAYER' | 'BANKER' | 'TIE' | null>(null);

  const getRandomCard = (): Card => {
      const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
      const value = VALUES[Math.floor(Math.random() * VALUES.length)];
      return { suit, value, numValue: getBaccaratValue(value) };
  };

  const calculateScore = (hand: Card[]) => {
      const total = hand.reduce((acc, c) => acc + c.numValue, 0);
      return total % 10; // Baccarat is digit only (e.g., 15 = 5)
  };

  const placeBet = (type: 'PLAYER' | 'BANKER' | 'TIE') => {
      if (gameState !== 'BETTING') return;
      setSelectedBet(type);
      setMessage(`Betting ${stake} on ${type}`);
  };

  const deal = async () => {
      if (!selectedBet) {
          setMessage('Please select a bet first!');
          return;
      }
      if (userBalance < stake) {
          setMessage('Insufficient Funds');
          return;
      }

      onBalanceUpdate(-stake);
      setGameState('DEALING');
      setMessage('Dealing...');
      setPlayerHand([]);
      setBankerHand([]);
      setWinner(null);

      // Initial Deal
      const p1 = getRandomCard();
      const b1 = getRandomCard();
      const p2 = getRandomCard();
      const b2 = getRandomCard();

      await new Promise(r => setTimeout(r, 500));
      setPlayerHand([p1]);
      await new Promise(r => setTimeout(r, 500));
      setBankerHand([b1]);
      await new Promise(r => setTimeout(r, 500));
      setPlayerHand([p1, p2]);
      await new Promise(r => setTimeout(r, 500));
      setBankerHand([b1, b2]);

      let pScore = calculateScore([p1, p2]);
      let bScore = calculateScore([b1, b2]);

      let finalPHand = [p1, p2];
      let finalBHand = [b1, b2];

      // Natural Win Check (8 or 9)
      if (pScore >= 8 || bScore >= 8) {
          // Natural - no more cards
      } else {
          // Drawing Rules
          let p3: Card | null = null;
          
          // Player Rule: 0-5 draws
          if (pScore <= 5) {
              await new Promise(r => setTimeout(r, 800));
              p3 = getRandomCard();
              finalPHand.push(p3);
              setPlayerHand([...finalPHand]);
              pScore = calculateScore(finalPHand);
          }

          // Banker Rule (Complex)
          let bankerDraws = false;
          if (bScore <= 2) bankerDraws = true;
          else if (bScore === 3) bankerDraws = p3?.numValue !== 8; // Draws unless Player 3rd was 8
          else if (bScore === 4) bankerDraws = p3 === null || [2,3,4,5,6,7].includes(p3.numValue);
          else if (bScore === 5) bankerDraws = p3 === null || [4,5,6,7].includes(p3.numValue);
          else if (bScore === 6) bankerDraws = p3 !== null && [6,7].includes(p3.numValue);
          // 7 stands

          if (bankerDraws) {
              await new Promise(r => setTimeout(r, 800));
              const b3 = getRandomCard();
              finalBHand.push(b3);
              setBankerHand([...finalBHand]);
              bScore = calculateScore(finalBHand);
          }
      }

      // Determine Winner
      let result: 'PLAYER' | 'BANKER' | 'TIE';
      if (pScore > bScore) result = 'PLAYER';
      else if (bScore > pScore) result = 'BANKER';
      else result = 'TIE';

      setWinner(result);
      setGameState('FINISHED');

      // Payouts
      let winAmount = 0;
      if (result === selectedBet) {
          if (result === 'PLAYER') winAmount = stake * 2;
          if (result === 'BANKER') winAmount = stake * 1.95; // 5% commission
          if (result === 'TIE') winAmount = stake * 9; // 8:1 usually
          
          onBalanceUpdate(Number(winAmount.toFixed(2)));
          setMessage(`${result} WINS! You won ${winAmount.toFixed(2)}`);
      } else {
          setMessage(`${result} WINS! You lost.`);
      }
  };

  const reset = () => {
      setGameState('BETTING');
      setPlayerHand([]);
      setBankerHand([]);
      setWinner(null);
      setMessage('Place your bet');
  };

  return (
    <div className="flex flex-col items-center min-h-[600px] bg-[#1a472a] rounded-xl p-6 border-4 border-[#d4af37] relative shadow-2xl overflow-hidden">
       {/* Felt Texture Overlay */}
       <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/felt.png')] opacity-30 pointer-events-none"></div>
       
       <button onClick={onClose} className="absolute top-4 left-4 text-white/70 hover:text-white font-bold z-10">‹ Lobby</button>
       
       <div className="relative z-10 w-full max-w-4xl flex flex-col items-center">
            <h2 className="text-4xl font-serif font-bold text-[#d4af37] mb-8 tracking-widest drop-shadow-md">BACCARAT</h2>

            {/* Table Area */}
            <div className="flex justify-between w-full mb-8 px-10 gap-20">
                {/* Player Area */}
                <div className="flex-1 flex flex-col items-center">
                    <div className="text-blue-200 font-bold text-xl mb-4 tracking-wider">PLAYER {gameState !== 'BETTING' && calculateScore(playerHand)}</div>
                    <div className="flex justify-center gap-2 min-h-[100px]">
                        {playerHand.length === 0 ? (
                             <div className="w-16 h-24 border-2 border-dashed border-blue-300/30 rounded"></div>
                        ) : (
                            playerHand.map((c, i) => <CardView key={i} card={c} />)
                        )}
                    </div>
                </div>

                {/* Banker Area */}
                <div className="flex-1 flex flex-col items-center">
                    <div className="text-red-200 font-bold text-xl mb-4 tracking-wider">BANKER {gameState !== 'BETTING' && calculateScore(bankerHand)}</div>
                    <div className="flex justify-center gap-2 min-h-[100px]">
                        {bankerHand.length === 0 ? (
                             <div className="w-16 h-24 border-2 border-dashed border-red-300/30 rounded"></div>
                        ) : (
                            bankerHand.map((c, i) => <CardView key={i} card={c} />)
                        )}
                    </div>
                </div>
            </div>

            {/* Result Message */}
            <div className="h-12 flex items-center justify-center w-full mb-6">
                 {gameState === 'FINISHED' && (
                     <div className="bg-black/50 px-8 py-2 rounded-full border border-[#d4af37] text-2xl font-bold text-white animate-bounce">
                         {message}
                     </div>
                 )}
                 {gameState !== 'FINISHED' && <div className="text-white/80 font-serif italic text-lg">{message}</div>}
            </div>

            {/* Betting Board */}
            <div className="w-full max-w-2xl grid grid-cols-3 gap-4 mb-8">
                <button 
                    onClick={() => placeBet('PLAYER')}
                    disabled={gameState !== 'BETTING'}
                    className={`h-24 rounded-lg border-2 flex flex-col items-center justify-center transition-all ${selectedBet === 'PLAYER' ? 'bg-blue-600 border-yellow-400 scale-105 shadow-[0_0_15px_rgba(59,130,246,0.5)]' : 'bg-blue-900/40 border-blue-400/30 hover:bg-blue-800/50'}`}
                >
                    <span className="text-xl font-bold text-white">PLAYER</span>
                    <span className="text-xs text-blue-200">Pays 1:1</span>
                    {selectedBet === 'PLAYER' && <span className="mt-2 bg-yellow-400 text-black text-xs font-bold px-2 rounded-full">{stake}</span>}
                </button>

                <button 
                    onClick={() => placeBet('TIE')}
                    disabled={gameState !== 'BETTING'}
                    className={`h-24 rounded-lg border-2 flex flex-col items-center justify-center transition-all ${selectedBet === 'TIE' ? 'bg-green-600 border-yellow-400 scale-105 shadow-[0_0_15px_rgba(34,197,94,0.5)]' : 'bg-green-900/40 border-green-400/30 hover:bg-green-800/50'}`}
                >
                    <span className="text-xl font-bold text-white">TIE</span>
                    <span className="text-xs text-green-200">Pays 8:1</span>
                    {selectedBet === 'TIE' && <span className="mt-2 bg-yellow-400 text-black text-xs font-bold px-2 rounded-full">{stake}</span>}
                </button>

                <button 
                    onClick={() => placeBet('BANKER')}
                    disabled={gameState !== 'BETTING'}
                    className={`h-24 rounded-lg border-2 flex flex-col items-center justify-center transition-all ${selectedBet === 'BANKER' ? 'bg-red-600 border-yellow-400 scale-105 shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'bg-red-900/40 border-red-400/30 hover:bg-red-800/50'}`}
                >
                    <span className="text-xl font-bold text-white">BANKER</span>
                    <span className="text-xs text-red-200">Pays 0.95:1</span>
                    {selectedBet === 'BANKER' && <span className="mt-2 bg-yellow-400 text-black text-xs font-bold px-2 rounded-full">{stake}</span>}
                </button>
            </div>

            {/* Controls */}
            <div className="bg-black/40 p-4 rounded-xl w-full max-w-2xl flex justify-between items-center border border-white/10">
                <div className="text-white">
                    <div className="text-xs opacity-60 uppercase">Balance</div>
                    <div className="text-xl font-bold text-[#d4af37]">{userBalance.toFixed(2)}</div>
                </div>

                <div className="flex gap-4 items-center">
                    <div className="flex items-center bg-black/40 rounded p-1">
                        <button onClick={() => setStake(Math.max(10, stake - 10))} className="w-8 h-8 text-white hover:bg-white/10 rounded font-bold">-</button>
                        <input type="number" readOnly value={stake} className="w-16 bg-transparent text-center text-white font-bold outline-none" />
                        <button onClick={() => setStake(stake + 10)} className="w-8 h-8 text-white hover:bg-white/10 rounded font-bold">+</button>
                    </div>

                    <button 
                        onClick={gameState === 'FINISHED' ? reset : deal}
                        className={`px-8 py-3 rounded font-bold text-black uppercase tracking-widest shadow-lg transition-transform active:scale-95 ${gameState === 'BETTING' && !selectedBet ? 'bg-gray-500 cursor-not-allowed' : 'bg-[#d4af37] hover:bg-yellow-400'}`}
                        disabled={gameState === 'DEALING' || (gameState === 'BETTING' && !selectedBet)}
                    >
                        {gameState === 'FINISHED' ? 'New Game' : 'Deal'}
                    </button>
                </div>
            </div>
       </div>
    </div>
  );
};

export default Baccarat;