import { Match } from '../types';

// Turns whatever the live-scores provider sent us (a raw status code like
// "1H"/"HT"/"2H"/"FT"/"ET"/"PEN", or just a minute number) into a short
// Albanian label for the live badge — same source of truth used by the
// match card, the match detail header, and the live pitch widget.
export function formatLiveStatus(match: Pick<Match, 'currentMinute' | 'liveStatus'>): string {
  const raw = (match.liveStatus || '').toString().toUpperCase().trim();

  if (raw === 'HT' || raw === 'HALFTIME' || raw === 'HALF_TIME' || raw === 'PAUSED') {
    return 'Pushim (Pjesa e Parë ka Mbaruar)';
  }
  if (raw === 'FT' || raw === 'AET' || raw === 'ENDED' || raw === 'FINISHED') {
    return 'Ka Mbaruar';
  }
  if (raw === 'ET' || raw === 'EXTRA_TIME') {
    return 'Vazhdime';
  }
  if (raw === 'PEN' || raw === 'PENALTIES') {
    return 'Penallti';
  }
  if (raw === '1H' || raw === 'FIRST_HALF') {
    return match.currentMinute ? `${match.currentMinute}' (Pjesa 1)` : 'Pjesa e Parë';
  }
  if (raw === '2H' || raw === 'SECOND_HALF') {
    return match.currentMinute ? `${match.currentMinute}' (Pjesa 2)` : 'Pjesa e Dytë';
  }
  if (match.currentMinute) {
    return `${match.currentMinute}'`;
  }
  return 'LIVE';
}

export function isHalftime(match: Pick<Match, 'liveStatus'>): boolean {
  const raw = (match.liveStatus || '').toString().toUpperCase().trim();
  return raw === 'HT' || raw === 'HALFTIME' || raw === 'HALF_TIME' || raw === 'PAUSED';
}
