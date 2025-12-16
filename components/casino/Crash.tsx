import React, { useState, useEffect, useRef } from 'react';

interface CrashProps {
  onBalanceUpdate: (amount: number) => void;
  userBalance: number;
  onClose: () => void;
}

const Crash: React.FC<CrashProps> = ({ onBalanceUpdate, userBalance, onClose }) => {
  const [multiplier, setMultiplier] = useState(1.00);
  const [gameState, setGameState] = useState<'IDLE' | 'RUNNING' | 'CRASHED' | 'CASHED_OUT'>('IDLE');
  const [stake, setStake] = useState(10);
  const [crashPoint, setCrashPoint] = useState(0);
  const [cashedAt, setCashedAt] = useState<number | null>(null);
  
  const requestRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  const startGame = () => {
    if (userBalance < stake) return;
    onBalanceUpdate(-stake);
    
    // Determine crash point (Weighted randomness)
    // Most games crash early. 
    // Logic: 1% instant crash. 50% chance under 2.00x.
    const r = Math.random();
    let cp = 1.00;
    if (r < 0.02) cp = 1.00; // Instant crash
    else {
        // Simple inverse distribution approximation for "Simulated Crash"
        // E = 0.99 / (1 - r) ... standard formula
        cp = Math.max(1.00, (0.96 / (1 - r))); 
    }
    // Cap strictly for sim safety
    if (cp > 50) cp = 50; 

    setCrashPoint(cp);
    setGameState('RUNNING');
    setMultiplier(1.00);
    setCashedAt(null);
    startTimeRef.current = Date.now();
    
    requestRef.current = requestAnimationFrame(tick);
  };

  const tick = () => {
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    // Growth function: e^(0.15 * t) - roughly standard crash curve speed
    const currentMult = Math.floor((Math.exp(0.15 * elapsed)) * 100) / 100;

    if (currentMult >= crashPoint) {
        setMultiplier(crashPoint);
        setGameState('CRASHED');
        cancelAnimationFrame(requestRef.current!);
    } else {
        setMultiplier(currentMult);
        requestRef.current = requestAnimationFrame(tick);
    }
  };

  const cashOut = () => {
      if (gameState !== 'RUNNING') return;
      cancelAnimationFrame(requestRef.current!);
      setGameState('CASHED_OUT');
      setCashedAt(multiplier);
      const win = stake * multiplier;
      onBalanceUpdate(win);
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
                        disabled={gameState === 'CRASHED' && multiplier > 100} // slight delay prev
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