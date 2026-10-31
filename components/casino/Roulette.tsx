import React, { useCallback, useRef, useState } from 'react';
import { casinoRouletteSpin } from '../../services/api';
import RouletteWheel, { WheelPhase } from './RouletteWheel';
import Croupier, { CroupierMood } from './Croupier';

interface RouletteProps {
  onSetBalance: (balance: number) => void;
  userBalance: number;
  onClose: () => void;
}

// Simple Layout: 0 (Green), 1-36 (Red/Black)
const NUMBERS = Array.from({ length: 37 }, (_, i) => i);
const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

const getColor = (num: number) => {
  if (num === 0) return 'bg-green-600';
  if (RED_NUMBERS.includes(num)) return 'bg-red-600';
  return 'bg-gray-900'; // Black
};

const Roulette: React.FC<RouletteProps> = ({ onSetBalance, userBalance, onClose }) => {
  const [bets, setBets] = useState<Record<string, number>>({});
  const [spinning, setSpinning] = useState(false);
  const [phase, setPhase] = useState<WheelPhase>('idle');
  const [landResult, setLandResult] = useState<number | null>(null); // the number the ball is told to land on
  const [mood, setMood] = useState<CroupierMood>('idle');
  // The server's answer is held here until the ball has really landed, so the result is never shown early.
  const outcome = useRef<{ result: number; payout: number; balance: number } | null>(null);
  const [resultNumber, setResultNumber] = useState<number | null>(null);
  const [message, setMessage] = useState('Place your bets');
  const [chipValue, setChipValue] = useState(10);

  const totalBet = Object.values(bets).reduce((a, b) => a + b, 0);

  const placeBet = (spot: string) => {
    if (spinning) return;
    if (userBalance - totalBet < chipValue) {
        setMessage('Insufficient funds for this bet');
        return;
    }
    setBets(prev => ({
        ...prev,
        [spot]: (prev[spot] || 0) + chipValue
    }));
  };

  const clearBets = () => {
      if (spinning) return;
      setBets({});
      setMessage('Bets cleared');
  };

  const MIN_SPIN_MS = 1300; // the wheel gets up to speed before the ball is allowed to drop

  const spinWheel = async () => {
    if (totalBet === 0) {
        setMessage('Place a bet first');
        return;
    }
    if (spinning) return;

    setSpinning(true);
    setMessage('No more bets...');
    setResultNumber(null);
    setMood('spinning');
    setPhase('spinning'); // the wheel and the ball start at once; the answer arrives while they turn

    try {
        const startedAt = Date.now();
        const answer = await casinoRouletteSpin(bets);
        const wait = Math.max(0, MIN_SPIN_MS - (Date.now() - startedAt));
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        outcome.current = answer;
        setLandResult(answer.result);
        setPhase('landing'); // the ball slows down and drops into the pocket; onLanded reveals the result
    } catch (err: any) {
        setPhase('idle');
        setMood('idle');
        setSpinning(false);
        setMessage(err?.message || 'Something went wrong');
    }
  };

  // Called by the wheel once the ball has settled in its pocket.
  const onLanded = useCallback(() => {
    const out = outcome.current;
    outcome.current = null;
    setPhase('idle');
    setSpinning(false);
    if (!out) { setMood('idle'); return; }
    setResultNumber(out.result);
    onSetBalance(out.balance);
    if (out.payout > 0) {
        setMessage(`You Win ${out.payout}!`);
        setMood('win');
    } else {
        setMessage('House Wins.');
        setMood('lose');
    }
    setBets({});
  }, [onSetBalance]);

  return (
    <div className="flex flex-col items-center min-h-[600px] bg-[#1a1a1a] rounded-xl p-6 border-4 border-[#d4af37] relative shadow-2xl">
      <button onClick={onClose} className="absolute top-4 left-4 text-white hover:text-yellow-400 font-bold z-10">‹ Exit</button>
      
      <h2 className="text-3xl font-bold text-[#d4af37] mb-2 tracking-widest uppercase">Roulette Royale</h2>
      <div className="text-xs text-gray-500 mb-6">European Rules • High Limit</div>

      {/* Table: the croupier behind the wheel, the ball and the result */}
      <div className="mb-6 w-full max-w-2xl flex flex-col items-center">
          <div className="flex items-end justify-center gap-2 sm:gap-6 w-full">
              <div className="shrink-0 w-[96px] sm:w-[140px]"><Croupier mood={mood} size={140} /></div>
              <div className="relative shrink min-w-0 w-[220px] sm:w-[290px]">
                  <RouletteWheel phase={phase} result={landResult} onLanded={onLanded} size={290} />
                  {resultNumber !== null && !spinning && (
                      <div className={`absolute -top-1 -right-1 w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold text-white border-2 border-white shadow-lg ${getColor(resultNumber)}`}>
                          {resultNumber}
                      </div>
                  )}
              </div>
          </div>
          <div className="mt-3 text-xl font-bold text-yellow-400 min-h-[2rem] text-center">{message}</div>
      </div>

      {/* Betting Board */}
      <div className="bg-green-800 p-4 rounded-lg shadow-inner border border-green-700 max-w-2xl w-full">
          {/* Top Row: 0 */}
          <div className="flex justify-center mb-1">
              <button 
                onClick={() => placeBet('0')}
                className={`w-full h-12 rounded border border-white/20 flex items-center justify-center text-white font-bold hover:opacity-80 relative bg-green-600`}
              >
                  0
                  {bets['0'] && <div className="absolute -top-2 -right-2 bg-yellow-400 text-black text-[10px] rounded-full w-5 h-5 flex items-center justify-center shadow font-bold">{bets['0']}</div>}
              </button>
          </div>

          {/* Numbers Grid */}
          <div className="grid grid-cols-12 gap-1 mb-4">
              {NUMBERS.slice(1).map(num => (
                  <button 
                    key={num}
                    onClick={() => placeBet(num.toString())}
                    className={`h-12 rounded border border-white/20 flex items-center justify-center text-white font-bold hover:opacity-80 relative ${getColor(num)}`}
                  >
                      {num}
                      {bets[num] && <div className="absolute -top-2 -right-2 bg-yellow-400 text-black text-[10px] rounded-full w-5 h-5 flex items-center justify-center shadow font-bold">{bets[num]}</div>}
                  </button>
              ))}
          </div>

          {/* Outside Bets */}
          <div className="grid grid-cols-4 gap-2">
               <button onClick={() => placeBet('EVEN')} className="bg-transparent border border-white/30 text-white py-2 rounded hover:bg-white/10 relative font-bold text-xs uppercase">
                   EVEN
                   {bets['EVEN'] && <div className="absolute -top-2 -right-2 bg-yellow-400 text-black text-[10px] rounded-full w-5 h-5 flex items-center justify-center shadow font-bold">{bets['EVEN']}</div>}
               </button>
               <button onClick={() => placeBet('RED')} className="bg-red-600 border border-white/30 text-white py-2 rounded hover:opacity-80 relative font-bold text-xs uppercase">
                   RED
                   {bets['RED'] && <div className="absolute -top-2 -right-2 bg-yellow-400 text-black text-[10px] rounded-full w-5 h-5 flex items-center justify-center shadow font-bold">{bets['RED']}</div>}
               </button>
               <button onClick={() => placeBet('BLACK')} className="bg-gray-900 border border-white/30 text-white py-2 rounded hover:opacity-80 relative font-bold text-xs uppercase">
                   BLACK
                   {bets['BLACK'] && <div className="absolute -top-2 -right-2 bg-yellow-400 text-black text-[10px] rounded-full w-5 h-5 flex items-center justify-center shadow font-bold">{bets['BLACK']}</div>}
               </button>
               <button onClick={() => placeBet('ODD')} className="bg-transparent border border-white/30 text-white py-2 rounded hover:bg-white/10 relative font-bold text-xs uppercase">
                   ODD
                   {bets['ODD'] && <div className="absolute -top-2 -right-2 bg-yellow-400 text-black text-[10px] rounded-full w-5 h-5 flex items-center justify-center shadow font-bold">{bets['ODD']}</div>}
               </button>
          </div>
      </div>

      {/* Controls */}
      <div className="mt-6 flex items-center justify-between w-full max-w-2xl bg-black/40 p-4 rounded-lg">
          <div className="text-white">
              <div className="text-xs text-gray-400">Balance</div>
              <div className="text-xl font-bold text-yellow-400">{userBalance.toFixed(2)}</div>
          </div>

          <div className="flex items-center gap-2">
              <div className="text-xs text-gray-400 uppercase mr-2">Chip Value:</div>
              {[10, 50, 100].map(val => (
                  <button 
                    key={val}
                    onClick={() => setChipValue(val)}
                    className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-transform hover:scale-110 ${chipValue === val ? 'border-yellow-400 bg-yellow-600 text-black' : 'border-gray-500 bg-gray-700 text-white'}`}
                  >
                      {val}
                  </button>
              ))}
          </div>

          <div className="flex gap-2">
             <button onClick={clearBets} disabled={spinning} className="px-4 py-2 text-white text-xs hover:underline disabled:opacity-50">Clear</button>
             <button 
                onClick={spinWheel} 
                disabled={spinning}
                className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold px-8 py-3 rounded shadow-lg uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
            >
                 {spinning ? 'Spinning...' : 'SPIN'}
             </button>
          </div>
      </div>
    </div>
  );
};

export default Roulette;