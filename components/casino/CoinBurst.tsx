import React, { useMemo } from 'react';
import './casino.css';

// A shower of gold coins from the middle of the screen: shown for a win. Pure CSS (the coins are
// spans with their own random direction), so it costs nothing while it plays and nothing after.
const CoinBurst: React.FC<{ count?: number }> = ({ count = 22 }) => {
  const coins = useMemo(() => Array.from({ length: count }, () => ({
    x: Math.round((Math.random() - 0.5) * 360),
    y: -Math.round(60 + Math.random() * 170),
    dl: Math.random() * 0.25,
    t: 1 + Math.random() * 0.6,
  })), [count]);
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 40 }}>
      {coins.map((c, i) => (
        <span key={i} className="coin" style={{ ['--x' as any]: `${c.x}px`, ['--y' as any]: `${c.y}px`, ['--dl' as any]: `${c.dl}s`, ['--t' as any]: `${c.t}s` }} />
      ))}
    </div>
  );
};

export default React.memo(CoinBurst);
