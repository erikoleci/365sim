import React from 'react';

// Small inline-SVG icons for the live pitch (no external image files).

export const BallIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="11" fill="#fff" stroke="#222" strokeWidth="1.2" />
    <polygon points="12,6.2 16.2,9.2 14.6,14.2 9.4,14.2 7.8,9.2" fill="#222" />
    <g stroke="#222" strokeWidth="1.1" strokeLinecap="round">
      <line x1="12" y1="6.2" x2="12" y2="1.4" />
      <line x1="16.2" y1="9.2" x2="21" y2="7.6" />
      <line x1="14.6" y1="14.2" x2="17.8" y2="19" />
      <line x1="9.4" y1="14.2" x2="6.2" y2="19" />
      <line x1="7.8" y1="9.2" x2="3" y2="7.6" />
    </g>
  </svg>
);

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
