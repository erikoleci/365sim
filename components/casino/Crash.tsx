import React, { useState, useEffect, useRef } from 'react';
import { casinoCrashStart, casinoCrashStatus, casinoCrashCashout } from '../../services/api';

interface CrashProps {
  onSetBalance: (balance: number) => void;
  userBalance: number;
  onClose: () => void;
}

const Crash: React.FC<CrashProps> = ({ onSetBalance, userBalance, onClose }) => {
  const [multiplier, setMultiplier] = useState(1.00);
  const [gameState, setGameState] = useState<'IDLE' | 'RUNNING' | 'CRASHED' | 'CASHED_OUT'>('IDLE');
  const [stake, setStake] = useState(10);
  const [cashedAt, setCashedAt] = useState<number | null>(null);

  const requestRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const roundIdRef = useRef<string | null>(null);

  const startGame = async () => {
    if (userBalance < stake || gameState === 'RUNNING') return;

    try {
      const { roundId, balance } = await casinoCrashStart(stake);
      onSetBalance(balance);
      roundIdRef.current = roundId;

      // Brief authoritative check: the server already knows whether this
      // round crashes instantly (the ~99% case) or is a real, reachable
      // crash point (~1%) — ask once before animating so we don't fake a
      // "running" state for a round that already crashed at 1.00x.
      const status = await casinoCrashStatus(roundId);
      if (status.crashed) {
        setMultiplier(status.multiplier ?? 1.00);
        setGameState('CRASHED');
        return;
      }

      setGameState('RUNNING');
      setMultiplier(1.00);
      setCashedAt(null);
      startTimeRef.current = Date.now();
      requestRef.current = requestAnimationFrame(tick);
    } catch (err) {
      // Insufficient balance or network error — nothing to animate.
    }
  };

  const tick = () => {
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    // Purely visual growth curve — the server independently decides, at
    // cashout time, whether this round had actually crashed by then.
    const currentMult = Math.floor((Math.exp(0.15 * elapsed)) * 100) / 100;
    setMultiplier(currentMult);
    requestRef.current = requestAnimationFrame(tick);
  };

  const cashOut = async () => {
      if (gameState !== 'RUNNING' || !roundIdRef.current) return;
      cancelAnimationFrame(requestRef.current!);

      try {
        const { crashed, multiplier: finalMultiplier, payout, balance } = await casinoCrashCashout(roundIdRef.current);
        onSetBalance(balance);
        if (crashed) {
          setMultiplier(finalMultiplier);
          setGameState('CRASHED');
        } else {
          setMultiplier(finalMultiplier);
          setCashedAt(finalMultiplier);
          setGameState('CASHED_OUT');
        }
      } catch (err) {
        setGameState('CRASHED');
      }
  };

  // Cleanup on unmount
  useEffect(() => {
      return () => {
          if (requestRef.current) cancelAnimationFrame(requestRef.current);
      };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[600px] bg-[#0b0f19] rounded-xl p-6 border border-gray-800 relative shadow-2xl overflow-hidden font-mono">
       <button onClick={onClose} className="absolute top-4 left-4 text-gray-500 hover:text-white font-bold z-20">‹ Exit</button>
       
       {/* Game Canvas Area */}
       <div className="relative w-full max-w-2xl h-96 bg-[#161b2e] rounded-xl mb-6 flex items-center justify-center overflow-hidden border border-gray-700">
           {/* Grid lines background */}
           <div className="absolute inset-0 opacity-10" 
                style={{backgroundImage: 'linear-gradient(#444 1px, transparent 1px), linear-gradient(90deg, #444 1px, transparent 1px)', backgroundSize: '40px 40px'}}>
           </div>

           {/* Central Number */}
           <div className="z-10 text-center">
               <div className={`text-7xl font-bold transition-colors ${
                   gameState === 'CRASHED' ? 'text-red-500' : 
                   gameState === 'CASHED_OUT' ? 'text-green-400' : 'text-white'
               }`}>
                   {multiplier.toFixed(2)}x
               </div>
               {gameState === 'CRASHED' && <div className="text-red-500 font-bold mt-2 text-xl">CRASHED</div>}
               {gameState === 'CASHED_OUT' && <div className="text-green-400 font-bold mt-2 text-xl">WON {(stake * cashedAt!).toFixed(2)}</div>}
               {gameState === 'IDLE' && <div className="text-gray-500 mt-2">Ready to fly?</div>}
           </div>

           {/* Rocket graphic placeholder (moves up/right) */}
           {gameState === 'RUNNING' && (
               <div className="absolute bottom-10 left-10 w-4 h-4 bg-white rounded-full shadow-[0_0_20px_white] animate-pulse"></div>
           )}
       </div>

       {/* Controls */}
       <div className="w-full max-w-2xl bg-[#161b2e] p-6 rounded-xl border border-gray-700 flex justify-between items-center gap-6">
            <div className="flex-1">
                <div className="text-gray-400 text-xs mb-1 uppercase">Bet Amount</div>
                <div className="flex items-center bg-black/30 rounded border border-gray-600">
                    <button onClick={() => setStake(Math.max(1, stake - 5))} disabled={gameState === 'RUNNING'} className="px-3 py-2 text-gray-400 hover:text-white">-</button>
                    <input type="number" value={stake} onChange={(e) => setStake(Number(e.target.value))} disabled={gameState === 'RUNNING'} className="w-full bg-transparent text-center text-white font-bold outline-none py-2" />
                    <button onClick={() => setStake(stake + 5)} disabled={gameState === 'RUNNING'} className="px-3 py-2 text-gray-400 hover:text-white">+</button>
                </div>
                <div className="flex gap-2 mt-2">
                    {[10, 20, 50, 100].map(amt => (
                        <button key={amt} onClick={() => setStake(amt)} disabled={gameState === 'RUNNING'} className="flex-1 bg-gray-700 hover:bg-gray-600 text-xs text-white py-1 rounded">
                            {amt}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1">
                <div className="text-right text-gray-400 text-xs mb-1 uppercase">Balance: <span className="text-white font-bold">{userBalance.toFixed(2)}</span></div>
                
                {gameState === 'RUNNING' ? (
                    <button 
                        onClick={cashOut}
                        className="w-full h-14 bg-green-500 hover:bg-green-400 text-black font-bold text-xl rounded shadow-[0_0_15px_rgba(34,197,94,0.5)] transition-transform active:scale-95 uppercase"
                    >
                        Cash Out {(stake * multiplier).toFixed(0)}
                    </button>
                ) : (
                    <button 
                        onClick={startGame}
                        className="w-full h-14 bg-brand-accent hover:bg-brand-header text-brand-bg font-bold text-xl rounded shadow-lg transition-transform active:scale-95 uppercase"
                    >
                        {gameState === 'IDLE' ? 'Place Bet' : 'Play Again'}
                    </button>
                )}
            </div>
       </div>
    </div>
  );
};

export default Crash;
