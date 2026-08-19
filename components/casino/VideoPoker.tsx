import React, { useState } from 'react';
import { placeCasinoWager, settleCasinoWager } from '../../services/api';

interface VideoPokerProps {
  onBalanceUpdate: (amount: number) => void;
  userBalance: number;
  onClose: () => void;
}

type Card = { suit: string; value: string; id: number };
const SUITS = ['♠', '♥', '♦', '♣'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const getCardColor = (suit: string) => (suit === '♥' || suit === '♦' ? 'text-red-500' : 'text-black');

const VideoPoker: React.FC<VideoPokerProps> = ({ onBalanceUpdate, userBalance, onClose }) => {
  const [hand, setHand] = useState<Card[]>([]);
  const [heldIndices, setHeldIndices] = useState<number[]>([]);
  const [gameStage, setGameStage] = useState<'BET' | 'DEAL' | 'DRAW' | 'OVER'>('BET');
  const [stake, setStake] = useState(10);
  const [message, setMessage] = useState('Jacks or Better');
  const [wagerId, setWagerId] = useState<string | null>(null);

  // Helper to generate a random card
  const getRandomCard = () => {
      const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
      const value = VALUES[Math.floor(Math.random() * VALUES.length)];
      return { suit, value, id: Math.random() };
  };

  const deal = async () => {
      if (userBalance < stake) {
          setMessage('Insufficient Funds');
          return;
      }
      try {
          const { wagerId: id, balance } = await placeCasinoWager('poker', stake);
          setWagerId(id);
          onBalanceUpdate(balance - userBalance);
      } catch (err: any) {
          setMessage(err?.message || 'Could not place bet');
          return;
      }

      // Deal 5 random cards
      const newHand = Array.from({ length: 5 }, () => getRandomCard());
      setHand(newHand);
      setHeldIndices([]);
      setGameStage('DRAW');
      setMessage('Hold cards and Draw');
  };

  const toggleHold = (index: number) => {
      if (gameStage !== 'DRAW') return;
      if (heldIndices.includes(index)) {
          setHeldIndices(heldIndices.filter(i => i !== index));
      } else {
          setHeldIndices([...heldIndices, index]);
      }
  };

  // Honest Jacks-or-Better hand evaluation, matching the paytable shown above.
  const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const rankValue = (v: string) => RANK_ORDER.indexOf(v) + 2;

  const evaluateHand = (cards: Card[]): { name: string; multiplier: number } => {
      const values = cards.map((c) => rankValue(c.value)).sort((a, b) => a - b);
      const suits = cards.map((c) => c.suit);
      const isFlush = suits.every((s) => s === suits[0]);

      let isStraight = values.every((v, i) => i === 0 || v === values[i - 1] + 1);
      let isAceLowStraight = false;
      if (!isStraight) {
          const aceLow = values.map((v) => (v === 14 ? 1 : v)).sort((a, b) => a - b);
          isAceLowStraight = aceLow.every((v, i) => i === 0 || v === aceLow[i - 1] + 1);
          if (isAceLowStraight) isStraight = true;
      }

      const counts: Record<number, number> = {};
      values.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
      const countValues = Object.values(counts).sort((a, b) => b - a);
      const isRoyal = isStraight && isFlush && !isAceLowStraight && values[0] === 10 && values[4] === 14;

      if (isRoyal) return { name: 'ROYAL FLUSH', multiplier: 800 };
      if (isStraight && isFlush) return { name: 'STRAIGHT FLUSH', multiplier: 50 };
      if (countValues[0] === 4) return { name: '4 OF A KIND', multiplier: 25 };
      if (countValues[0] === 3 && countValues[1] === 2) return { name: 'FULL HOUSE', multiplier: 9 };
      if (isFlush) return { name: 'FLUSH', multiplier: 6 };
      if (isStraight) return { name: 'STRAIGHT', multiplier: 4 };
      if (countValues[0] === 3) return { name: '3 OF A KIND', multiplier: 3 };
      if (countValues[0] === 2 && countValues[1] === 2) return { name: '2 PAIR', multiplier: 2 };
      if (countValues[0] === 2) {
          const pairValue = Number(Object.keys(counts).find((k) => counts[Number(k)] === 2));
          if (pairValue >= 11) return { name: 'JACKS OR BETTER', multiplier: 1 };
      }
      return { name: 'NO WIN', multiplier: 0 };
  };

  const draw = async () => {
      // Deal genuinely random replacement cards for every slot the player
      // didn't hold — no post-hoc rigging of the result.
      const newHand = hand.map((card, idx) => (heldIndices.includes(idx) ? card : getRandomCard()));
      setHand(newHand);
      setGameStage('OVER');

      const result = evaluateHand(newHand);
      if (!wagerId) return; // shouldn't happen — deal() always sets it before DRAW stage is reachable

      try {
          const { balance } = await settleCasinoWager(wagerId, result.multiplier);
          onBalanceUpdate(balance - userBalance);
      } catch (err: any) {
          setMessage(err?.message || 'Could not settle wager');
          return;
      }

      if (result.multiplier > 0) {
          const payout = stake * result.multiplier;
          setMessage(`${result.name}! Won ${payout.toFixed(2)}`);
      } else {
          setMessage('No win — try again');
      }
  };

  const reset = () => {
      setGameStage('BET');
      setHand([]);
      setMessage('Jacks or Better');
  };

  return (
    <div className="flex flex-col items-center justify-between min-h-[600px] bg-[#003366] rounded-xl p-6 border-4 border-blue-400 relative shadow-2xl">
      <button onClick={onClose} className="absolute top-4 left-4 text-white hover:text-blue-200 font-bold z-10">‹ Exit</button>
      
      <div className="text-center mb-4">
        <h2 className="text-3xl font-bold text-blue-200 italic tracking-tighter">VIDEO POKER</h2>
        <div className="text-blue-300 text-xs">JACKS OR BETTER</div>
      </div>

      {/* Paytable Visual (Static) */}
      <div className="bg-blue-900/50 p-2 rounded text-[10px] text-blue-200 grid grid-cols-2 gap-x-8 mb-4 w-full max-w-lg border border-blue-500/30">
          <div className="flex justify-between"><span>ROYAL FLUSH</span><span className="text-yellow-400">800</span></div>
          <div className="flex justify-between"><span>STRAIGHT FLUSH</span><span className="text-yellow-400">50</span></div>
          <div className="flex justify-between"><span>4 OF A KIND</span><span className="text-yellow-400">25</span></div>
          <div className="flex justify-between"><span>FULL HOUSE</span><span className="text-yellow-400">9</span></div>
          <div className="flex justify-between"><span>FLUSH</span><span className="text-yellow-400">6</span></div>
          <div className="flex justify-between"><span>STRAIGHT</span><span className="text-yellow-400">4</span></div>
          <div className="flex justify-between"><span>3 OF A KIND</span><span className="text-yellow-400">3</span></div>
          <div className="flex justify-between"><span>2 PAIR</span><span className="text-yellow-400">2</span></div>
          <div className="flex justify-between"><span>JACKS OR BETTER</span><span className="text-yellow-400">1</span></div>
      </div>

      {/* Cards Area */}
      <div className="flex justify-center gap-2 h-32 mb-4">
          {hand.length === 0 ? (
              // Empty Placeholders
              Array.from({length:5}).map((_, i) => (
                  <div key={i} className="w-20 h-28 bg-blue-800 rounded border border-blue-600"></div>
              ))
          ) : (
              hand.map((card, idx) => (
                  <div key={idx} className="relative">
                      {/* Card */}
                      <div className="w-20 h-28 bg-white rounded flex flex-col items-center justify-center shadow-lg border-2 border-gray-200">
                          <div className={`text-xl font-bold ${getCardColor(card.suit)}`}>{card.value}</div>
                          <div className={`text-3xl ${getCardColor(card.suit)}`}>{card.suit}</div>
                      </div>
                      
                      {/* Hold Button / Badge */}
                      {gameStage === 'DRAW' && (
                          <button 
                            onClick={() => toggleHold(idx)}
                            className={`absolute -bottom-4 left-1/2 transform -translate-x-1/2 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider shadow-sm transition-colors ${heldIndices.includes(idx) ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                          >
                              {heldIndices.includes(idx) ? 'HELD' : 'HOLD'}
                          </button>
                      )}
                      {gameStage === 'OVER' && heldIndices.includes(idx) && (
                          <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2 text-[10px] font-bold px-2 py-1 rounded uppercase bg-gray-600 text-gray-300">
                              HELD
                          </div>
                      )}
                  </div>
              ))
          )}
      </div>

      <div className="text-2xl font-bold text-white h-8 mb-4">{message}</div>

      {/* Controls */}
      <div className="w-full max-w-lg bg-black/30 p-4 rounded-xl border-t border-blue-500/30 flex items-center justify-between">
          <div className="text-white">
               <div className="text-xs text-blue-300">Balance</div>
               <div className="font-bold text-yellow-400">{userBalance.toFixed(2)}</div>
          </div>
          
          {gameStage === 'BET' || gameStage === 'OVER' ? (
              <div className="flex gap-4 items-center">
                  <div className="flex items-center gap-2">
                       <button onClick={() => setStake(Math.max(1, stake - 5))} className="w-8 h-8 bg-blue-800 text-white rounded font-bold">-</button>
                       <span className="text-white font-bold w-8 text-center">{stake}</span>
                       <button onClick={() => setStake(stake + 5)} className="w-8 h-8 bg-blue-800 text-white rounded font-bold">+</button>
                  </div>
                  <button 
                    onClick={gameStage === 'OVER' ? reset : deal}
                    className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold px-8 py-2 rounded shadow-lg uppercase"
                  >
                      {gameStage === 'OVER' ? 'NEW GAME' : 'DEAL'}
                  </button>
              </div>
          ) : (
              <button 
                onClick={draw}
                className="bg-green-500 hover:bg-green-400 text-white font-bold px-12 py-3 rounded shadow-lg uppercase w-full max-w-xs"
              >
                  DRAW
              </button>
          )}
      </div>
    </div>
  );
};

export default VideoPoker;