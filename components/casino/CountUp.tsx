import React, { useEffect, useRef, useState } from 'react';

// A number that counts up to its value (a win being "paid out"), eased, over `ms`.
const CountUp: React.FC<{ value: number; format: (n: number) => string; ms?: number }> = ({ value, format, ms = 900 }) => {
  const [shown, setShown] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || value <= 0) { setShown(value); return; }
    const t0 = performance.now();
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / ms);
      setShown(value * (1 - Math.pow(1 - u, 3)));
      if (u < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, ms]);
  return <>{format(shown)}</>;
};

export default CountUp;
