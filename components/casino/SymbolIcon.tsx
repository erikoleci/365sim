import React from 'react';
import symbolMap from '../../utils/symbolMap.json';

// A slot symbol as a crisp vector picture (public/symbols, Twemoji by Twitter / jdecked, CC-BY 4.0) so every phone shows
// the same art. A symbol without a picture (e.g. the rune letter) falls back to the plain character.
const MAP = { ...(symbolMap as Record<string, string>), '7️⃣': 'seven' } as Record<string, string>; // the lucky seven is drawn red and gold, not a blue keycap
const SymbolIcon: React.FC<{ symbol: string; className?: string }> = ({ symbol, className = '' }) => {
  const file = MAP[symbol];
  if (!file) return <span className={className} style={{ lineHeight: 1 }}>{symbol}</span>;
  return <img src={`/symbols/${file}.svg`} alt="" draggable={false} className={`slot-sym ${className}`} />;
};
export default React.memo(SymbolIcon);
