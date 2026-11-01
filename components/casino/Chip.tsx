import React from 'react';
import './casino.css';

// A casino chip, coloured by value like on a real table, and a small stack of them for a stake.
const COLORS: Array<[number, string]> = [
  [1000, '#c9a227'], [500, '#6a2c91'], [100, '#1b1b1f'], [50, '#d97706'], [25, '#168a46'], [10, '#1d4ed8'], [5, '#c81e3a'], [0, '#6b7280'],
];
export const chipColor = (value: number): string => (COLORS.find(([v]) => value >= v) ?? COLORS[COLORS.length - 1])[1];

export const Chip: React.FC<{ value: number; size?: number; pop?: boolean }> = ({ value, size = 44, pop }) => (
  <div className={`chip ${pop ? 'chip-pop' : ''}`} style={{ width: size, height: size, background: chipColor(value), fontSize: size * (String(value).length > 3 ? 0.26 : 0.32) }}>
    {value}
  </div>
);

export const ChipStack: React.FC<{ value: number; count?: number; size?: number }> = ({ value, count = 4, size = 40 }) => (
  <div style={{ position: 'relative', width: size, height: size + (count - 1) * 5 }}>
    {Array.from({ length: count }, (_, i) => (
      <div key={i} style={{ position: 'absolute', left: 0, bottom: i * 5 }}>
        <Chip value={value} size={size} pop={i === count - 1} />
      </div>
    ))}
  </div>
);

export default Chip;
