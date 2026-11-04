import React, { useId } from 'react';

// Small inline-SVG icons for the live pitch (no external image files).

export const BallIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => {
  const id = useId().replace(/:/g, '');
  const patch = '#1b1d22';
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <radialGradient id={`bl-${id}`} cx="36%" cy="30%" r="78%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#eceff3" />
          <stop offset="1" stopColor="#aab1bb" />
        </radialGradient>
        <clipPath id={`bc-${id}`}><circle cx="12" cy="12" r="11" /></clipPath>
      </defs>
      <circle cx="12" cy="12" r="11" fill={`url(#bl-${id})`} />
      <g clipPath={`url(#bc-${id})`} fill={patch}>
        <polygon points="12,7.4 15.6,10 14.2,14.2 9.8,14.2 8.4,10" />
        <polygon points="12,-0.6 15,1.6 12,4.2 9,1.6" />
        <polygon points="25,8 25.6,13.4 21.6,14.4 19.4,10.6 21.4,7.2" />
        <polygon points="-1,8 -1.6,13.4 2.4,14.4 4.6,10.6 2.6,7.2" />
        <polygon points="6.4,25 9.4,20.6 14.6,20.6 17.6,25" />
      </g>
      <g stroke="#3a3f48" strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0.85">
        <path d="M12 7.4V4.2M15.6 10l3.8-2.4M14.2 14.2l2.6 3.8M9.8 14.2l-2.6 3.8M8.4 10 4.6 7.6" />
      </g>
      <circle cx="12" cy="12" r="10.6" fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="0.9" />
      <ellipse cx="8.6" cy="6.6" rx="3.4" ry="2" fill="rgba(255,255,255,0.55)" transform="rotate(-30 8.6 6.6)" />
    </svg>
  );
};

// Corner flag on its pole.
export const CornerFlagIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-7' }) => (
  <svg viewBox="0 0 20 28" className={className} aria-hidden="true">
    <line x1="4" y1="2" x2="4" y2="27" stroke="#f5f5f5" strokeWidth="2" strokeLinecap="round" />
    <polygon points="4,3 18,8 4,13" fill="#ffd400" stroke="#b89a00" strokeWidth="0.8" />
  </svg>
);

// Referee card (yellow or red).
export const CardIcon: React.FC<{ color: 'yellow' | 'red'; className?: string }> = ({ color, className = 'w-6 h-8' }) => (
  <svg viewBox="0 0 24 32" className={className} aria-hidden="true">
    <rect x="3" y="2" width="18" height="28" rx="2.5" fill={color === 'yellow' ? '#ffd400' : '#e0242b'} stroke="rgba(0,0,0,0.45)" strokeWidth="1.2" />
  </svg>
);

// Linesman's offside flag.
export const OffsideFlagIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-7' }) => (
  <svg viewBox="0 0 20 28" className={className} aria-hidden="true">
    <line x1="4" y1="2" x2="4" y2="27" stroke="#f5f5f5" strokeWidth="2" strokeLinecap="round" />
    <rect x="4" y="3" width="13" height="10" fill="#ffd400" stroke="#b89a00" strokeWidth="0.8" />
    <polygon points="4,3 10.5,8 4,13" fill="#d62828" />
  </svg>
);
