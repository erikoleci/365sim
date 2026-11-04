import React from 'react';
import type { LiveStatistics } from '../services/api';
import { useI18n } from '../i18n';

// Live statistics in the provider's style: three rings (attacks, dangerous attacks, possession) with the two
// numbers on either side, then a row with each team's corners and cards around the shots bar. Only real numbers
// are drawn: a ring or a figure whose value the feed did not send is left out, never shown as 0.

const YELLOW = '#ffdf1b';
const TRACK = 'rgba(255,255,255,0.32)';

const Ring: React.FC<{ home: number | null | undefined; away: number | null | undefined; glyph: 'chevron' | 'chevrons' | 'percent'; label: string; suffix?: string }> = ({ home, away, glyph, label, suffix = '' }) => {
  if (home == null && away == null) return null;
  const h = Number(home ?? 0), a = Number(away ?? 0);
  const total = h + a;
  const R = 22, C = 2 * Math.PI * R;
  const homeLen = total > 0 ? (h / total) * C : 0;
  return (
    <div className="flex flex-col items-center min-w-0">
      <div className="text-[11px] text-white/80 mb-1 text-center leading-tight">{label}</div>
      <div className="flex items-center gap-1.5">
        <span className="text-white font-extrabold text-lg tabular-nums w-8 text-right">{home ?? '–'}{suffix && home != null ? <span className="text-[10px] font-bold">{suffix}</span> : null}</span>
        <svg width="58" height="58" viewBox="0 0 58 58" className="flex-shrink-0">
          <circle cx="29" cy="29" r={R} fill="none" stroke={TRACK} strokeWidth="5" />
          {homeLen > 0 && <circle cx="29" cy="29" r={R} fill="none" stroke={YELLOW} strokeWidth="5" strokeLinecap="butt" strokeDasharray={`${homeLen} ${C - homeLen}`} transform="rotate(-90 29 29)" />}
          <circle cx="29" cy="29" r="14" fill="rgba(0,0,0,0.35)" />
          {glyph === 'chevron' && <path d="M26 22l8 7-8 7" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />}
          {glyph === 'chevrons' && <><path d="M23 22l7 7-7 7" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /><path d="M30 22l7 7-7 7" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></>}
          {glyph === 'percent' && <text x="29" y="34" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff">%</text>}
        </svg>
        <span className="text-white font-extrabold text-lg tabular-nums w-8 text-left">{away ?? '–'}{suffix && away != null ? <span className="text-[10px] font-bold">{suffix}</span> : null}</span>
      </div>
    </div>
  );
};

const Flag: React.FC = () => (
  <svg width="13" height="15" viewBox="0 0 16 16"><path d="M3 1.5v13" stroke="#f87171" strokeWidth="1.8" strokeLinecap="round" /><path d="M3.8 2.2h8l-2.2 3 2.2 3h-8z" fill="#f87171" /></svg>
);
const Card: React.FC<{ color: string }> = ({ color }) => <span className="inline-block w-2.5 h-3.5 rounded-[2px]" style={{ background: color }} />;

const Mini: React.FC<{ icon: React.ReactNode; value: number | null | undefined }> = ({ icon, value }) => (
  <div className="flex flex-col items-center gap-0.5 w-7">
    {icon}
    <span className="text-white font-bold text-sm tabular-nums">{value ?? '–'}</span>
  </div>
);

const StatRings: React.FC<{ stats: LiveStatistics }> = ({ stats }) => {
  const { t } = useI18n();
  const s = stats;
  const hasShots = s.shots_home != null || s.shots_away != null || s.shots_on_target_home != null || s.shots_on_target_away != null;
  const sh = Number(s.shots_home ?? 0), sa = Number(s.shots_away ?? 0);
  const homeShare = sh + sa > 0 ? (sh / (sh + sa)) * 100 : 50;
  const hasCornersCards = s.corners_home != null || s.corners_away != null || s.cards_home != null || s.cards_away != null;
  // yellow / red per team when the feed splits them; otherwise the card total counts as yellow-less "cards"
  const yh = s.yellow_home ?? s.cards_home, ya = s.yellow_away ?? s.cards_away;
  return (
    <div className="rounded-xl bg-black/30 p-3">
      <div className="grid grid-cols-3 gap-1">
        <Ring home={s.attacks_home} away={s.attacks_away} glyph="chevron" label={t('Sulme')} />
        <Ring home={s.dangerous_attacks_home} away={s.dangerous_attacks_away} glyph="chevrons" label={t('Sulme të rrezikshme')} />
        <Ring home={s.possession_home} away={s.possession_away} glyph="percent" label={t('Zotërim topi')} suffix="%" />
      </div>
      {(hasShots || hasCornersCards) && (
        <div className="mt-4 flex items-end justify-between gap-2">
          <div className="flex gap-1">
            <Mini icon={<Flag />} value={s.corners_home} />
            <Mini icon={<Card color="#dc2626" />} value={s.red_home} />
            <Mini icon={<Card color={YELLOW} />} value={yh} />
          </div>
          {hasShots && (
            <div className="flex-1 min-w-0 px-1">
              <div className="text-center text-[11px] text-white/80 mb-1">{t('Goditje')} / {t('Në portë')}</div>
              <div className="flex items-center gap-2">
                <span className="text-white font-bold text-sm tabular-nums">{s.shots_home ?? '–'}/{s.shots_on_target_home ?? '–'}</span>
                <div className="flex-1 h-1.5 rounded-full bg-white/70 overflow-hidden"><div className="h-full" style={{ width: `${homeShare}%`, background: YELLOW }} /></div>
                <span className="text-white font-bold text-sm tabular-nums">{s.shots_away ?? '–'}/{s.shots_on_target_away ?? '–'}</span>
              </div>
            </div>
          )}
          <div className="flex gap-1">
            <Mini icon={<Card color={YELLOW} />} value={ya} />
            <Mini icon={<Card color="#dc2626" />} value={s.red_away} />
            <Mini icon={<Flag />} value={s.corners_away} />
          </div>
        </div>
      )}
    </div>
  );
};

export default StatRings;
