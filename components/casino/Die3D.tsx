import React from 'react';
import './casino.css';

// A real 3D die (CSS cube). `value` is the face that ends up toward the player; every change of `rollKey`
// tumbles the cube through extra turns and a bouncing hop before it settles on that face.
const ORIENT: Record<number, [number, number]> = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 2: [-90, 0], 5: [90, 0] };
const PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};
const FACE_TF: Record<number, string> = {
  1: 'translateZ(var(--h))', 6: 'rotateY(180deg) translateZ(var(--h))', 3: 'rotateY(90deg) translateZ(var(--h))',
  4: 'rotateY(-90deg) translateZ(var(--h))', 2: 'rotateX(90deg) translateZ(var(--h))', 5: 'rotateX(-90deg) translateZ(var(--h))',
};

interface Props { value: number; rollKey: number; size?: number; delay?: number }

// Every roll adds whole turns, so the cube always tumbles forward and lands exactly on `value`.
const Die3D: React.FC<Props> = ({ value, rollKey, size = 88, delay = 0 }) => {
  const [ex, ey] = ORIENT[value] ?? [0, 0];
  const spin = `rotateX(${ex + 360 * 2 * rollKey}deg) rotateY(${ey + 360 * 3 * rollKey}deg)`;
  return (
    <div className={`die-wrap ${rollKey > 0 ? (rollKey % 2 ? 'die-hop-a' : 'die-hop-b') : ''}`} style={{ width: size, height: size, ['--h' as any]: `${size / 2}px`, animationDelay: `${delay}ms` }}>
      <div className="die-shadow" />
      <div className="die-cube" style={{ transform: spin, transitionDelay: `${delay}ms` }}>
        {[1, 2, 3, 4, 5, 6].map((f) => (
          <div key={f} className="die-face" style={{ transform: FACE_TF[f] }}>
            {Array.from({ length: 9 }, (_, i) => <span key={i} className={PIPS[f].includes(i) ? 'die-pip' : ''} />)}
          </div>
        ))}
      </div>
    </div>
  );
};

export default React.memo(Die3D);
