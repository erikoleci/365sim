import React, { useMemo } from 'react';
import './casino.css';

// One slot reel drawn as a real 3D drum: ten faces around a horizontal axis, seen in perspective. While
// `spinning` the drum turns (blurred) in a loop; when it stops it decelerates onto the final symbols,
// overshoots a little and settles, like a mechanical reel. Pure CSS transforms (GPU), no per-frame React work.
interface Props {
  symbols: string[];            // the 3 visible symbols, top to bottom
  spinning: boolean;
  pool: string[];               // symbols used on the faces that are not the result
  litRows?: number[];           // rows that are part of a win
  rowCount?: number;
  className?: string;
}

const FACES = 10;
const STEP = 360 / FACES;

const SlotReel: React.FC<Props> = ({ symbols, spinning, pool, litRows = [], rowCount = 3, className = '' }) => {
  // The faces that are not on the pay window carry random symbols; fixed for a spin so the drum looks solid.
  const filler = useMemo(
    () => Array.from({ length: FACES }, () => pool[Math.floor(Math.random() * pool.length)]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spinning, symbols.join('|')],
  );
  // face 0 faces the player (middle row), face 1 sits above it, the last face below it
  const faceSymbol = (i: number) => {
    if (i === 0) return symbols[1] ?? filler[0];
    if (i === 1) return symbols[0] ?? filler[1];
    if (i === FACES - 1) return symbols[2] ?? filler[i];
    return filler[i];
  };
  const faceRow = (i: number) => (i === 0 ? 1 : i === 1 ? 0 : i === FACES - 1 ? 2 : -1);
  return (
    <div className={`reel-window reel-3d rounded-lg ${className}`} style={{ aspectRatio: `1 / ${rowCount}`, containerType: 'inline-size' }}>
      <div
        key={spinning ? 'spin' : symbols.join('|')}
        className={spinning ? 'reel-drum reel-drum-spin' : 'reel-drum reel-drum-land'}
      >
        {Array.from({ length: FACES }, (_, i) => {
          const row = faceRow(i);
          const lit = !spinning && row >= 0 && litRows.includes(row);
          return (
            <div key={i} className={`reel-face ${lit ? 'cell-win' : ''}`} style={{ transform: `rotateX(${i * STEP}deg) translateZ(var(--reel-r))` }}>
              <span style={{ fontSize: '52cqw', lineHeight: 1 }}>{faceSymbol(i)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default React.memo(SlotReel);
