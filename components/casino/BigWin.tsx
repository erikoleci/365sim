import React, { useEffect } from 'react';
import CoinBurst from './CoinBurst';
import CountUp from './CountUp';
import './casino.css';

// Full-screen celebration for big hits: rotating light rays, tiered banner, counting prize and a coin storm.
export const winTier = (payout: number, stake: number): 0 | 1 | 2 | 3 => {
  if (stake <= 0) return 0;
  const x = payout / stake;
  return x >= 50 ? 3 : x >= 25 ? 2 : x >= 10 ? 1 : 0;
};
const TITLES = ['', 'BIG WIN', 'MEGA WIN', 'EPIC WIN'];
const COLORS = ['', 'from-yellow-200 via-amber-400 to-orange-600', 'from-fuchsia-200 via-pink-400 to-purple-600', 'from-cyan-100 via-sky-400 to-indigo-600'];

const BigWin: React.FC<{ tier: 1 | 2 | 3; amount: number; format: (v: number) => string; onDone: () => void }> = ({ tier, amount, format, onDone }) => {
  useEffect(() => { const t = window.setTimeout(onDone, 3600); return () => window.clearTimeout(t); }, [onDone]);
  return (
    <div className="bigwin-root" onClick={onDone} role="dialog" aria-label={TITLES[tier]}>
      <div className="bigwin-rays" />
      <CoinBurst count={tier === 3 ? 60 : tier === 2 ? 44 : 30} />
      <div className="bigwin-card">
        <div className={`bigwin-title bg-gradient-to-b ${COLORS[tier]}`}>{TITLES[tier]}</div>
        <div className="bigwin-amount"><CountUp value={amount} format={format} /></div>
        <div className="text-[10px] text-white/60 mt-3">tap to continue</div>
      </div>
    </div>
  );
};
export default BigWin;
