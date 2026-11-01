import React, { useState, useEffect, useRef } from 'react';
import { casinoCrashStart, casinoCrashStatus, casinoCrashCashout } from '../../services/api';
import CoinBurst from './CoinBurst';
import './casino.css';

// The curve the game draws: multiplier = e^(GROWTH * seconds) (the same law the climb uses).
const GROWTH = 0.15;
const VW = 600, VH = 300, PL = 34, PR = 44, PT = 24, PB = 30;
const TICKS = [1.5, 2, 3, 5, 10, 20, 50, 100, 200, 500];
const STARS = Array.from({ length: 34 }, (_, i) => ({ x: (i * 97) % VW, y: (i * 53) % (VH - 40), r: 0.6 + ((i * 7) % 5) * 0.28, dl: (i % 9) * 0.33 }));

const curveGeometry = (mult: number) => {
  const m = Math.max(1, mult);
  const tEnd = Math.log(m) / GROWTH;
  const tMax = Math.max(8, tEnd * 1.12);
  const yMax = Math.max(2, m * 1.18);
  const X = (t: number) => PL + (t / tMax) * (VW - PL - PR);
  const Y = (v: number) => VH - PB - (Math.log(Math.max(1, v)) / Math.log(yMax)) * (VH - PT - PB);
  const N = 56;
  const pts = Array.from({ length: N + 1 }, (_, i) => { const t = (tEnd * i) / N; return { x: X(t), y: Y(Math.exp(GROWTH * t)) }; });
  const a = pts[Math.max(0, pts.length - 4)], b = pts[pts.length - 1];
  const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${b.x.toFixed(1)} ${VH - PB} L${pts[0].x.toFixed(1)} ${VH - PB} Z`;
  const ticks = [1, ...TICKS.filter((v) => v < yMax)].map((v) => ({ v, y: Y(v) }));
  return { line, area, end: b, angle, ticks };
};

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
  const [roundShake, setRoundShake] = useState(0); // new key for every crash so the shake plays again

  const requestRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const roundIdRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const stopPolling = () => { if (pollRef.current != null) { window.clearInterval(pollRef.current); pollRef.current = null; } };

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
        { setRoundShake((n) => n + 1); setGameState('CRASHED'); }
        return;
      }

      setGameState('RUNNING');
      setMultiplier(1.00);
      setCashedAt(null);
      startTimeRef.current = Date.now();
      requestRef.current = requestAnimationFrame(tick);
      // The server decides when the round crashes: ask it every 250 ms and stop the climb the moment it has.
      stopPolling();
      pollRef.current = window.setInterval(async () => {
        const id = roundIdRef.current;
        if (!id) return;
        try {
          const st = await casinoCrashStatus(id);
          if (st.crashed && roundIdRef.current === id) {
            stopPolling();
            cancelAnimationFrame(requestRef.current);
            roundIdRef.current = null;
            setMultiplier(st.multiplier ?? 1.00);
            { setRoundShake((n) => n + 1); setGameState('CRASHED'); }
          }
        } catch { /* a missed poll is retried on the next tick */ }
      }, 250);
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
      stopPolling();
      const id = roundIdRef.current;
      roundIdRef.current = null;

      try {
        const { crashed, multiplier: finalMultiplier, balance } = await casinoCrashCashout(id);
        onSetBalance(balance);
        if (crashed) {
          setMultiplier(finalMultiplier);
          { setRoundShake((n) => n + 1); setGameState('CRASHED'); }
        } else {
          setMultiplier(finalMultiplier);
          setCashedAt(finalMultiplier);
          setGameState('CASHED_OUT');
        }
      } catch (err) {
        { setRoundShake((n) => n + 1); setGameState('CRASHED'); }
      }
  };

  // Cleanup on unmount
  useEffect(() => {
      return () => {
          stopPolling();
          if (requestRef.current) cancelAnimationFrame(requestRef.current);
      };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[600px] bg-[#0b0f19] rounded-xl p-6 border border-gray-800 relative shadow-2xl overflow-hidden font-mono">
       <button onClick={onClose} className="absolute top-4 left-4 text-gray-500 hover:text-white font-bold z-20">‹ Exit</button>
       
       {/* Game Canvas Area: the curve climbs, the rocket rides its end, and it explodes on the crash */}
       {(() => {
           const geo = curveGeometry(multiplier);
           const crashed = gameState === 'CRASHED';
           const cashed = gameState === 'CASHED_OUT';
           const running = gameState === 'RUNNING';
           const stroke = crashed ? '#ef4444' : cashed ? '#4ade80' : '#38bdf8';
           return (
       <div key={crashed ? `c-${roundShake}` : 'ok'} className={`relative w-full max-w-2xl h-96 rounded-xl mb-6 overflow-hidden border border-gray-700 ${crashed ? 'crash-shake' : ''}`}
            style={{ background: 'radial-gradient(ellipse at 50% 120%, #1d2a55, #0b1022 70%)' }}>
           {cashed && <CoinBurst />}
           <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
               <defs>
                   <linearGradient id="crash-fill" x1="0" y1="0" x2="0" y2="1">
                       <stop offset="0" stopColor={stroke} stopOpacity="0.38" /><stop offset="1" stopColor={stroke} stopOpacity="0" />
                   </linearGradient>
                   <filter id="crash-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
               </defs>
               {STARS.map((st, i) => <circle key={i} className="crash-star" cx={st.x} cy={st.y} r={st.r} fill="#fff" style={{ ['--dl' as any]: `${st.dl}s` }} />)}
               {geo.ticks.map((tk) => (
                   <g key={tk.v}>
                       <line x1={PL} x2={VW - PR + 10} y1={tk.y} y2={tk.y} stroke="#475569" strokeOpacity="0.35" strokeDasharray="3 5" />
                       <text x={PL - 6} y={tk.y + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{tk.v}x</text>
                   </g>
               ))}
               {(running || crashed || cashed) && multiplier > 1 && (
                   <>
                       <path d={geo.area} fill="url(#crash-fill)" />
                       <path d={geo.line} fill="none" stroke={stroke} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" filter="url(#crash-glow)" />
                   </>
               )}
               {/* rocket (original drawing) riding the end of the curve */}
               {(running || cashed) && multiplier > 1 && (
                   <g transform={`translate(${geo.end.x} ${geo.end.y}) rotate(${geo.angle})`} filter="url(#crash-glow)">
                       {running && <path className="crash-flame" d="M-4 0 L-26 -5 L-34 0 L-26 5 Z" fill="#fbbf24" />}
                       {running && <path className="crash-flame" d="M-4 0 L-17 -3 L-22 0 L-17 3 Z" fill="#fff7c2" />}
                       <path d="M-6 -6 L-14 -12 L-14 -3 Z M-6 6 L-14 12 L-14 3 Z" fill="#e11d48" />
                       <path d="M-8 -6 Q8 -8 18 0 Q8 8 -8 6 Z" fill="#f1f5f9" stroke="#94a3b8" strokeWidth="0.8" />
                       <path d="M10 -5 Q16 -3 18 0 Q16 3 10 5 Q13 0 10 -5 Z" fill="#e11d48" />
                       <circle cx="3" cy="0" r="3.4" fill="#38bdf8" stroke="#0f172a" strokeWidth="1" />
                   </g>
               )}
               {/* explosion */}
               {crashed && multiplier >= 1 && (
                   <g transform={`translate(${geo.end.x} ${geo.end.y})`}>
                       <circle className="crash-ring" r="14" fill="none" stroke="#fb923c" strokeWidth="4" />
                       <circle className="crash-ring" r="9" fill="#fde68a" style={{ animationDelay: '0.08s' }} />
                       {Array.from({ length: 12 }, (_, i) => {
                           const a = (i / 12) * Math.PI * 2;
                           const d = 38 + (i % 3) * 16;
                           return <circle key={i} className="crash-spark" r={2.6 + (i % 2)} fill={i % 2 ? '#f97316' : '#fde047'}
                               style={{ ['--x' as any]: `${Math.cos(a) * d}px`, ['--y' as any]: `${Math.sin(a) * d}px` }} />;
                       })}
                   </g>
               )}
           </svg>

           {/* the multiplier */}
           <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
               <div className="text-center">
                   <div className={`text-7xl font-bold tabular-nums drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)] ${
                       crashed ? 'text-red-500' : cashed ? 'text-green-400' : 'text-white'
                   }`}>
                       {multiplier.toFixed(2)}x
                   </div>
                   {crashed && <div className="text-red-500 font-bold mt-2 text-xl win-pop">CRASHED</div>}
                   {cashed && <div className="text-green-400 font-bold mt-2 text-xl win-pop">WON {(stake * cashedAt!).toFixed(2)}</div>}
                   {gameState === 'IDLE' && <div className="text-gray-400 mt-2">Ready to fly?</div>}
               </div>
           </div>
       </div>
           );
       })()}

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
