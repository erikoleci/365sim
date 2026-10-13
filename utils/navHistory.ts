// Phone "back" support. The app is a single page; without help the phone's back gesture/button
// leaves the site (or jumps to some earlier page) instead of returning from a match page to the
// list, or closing the open bet slip. Every in-app screen is a "nav" snapshot; the browser history
// holds one entry per step so back/forward walk through them, and in-app "back" buttons use the
// same history. The bet slip SELECTIONS are not part of a snapshot: they live in App state, so
// they survive going into a match and coming back (that is the point).
export interface Nav {
  detailMatchId: string | null;
  isMobileSlipOpen: boolean;
  showLiveOnly: boolean;
  showResults: boolean;
  currentLeague: string;
}

export const navKey = (n: Nav): string =>
  JSON.stringify([n.detailMatchId, n.isMobileSlipOpen, n.showLiveOnly, n.showResults, n.currentLeague]);

export type NavPlan =
  | { type: 'none' }                                   // same screen as now
  | { type: 'back' }                                   // going to the previous entry: pop, don't pile up
  | { type: 'push'; stack: Nav[]; idx: number };       // a new, deeper screen

// stack[idx] is the screen the history is on now. `next` is the screen the app just moved to.
export function planNav(stack: Nav[], idx: number, next: Nav): NavPlan {
  if (stack[idx] && navKey(stack[idx]) === navKey(next)) return { type: 'none' };
  if (idx > 0 && stack[idx - 1] && navKey(stack[idx - 1]) === navKey(next)) return { type: 'back' };
  const kept = stack.slice(0, idx + 1); // a new screen discards the "forward" entries, like a browser
  return { type: 'push', stack: [...kept, next], idx: idx + 1 };
}
