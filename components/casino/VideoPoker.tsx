import React, { useState } from 'react';
import { casinoVideoPokerDeal, casinoVideoPokerDraw, PokerCard } from '../../services/api';

interface VideoPokerProps {
  onSetBalance: (balance: number) => void;
  userBalance: number;
  onClose: () => void;
}

const getCardColor = (suit: string) => (suit === '♥' || suit === '♦' ? 'text-red-500' : 'text-black');

const VideoPoker: React.FC<VideoPokerProps> = ({ onSetBalance, userBalance, onClose }) => {
  const [hand, setHand] = useState<PokerCard[]>([]);
  const [heldIndices, setHeldIndices] = useState<number[]>([]);
  const [gameStage, setGameStage] = useState<'BET' | 'DRAW' | 'OVER'>('BET');
  const [stake, setStake] = useState(10);
  const [message, setMessage] = useState('Jacks or Better');
  const [roundId, setRoundId] = useState<string | null>(null);

  const deal = async () => {
      if (userBalance < stake) {
          setMessage('Insufficient Funds');
          return;
      }
      try {
          const res = await casinoVideoPokerDeal(stake);
          setRoundId(res.roundId);
          setHand(res.hand);
          setHeldIndices([]);
          setGameStage('DRAW');
          onSetBalance(res.balance);
          setMessage('Hold cards and Draw');
      } catch (err: any) {
          setMessage(err?.message || 'Something went wrong');
      }
  };

  const toggleHold = (index: number) => {
      if (gameStage !== 'DRAW') return;
      if (heldIndices.includes(index)) {
          setHeldIndices(heldIndices.filter(i => i !== index));
      } else {
          setHeldIndices([...heldIndices, index]);
      }
  };

  const draw = async () => {
      if (!roundId) return;
      try {
          const res = await casinoVideoPokerDraw(roundId, heldIndices);
          setHand(res.hand);
          setGameStage('OVER');
          onSetBalance(res.balance);
          setMessage(res.payout > 0 ? `${res.tier}! WON ${res.payout}` : 'Game Over');
      } catch (err: any) {
          setMessage(err?.message || 'Something went wrong');
      }
  };

  const reset = () => {
      setGameStage('BET');
      setHand([]);
      setRoundId(null);
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
