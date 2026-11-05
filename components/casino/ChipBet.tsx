import React from 'react';
import Chip from './Chip';
import StakeInput from './StakeInput';

// Click a chip to add it to the stake, or type any amount.
const ChipBet: React.FC<{ stake: number; onChange: (n: number) => void; disabled?: boolean }> = ({ stake, onChange, disabled }) => (
  <div className="flex flex-col items-center gap-2">
    <div className="flex items-center gap-2">
      {[5, 25, 100, 500].map((v) => (
        <button key={v} disabled={disabled} onClick={() => onChange(Math.min(5000, stake + v))} className="transition-transform hover:-translate-y-1 active:scale-95 disabled:opacity-40" aria-label={`Add ${v}`}>
          <Chip value={v} size={38} />
        </button>
      ))}
    </div>
    <StakeInput value={stake || 1} onChange={onChange} min={1} max={5000} disabled={disabled} unit="L" />
  </div>
);
export default ChipBet;
