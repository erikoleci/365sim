import React, { useEffect, useState } from 'react';
import './casino.css';

// One playing card: a printed face (corner indices, big centre suit, court cards framed in gold) and a
// patterned back. It flies in from the shoe when it appears, and TURNS OVER (3D flip) when `hidden`
// goes from true to false -- so a dealer's hole card is really revealed, not swapped.
export interface CardFace { suit: string; value: string }

const isRed = (suit: string) => suit === '♥' || suit === '♦';
const COURT = new Set(['J', 'Q', 'K']);

const SIZES = {
  md: { w: 64, h: 92, corner: 15, pip: 30, court: 26 },
  lg: { w: 80, h: 114, corner: 18, pip: 38, court: 32 },
} as const;

interface Props {
  card?: CardFace | null;
  hidden?: boolean;
  size?: keyof typeof SIZES;
  /** Delay before this card flies in (ms): used to deal the first cards one after the other. */
  delay?: number;
  held?: boolean;
  /** Deal the card face down, then turn it over this many ms after it has landed (like a dealer revealing it). */
  flipIn?: number;
  onClick?: () => void;
}

const PlayingCard: React.FC<Props> = ({ card, hidden, size = 'md', delay = 0, held, flipIn, onClick }) => {
  const sz = SIZES[size];
  const [turned, setTurned] = useState(flipIn == null);
  useEffect(() => {
    if (flipIn == null) return;
    const t = setTimeout(() => setTurned(true), delay + 420 + flipIn);
    return () => clearTimeout(t);
  }, [flipIn, delay]);
  const down = hidden || !card || !turned;
  const color = card && isRed(card.suit) ? '#c8102e' : '#16161a';
  return (
    <div
      className={`pc ${held ? 'pc-held' : ''}`}
      style={{ width: sz.w, height: sz.h, ['--d' as any]: `${delay}ms`, cursor: onClick ? 'pointer' : undefined }}
      onClick={onClick}
    >
      <div className={`pc-inner ${down ? 'pc-down' : ''}`}>
        <div className="pc-face" style={{ color }}>
          {card && (
            <>
              <div style={{ position: 'absolute', top: 4, left: 6, lineHeight: 1, textAlign: 'center', fontWeight: 800, fontSize: sz.corner, fontFamily: 'Georgia, serif' }}>
                <div>{card.value}</div>
                <div style={{ fontSize: sz.corner - 2 }}>{card.suit}</div>
              </div>
              <div style={{ position: 'absolute', bottom: 4, right: 6, lineHeight: 1, textAlign: 'center', fontWeight: 800, fontSize: sz.corner, fontFamily: 'Georgia, serif', transform: 'rotate(180deg)' }}>
                <div>{card.value}</div>
                <div style={{ fontSize: sz.corner - 2 }}>{card.suit}</div>
              </div>
              {COURT.has(card.value) ? (
                <div style={{ position: 'absolute', inset: '16% 20%', border: '1.5px solid #d4af37', borderRadius: 5, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  background: 'linear-gradient(160deg, rgba(212,175,55,0.14), rgba(212,175,55,0.04))' }}>
                  <div style={{ fontSize: sz.court, fontWeight: 800, lineHeight: 1, fontFamily: 'Georgia, serif' }}>{card.value}</div>
                  <div style={{ fontSize: sz.court * 0.8, lineHeight: 1 }}>{card.suit}</div>
                </div>
              ) : (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: sz.pip, lineHeight: 1 }}>{card.suit}</div>
              )}
            </>
          )}
        </div>
        <div className="pc-back" />
      </div>
    </div>
  );
};

export default React.memo(PlayingCard);
