import React, { useLayoutEffect, useRef, useState } from 'react';
import { ProgressStore, useRaceProgress } from './raceProgress';

/** The horse of one lane: moved with a GPU transform (no layout per frame) and subscribed to the race store on its own. */
const HorseSprite: React.FC<{ store: ProgressStore; index: number; color: string }> = ({ store, index, color }) => {
  const p = useRaceProgress(store)[index] ?? 0;
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(300);
  useLayoutEffect(() => {
    const el = ref.current?.parentElement; if (!el) return;
    setW(el.clientWidth || 300);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 300));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="absolute left-0 top-1/2 -mt-5 text-3xl select-none leading-none" style={{ transform: `translate3d(${28 + p * 0.82 * W}px, 0, 0)`, willChange: 'transform' }}>
      <span className="inline-block" style={{ transform: 'scaleX(-1)', filter: `drop-shadow(0 3px 2px rgba(0,0,0,.5)) drop-shadow(0 0 6px ${color})` }}>🏇</span>
    </div>
  );
};
export default React.memo(HorseSprite);
