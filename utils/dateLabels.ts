import { albaniaTodayKey } from './albaniaTime';

type Translate = (text: string, vars?: Record<string, string | number>) => string;

const SQ_DAY_NAMES = ['Die', 'Hën', 'Mar', 'Mër', 'Enj', 'Pre', 'Sht'];
const SQ_MONTH_NAMES = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gus', 'Sht', 'Tet', 'Nën', 'Dhj'];

/**
 * "Die 5 Jan" in Albanian; in English the weekday/month come from Intl (the Albanian arrays
 * cannot be run through t(): 'Mar' is both a day and a month).
 */
export const formatDayLabel = (d: Date, lang: string): string => {
  if (lang === 'en') {
    const wd = new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(d);
    const mo = new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(d);
    return `${wd} ${d.getDate()} ${mo}`;
  }
  return `${SQ_DAY_NAMES[d.getDay()]} ${d.getDate()} ${SQ_MONTH_NAMES[d.getMonth()]}`;
};

export interface DateOption {
  value: string;
  label: string;
}

/** The date strip: "All" plus today and the next six days, always in Albania's calendar. */
export const buildDateOptions = (t: Translate, lang: string): DateOption[] => {
  const options: DateOption[] = [{ value: 'ALL', label: t('Të gjitha') }];
  for (let i = 0; i < 7; i++) {
    const value = albaniaTodayKey(i);
    // noon avoids any DST-edge day shift when re-deriving weekday/day/month
    const d = new Date(`${value}T12:00:00`);
    const label = i === 0 ? t('Sot') : i === 1 ? t('Nesër') : formatDayLabel(d, lang);
    options.push({ value, label });
  }
  return options;
};

/** Label of a calendar date (YYYY-MM-DD) used as the divider inside a league. */
export const dateKeyLabel = (key: string, t: Translate, lang: string): string => {
  if (key === albaniaTodayKey(0)) return t('Sot');
  if (key === albaniaTodayKey(1)) return t('Nesër');
  const d = new Date(`${key}T12:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return formatDayLabel(d, lang);
};
