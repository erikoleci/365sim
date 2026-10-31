import React from 'react';

// The croupier: an original illustrated character (no photo, no real person), in a black waistcoat
// with a gold trim, standing behind the wheel. She smiles, blinks, sways a little, throws the ball
// when the wheel starts and reacts to the result.
export type CroupierMood = 'idle' | 'spinning' | 'win' | 'lose';

const CSS = `
@keyframes cr-sway { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-2px) } }
@keyframes cr-blink { 0%,92%,100% { transform: scaleY(0) } 95%,97% { transform: scaleY(1) } }
@keyframes cr-throw { 0% { transform: rotate(0deg) } 25% { transform: rotate(-38deg) } 55% { transform: rotate(14deg) } 100% { transform: rotate(0deg) } }
@keyframes cr-cheer { 0%,100% { transform: rotate(0deg) } 50% { transform: rotate(-22deg) } }
.cr-body { animation: cr-sway 3.6s ease-in-out infinite; transform-origin: 80px 150px; }
.cr-lid { transform-origin: center; transform-box: fill-box; animation: cr-blink 5s linear infinite; }
.cr-arm { transform-origin: 124px 150px; }
.cr-arm.spinning { animation: cr-throw 1.1s ease-in-out 1; }
.cr-arm.win { animation: cr-cheer 0.7s ease-in-out 3; }
@media (prefers-reduced-motion: reduce) { .cr-body, .cr-lid, .cr-arm { animation: none !important; } }
`;

const Croupier: React.FC<{ mood?: CroupierMood; size?: number }> = ({ mood = 'idle', size = 150 }) => {
  const happy = mood === 'win';
  const sad = mood === 'lose';
  return (
    <svg viewBox="0 0 160 200" width={size} height={(size * 200) / 160} role="img" aria-label="Croupier" style={{ maxWidth: '100%', height: 'auto' }}>
      <style>{CSS}</style>
      <defs>
        <linearGradient id="cr-jacket" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#26262b" /><stop offset="1" stopColor="#0e0e10" /></linearGradient>
        <linearGradient id="cr-hair" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3b2216" /><stop offset="1" stopColor="#1d100a" /></linearGradient>
      </defs>
      <g className="cr-body">
        {/* hair behind the head: the bun and the back */}
        <circle cx="80" cy="44" r="15" fill="url(#cr-hair)" />
        <path d="M52 84 C48 50 66 36 80 36 C94 36 112 50 108 84 L108 100 C100 96 60 96 52 100 Z" fill="url(#cr-hair)" />
        {/* body: waistcoat, blouse, bow tie */}
        <path d="M14 200 C14 152 42 130 80 130 C118 130 146 152 146 200 Z" fill="url(#cr-jacket)" />
        <path d="M60 131 L80 176 L100 131 Z" fill="#f6f1e6" />
        <path d="M60 131 L80 176 M100 131 L80 176" stroke="#d4af37" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <circle cx="80" cy="160" r="2.2" fill="#d4af37" /><circle cx="80" cy="172" r="2.2" fill="#d4af37" />
        <path d="M80 140 L66 133 L66 147 Z M80 140 L94 133 L94 147 Z" fill="#8f1d2c" /><circle cx="80" cy="140" r="3" fill="#a82438" />
        {/* neck and head */}
        <path d="M71 106 L71 132 Q80 140 89 132 L89 106 Z" fill="#efc7a3" />
        <ellipse cx="80" cy="86" rx="24" ry="28" fill="#f4cfae" />
        {/* fringe */}
        <path d="M55 84 C52 56 68 44 82 44 C98 44 108 58 105 84 C99 70 92 64 80 66 C68 66 60 72 55 84 Z" fill="url(#cr-hair)" />
        {/* earrings */}
        <circle cx="56" cy="98" r="2.6" fill="#d4af37" /><circle cx="104" cy="98" r="2.6" fill="#d4af37" />
        {/* eyes with a blinking lid */}
        <ellipse cx="70" cy="90" rx="3.2" ry={happy ? 2 : 3.6} fill="#2a1810" />
        <ellipse cx="90" cy="90" rx="3.2" ry={happy ? 2 : 3.6} fill="#2a1810" />
        <rect className="cr-lid" x="65" y="85" width="10" height="9" fill="#f4cfae" />
        <rect className="cr-lid" x="85" y="85" width="10" height="9" fill="#f4cfae" />
        <path d="M64 82 Q70 78 76 82 M84 82 Q90 78 96 82" stroke="#2a1810" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <circle cx="62" cy="100" r="4.2" fill="#e88c8c" opacity="0.35" /><circle cx="98" cy="100" r="4.2" fill="#e88c8c" opacity="0.35" />
        {/* mouth: a calm smile, a big one on a win, a small sympathetic one on a loss */}
        {happy ? <path d="M70 100 Q80 114 90 100 Z" fill="#b3303d" /> :
          sad ? <path d="M73 106 Q80 102 87 106" stroke="#b3303d" strokeWidth="2" fill="none" strokeLinecap="round" /> :
            <path d="M72 102 Q80 108 88 102" stroke="#b3303d" strokeWidth="2.2" fill="none" strokeLinecap="round" />}
        {/* the arm that throws the ball (and cheers on a win) */}
        <g className={`cr-arm ${mood === 'spinning' ? 'spinning' : mood === 'win' ? 'win' : ''}`}>
          <path d="M124 150 Q134 170 120 184" stroke="#18181b" strokeWidth="15" fill="none" strokeLinecap="round" />
          <circle cx="120" cy="186" r="7" fill="#f4cfae" />
          {mood === 'spinning' && <circle cx="120" cy="180" r="3.4" fill="#f2f2f2" />}
        </g>
      </g>
    </svg>
  );
};

export default React.memo(Croupier);
