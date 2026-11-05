import React, { useEffect, useState } from 'react';

// Free stake entry for every casino game: type any amount (2 decimals) inside [min, max], or use the quick chips,
// ½ / 2× and MAX. The server validates the same range, so this is only a convenience.
interface Props {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  presets?: number[];
  disabled?: boolean;
  unit?: string;
  balance?: number;
  className?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const StakeInput: React.FC<Props> = ({ value, onChange, min, max, presets = [], disabled, unit = '', balance, className = '' }) => {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText((t) => (Number(t) === value ? t : String(value))); }, [value]);

  const cap = balance !== undefined && balance >= min ? Math.min(max, Math.floor(balance * 100) / 100) : max;
  const clamp = (n: number) => round2(Math.min(max, Math.max(min, n)));
  const commit = (raw: string) => {
    const n = Number(raw.replace(',', '.'));
    if (!Number.isFinite(n) || raw.trim() === '') { setText(String(value)); return; }
    const c = clamp(n);
    setText(String(c)); onChange(c);
  };
  const set = (n: number) => { const c = clamp(n); setText(String(c)); onChange(c); };

  const btn = 'px-2.5 py-1.5 rounded-lg text-xs font-bold border border-white/15 bg-black/40 text-gray-100 hover:bg-white/10 disabled:opacity-40 active:scale-95 transition';
  return (
    <div className={`w-full max-w-md mx-auto ${className}`}>
      <div className="flex items-stretch gap-1.5 mb-2">
        <button type="button" disabled={disabled} onClick={() => set(value / 2)} className={btn} aria-label="Halve stake">½</button>
        <div className="relative flex-1">
          <input
            type="text" inputMode="decimal" value={text} disabled={disabled} aria-label="Stake amount"
            onChange={(e) => { const v = e.target.value; if (/^\d*[.,]?\d{0,2}$/.test(v)) { setText(v); const n = Number(v.replace(',', '.')); if (Number.isFinite(n) && v !== '' && n >= min && n <= max) onChange(round2(n)); } }}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="w-full h-full rounded-lg bg-black/60 border border-yellow-500/40 focus:border-yellow-400 outline-none text-center text-lg font-extrabold text-yellow-300 tabular-nums py-1.5 pr-8 disabled:opacity-60"
          />
          {unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">{unit}</span>}
        </div>
        <button type="button" disabled={disabled} onClick={() => set(value * 2)} className={btn} aria-label="Double stake">2×</button>
        <button type="button" disabled={disabled} onClick={() => set(cap)} className={btn} aria-label="Max stake">MAX</button>
      </div>
      {presets.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {presets.map((s) => (
            <button key={s} type="button" disabled={disabled} onClick={() => set(s)} className={`px-2.5 py-1 rounded-md text-xs tabular-nums transition ${value === s ? 'bg-brand-yellow text-black font-bold' : 'bg-black/40 text-gray-200 hover:bg-black/60'}`}>{s}</button>
          ))}
        </div>
      )}
      <div className="text-[10px] text-center text-gray-500 mt-1">Min {min} · Max {max}{unit ? ` ${unit}` : ''}</div>
    </div>
  );
};
export default StakeInput;
