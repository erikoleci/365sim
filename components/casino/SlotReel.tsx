import React, { useMemo } from 'react';
import './casino.css';

// One slot reel: three visible rows. While `spinning` a long strip of random symbols scrolls past,
// blurred, in a loop (pure CSS, no per-frame React work); when it stops the final symbols drop into place
// with a small bounce, like a mechanical reel. Winning rows glow.
interface Props {
  symbols: string[];            // the 3 visible symbols, top to bottom
  spinning: boolean;
  pool: string[];               // symbols used for the blur strip
  litRows?: number[];           // rows that are part of a win
  rowCount?: number;
  className?: string;
}

const STRIP = 12;

const SlotReel: React.FC<Props> = ({ symbols, spinning, pool, litRows = [], rowCount = 3, className = '' }) => {
  const strip = useMemo(
    () => (spinning ? Array.from({ length: STRIP }, () => pool[Math.floor(Math.random() * pool.length)]) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spinning],
  );
  const cell = (sym: string, key: React.Key, extra = '', style: React.CSSProperties = {}) => (
    <div key={key} className={`flex items-center justify-center ${extra}`} style={{ fontSize: '52cqw', lineHeight: 1, ...style }}>{sym}</div>
  );
  return (
    <div className={`reel-window rounded-lg bg-white/10 ${className}`} style={{ aspectRatio: `1 / ${rowCount}`, containerType: 'inline-size' }}>
      {spinning ? (
        <div className="reel-run" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: `${STRIP * 2 * 100 / rowCount}%` }}>
          {[...strip, ...strip].map((sym, i) => cell(sym, i, '', { height: `${100 / (STRIP * 2)}%` }))}
        </div>
      ) : (
        <div key={symbols.join('|')} className="reel-stop" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
          {symbols.map((sym, row) => cell(sym, row, litRows.includes(row) ? 'cell-win rounded-lg' : '', { height: `${100 / rowCount}%` }))}
        </div>
      )}
    </div>
  );
};

export default React.memo(SlotReel);
