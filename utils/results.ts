// "Rezultate": matches that FINISHED within the last 48 hours (by kickoff time), newest first,
// grouped by league. Pure, so it can be tested without React.
import { isMajorResultLeague } from './majorResults';
export const RESULTS_WINDOW_MS = 48 * 60 * 60 * 1000;

// `score` is only set by the server for a match that was really settled (result_home/result_away).
// A match closed without ever having a real score/clock is also FINISHED but has no `score`: it is
// NOT a result and is never listed (showing it would mean inventing a 0-0).
export interface ResultMatch { id: string; league: string; status: unknown; startTime: string; homeTeam: string; awayTeam: string; score?: { home?: number | null; away?: number | null } | null }

export function recentResults<T extends ResultMatch>(matches: T[], query: string, now: number = Date.now()): T[] {
  const q = query.trim().toLowerCase();
  return matches
    .filter((m) => String(m.status) === 'FINISHED')
    .filter((m) => m.score != null && m.score.home != null && m.score.away != null)
    .filter((m) => isMajorResultLeague(m.league)) // only the main competitions are listed as results
    .filter((m) => {
      const t = Date.parse(m.startTime);
      return !Number.isNaN(t) && t <= now && now - t <= RESULTS_WINDOW_MS;
    })
    .filter((m) => !q || m.homeTeam.toLowerCase().includes(q) || m.awayTeam.toLowerCase().includes(q) || m.league.toLowerCase().includes(q))
    .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
}

// League sections, the league with the most recent match first.
export function groupResultsByLeague<T extends ResultMatch>(list: T[]): { league: string; matches: T[] }[] {
  const by = new Map<string, T[]>();
  for (const m of list) {
    if (!by.has(m.league)) by.set(m.league, []);
    by.get(m.league)!.push(m);
  }
  return [...by.entries()].map(([league, matches]) => ({ league, matches }));
}
