import React from 'react';
import { useI18n } from '../i18n';

// "When" line of one ticket leg:
//  - booked while the match was running  -> red LIVE tag + the minute and score at that moment (46' · 0-2)
//  - booked before kick-off              -> the kick-off time (Fillon 21:00, or with the date when not today)
export const LegWhen: React.FC<{ placedState?: { minute: number | null; h: number | null; a: number | null } | null; matchStartTime?: string | null; className?: string }> = ({ placedState, matchStartTime, className = '' }) => {
  const { t, locale } = useI18n();
  if (placedState && placedState.h != null && placedState.a != null) {
    return (
      <span className={`inline-flex items-center gap-1 tabular-nums ${className}`}>
        <span className="bg-red-600 text-white font-bold text-[9px] leading-none px-1 py-0.5 rounded">LIVE</span>
        <span className="text-white">{placedState.minute != null ? `${placedState.minute}' · ` : ''}{placedState.h}-{placedState.a}</span>
      </span>
    );
  }
  const ms = matchStartTime ? new Date(matchStartTime).getTime() : NaN;
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const zone = { timeZone: 'Europe/Tirane' } as const;
  const time = d.toLocaleTimeString(locale, { ...zone, hour: '2-digit', minute: '2-digit', hour12: false });
  const sameDay = d.toLocaleDateString(locale, zone) === new Date().toLocaleDateString(locale, zone);
  return (
    <span className={`tabular-nums text-brand-textMuted ${className}`}>
      {t('Fillon')} {sameDay ? time : `${d.toLocaleDateString(locale, { ...zone, day: '2-digit', month: '2-digit' })} ${time}`}
    </span>
  );
};

export default LegWhen;
