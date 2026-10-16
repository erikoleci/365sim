import React from 'react';
import { DateOption } from '../../utils/dateLabels';

interface Props {
  options: DateOption[];
  selected: string;
  onSelect: (value: string) => void;
}

/** "All / Today / Tomorrow / next days" filter, always in Albania's calendar. */
const DateStrip: React.FC<Props> = ({ options, selected, onSelect }) => (
  <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
    {options.map((opt) => (
      <button
        key={opt.value}
        onClick={() => onSelect(opt.value)}
        className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
          selected === opt.value
            ? 'bg-brand-yellow text-black border-brand-yellow'
            : 'bg-brand-panel text-white border-brand-divider hover:border-brand-yellow/50'
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

export default DateStrip;
