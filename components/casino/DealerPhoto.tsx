import React, { useState } from 'react';
import Croupier, { CroupierMood } from './Croupier';

// The dealer of a table: a photo from /dealers/dealerN.jpg in a tilted gold frame (reacts to the result),
// or the illustrated croupier when that photo has not been added.
const DealerPhoto: React.FC<{ dealer?: 1 | 2 | 3 | 4; mood?: CroupierMood; size?: number }> = ({ dealer = 1, mood = 'idle', size = 120 }) => {
  const [missing, setMissing] = useState(false);
  if (missing) return <Croupier mood={mood} size={size} />;
  const glow = mood === 'win' ? '0 0 28px 6px rgba(250,204,21,.65)' : mood === 'lose' ? '0 0 18px 2px rgba(239,68,68,.45)' : '0 8px 22px rgba(0,0,0,.55)';
  return (
    <div style={{ perspective: 600 }}>
      <img
        src={`/dealers/dealer${dealer}.jpg`}
        alt="Dealer"
        onError={() => setMissing(true)}
        style={{
          width: size, height: size * 1.25, objectFit: 'cover', objectPosition: 'center top', borderRadius: 14,
          border: '3px solid #d4af37', boxShadow: glow, transform: `rotateY(${mood === 'spinning' ? -10 : -6}deg) rotateX(2deg) ${mood === 'win' ? 'translateY(-4px)' : ''}`,
          transition: 'transform .4s ease, box-shadow .4s ease',
        }}
      />
    </div>
  );
};

export default DealerPhoto;
