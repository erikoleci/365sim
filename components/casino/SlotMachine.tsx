import React, { useState, useEffect } from 'react';

interface SlotMachineProps {
  onBalanceUpdate: (amount: number) => void;
  userBalance: number;
  onClose: () => void;
}

const SYMBOLS = ['🍒', '🍋', '🍇', '💎', '🔔', '7️⃣'];
const PAYOUTS: Record<string, number> = {
  '🍒': 3,
  '🍋': 5,
  '🍇': 10,
  '🔔': 20,
  '💎': 50,
  '7️⃣': 100
};

const SlotMachine: React.FC<SlotMachineProps> = ({ onBalanceUpdate, userBalance, onClose }) => {
  const [reels, setReels] = useState<string[]>(['7️⃣', '7️⃣', '7️⃣']);
  const [isSpinning, setIsSpinning] = useState(false);
  const [stake, setStake] = useState(10);
  const [message, setMessage] = useState('GOOD LUCK!');
  const [winAmount, setWinAmount] = useState(0);

  const spin = () => {
    if (userBalance < stake) {
      setMessage('INSUFFICIENT FUNDS');
      return;
    }
    if (isSpinning) return;

    setIsSpinning(true);
    setWinAmount(0);
    setMessage('SPINNING...');
    onBalanceUpdate(-stake);

    // Animation simulation
    let intervalCount = 0;
    const interval = setInterval(() => {
      setReels([
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]
      ]);
      intervalCount++;
      if (intervalCount > 10) {
        clearInterval(interval);
        finalizeSpin();
      }
    }, 100);
  };

  const finalizeSpin = () => {
    // House-controlled outcome: ~1% of spins are allowed to land a winning
    // triple, the other ~99% are forced to a guaranteed non-match. Even the
    // ~1% that win only pay out a small profit, not the full paytable.
    const WIN_CHANCE = 0.01;
    let r1: string, r2: string, r3: string;
    let forcedWin = false;

    if (Math.random() < WIN_CHANCE) {
      forcedWin = true;
      const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
      r1 = r2 = r3 = symbol;
    } else {
      r1 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
      r2 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
      r3 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
      if (r1 === r2 && r2 === r3) {
        // Extremely rare accidental triple from independent draws — bump one
        // reel to the next symbol so it never pays out.
        r3 = SYMBOLS[(SYMBOLS.indexOf(r3) + 1) % SYMBOLS.length];
      }
    }

    setReels([r1, r2, r3]);
    setIsSpinning(false);

    if (r1 === r2 && r2 === r3) {
      // Small capped profit (5%-50% of stake) instead of the paytable multiplier.
      const smallMultiplier = forcedWin ? 1.05 + Math.random() * 0.45 : PAYOUTS[r1];
      const win = Number((stake * smallMultiplier).toFixed(2));
      setWinAmount(win);
      onBalanceUpdate(win);
      setMessage(`WIN! ${win} L`);
    } else if (r1 === r2 || r2 === r3 || r1 === r3) {
      // Small win for 2 matches? Optional. Let's stick to 3 for simplicity or maybe refund
      setMessage('NO WIN');
    } else {
      setMessage('TRY AGAIN');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[500px] bg-gradient-to-b from-purple-900 to-black rounded-lg p-8 border-4 border-yellow-600 shadow-2xl relative">
      <button onClick={onClose} className="absolute top-4 left-4 text-white hover:text-yellow-400 font-bold">‹ Back to Lobby</button>
      
      <h2 className="text-4xl font-bold text-yellow-400 mb-8 tracking-widest drop-shadow-md">SUPER SLOTS</h2>

      <div className="flex gap-4 mb-8 bg-black p-4 rounded-xl border-2 border-yellow-600 shadow-inner">
        {reels.map((symbol, idx) => (
          <div key={idx} className="w-24 h-32 bg-white rounded-lg flex items-center justify-center text-6xl shadow-inner border border-gray-300">
            {symbol}
          </div>
        ))}
      </div>

      <div className="text-2xl font-bold text-white mb-6 h-8 text-center animate-pulse">{message}</div>

      <div className="bg-gray-800 p-6 rounded-xl w-full max-w-md border border-gray-600">
        <div className="flex justify-between items-center mb-4 text-white">
            <div>
                <span className="text-xs text-gray-400 uppercase block">Balance</span>
                <span className="font-bold text-yellow-400">{userBalance.toFixed(2)} L</span>
            </div>
            <div>
                <span className="text-xs text-gray-400 uppercase block text-right">Win</span>
                <span className="font-bold text-green-400 text-xl">{winAmount > 0 ? `+${winAmount}` : '0'}</span>
            </div>
        </div>

        <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col">
                <label className="text-xs text-gray-400 mb-1">STAKE</label>
                <div className="flex items-center gap-2">
                    <button onClick={() => setStake(Math.max(1, stake - 5))} className="bg-gray-700 w-8 h-8 rounded text-white">-</button>
                    <input type="number" readOnly value={stake} className="w-16 bg-black text-white text-center rounded border border-gray-600 py-1" />
                    <button onClick={() => setStake(stake + 5)} className="bg-gray-700 w-8 h-8 rounded text-white">+</button>
                </div>
            </div>
            <button 
                onClick={spin} 
                disabled={isSpinning}
                className={`flex-1 py-4 rounded-lg font-bold text-xl shadow-lg transform transition-transform active:scale-95 ${isSpinning ? 'bg-gray-600 cursor-not-allowed' : 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-black hover:from-yellow-400 hover:to-yellow-500'}`}
            >
                {isSpinning ? '...' : 'SPIN'}
            </button>
        </div>
      </div>
      
      <div className="mt-8 grid grid-cols-3 gap-4 text-xs text-gray-400">
         {Object.entries(PAYOUTS).map(([sym, mul]) => (
             <div key={sym} className="flex gap-2 justify-center">
                 <span>{sym}{sym}{sym}</span>
                 <span className="text-yellow-500">x{mul}</span>
             </div>
         ))}
      </div>
    </div>
  );
};

export default SlotMachine;