import React from 'react';
import { useI18n } from '../i18n';

// One reading of the live attack counters, taken every time the match page refreshes its statistics.
export interface AttackSample { at: number; ha: number; hd: number; aa: number; ad: number }

// Momentum: for each gap between two readings, how many attacks each team added (a dangerous attack counts double).
// Home bars go up from the middle line, away bars go down, the newest reading is on the right.
// Pure client-side: nothing extra is asked from the server, the bars grow while the page stays open.
const MomentumChart: React.FC<{ samples: AttackSample[]; home: string; away: string }> = ({ samples, home, away }) => {
  const { t } = useI18n();
  const bars = [];
  for (let i = 1; i < samples.length; i++) {
    const p = samples[i - 1], c = samples[i];
    const h = Math.max(0, c.ha - p.ha) + 2 * Math.max(0, c.hd - p.hd);
    const a = Math.max(0, c.aa - p.aa) + 2 * Math.max(0, c.ad - p.ad);
    bars.push({ h, a });
  }
  const shown = bars.slice(-24);
  const max = Math.max(4, ...shown.map((b) => Math.max(b.h, b.a)));
  const W = 240, H = 60, mid = H / 2, slot = W / 24, bw = slot * 0.7;
  return (
    <div className="rounded-xl bg-black/30 p-3">
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="font-bold text-brand-accent truncate max-w-[40%]">{home}</span>
        <span className="text-brand-textMuted uppercase tracking-wider">{t('Momentumi')}</span>
        <span className="font-bold text-red-400 truncate max-w-[40%] text-right">{away}</span>
      </div>
      {shown.length === 0 ? (
        <div className="text-center text-brand-textMuted text-xs py-4">{t('Po mblidhen të dhënat... grafiku rritet sa qëndron faqja hapur')}</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" role="img" aria-label={t('Momentumi')}>
          <line x1="0" y1={mid} x2={W} y2={mid} stroke="#555" strokeWidth="0.6" />
          {shown.map((b, i) => {
            const x = W - (shown.length - i) * slot + (slot - bw) / 2;
            const hh = (b.h / max) * (mid - 2), ah = (b.a / max) * (mid - 2);
            return (
              <g key={i}>
                {b.h > 0 && <rect x={x} y={mid - hh} width={bw} height={hh} rx="1" fill="#4ade80" opacity={0.5 + 0.5 * (i + 1) / shown.length} />}
                {b.a > 0 && <rect x={x} y={mid} width={bw} height={ah} rx="1" fill="#f87171" opacity={0.5 + 0.5 * (i + 1) / shown.length} />}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
};

export default MomentumChart;
