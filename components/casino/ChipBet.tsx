import React from 'react';
import Chip from './Chip';

// Click a chip to add it to the stake right away; Clear resets it.
const ChipBet: React.FC<{ stake: number; onChange: (n: number) => void; disabled?: boolean }> = ({ stake, onChange, disabled }) => (
  <div className="flex flex-col items-center gap-2">
    <div className="flex items-center gap-2">
      {[5, 25, 100, 500].map((v) => (
        <button key={v} disabled={disabled} onClick={() => onChange(Math.min(5000, stake + v))} className="transition-transform hover:-translate-y-1 active:scale-95 disabled:opacity-40" aria-label={`Add ${v}`}>
          <Chip value={v} size={38} />
        </button>
      ))}
    </div>
    <div className="flex items-center gap-2 text-xs text-white">
      <span>Stake</span><span className="font-bold text-yellow-400">{stake}</span>
      <button disabled={disabled} onClick={() => onChange(0)} className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 disabled:opacity-40">Clear</button>
    </div>
  </div>
);
export default ChipBet;
