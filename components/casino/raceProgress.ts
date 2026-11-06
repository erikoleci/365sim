import { useSyncExternalStore } from 'react';

/** Race progress lives outside React state: the 60 fps updates re-render ONLY the track, not the whole game screen with its betting board. */
export interface ProgressStore { get: () => number[]; set: (v: number[]) => void; subscribe: (l: () => void) => () => void }
export const makeProgressStore = (): ProgressStore => {
  let v: number[] = [0, 0, 0, 0, 0, 0]; const ls = new Set<() => void>();
  return { get: () => v, set: (n) => { v = n; ls.forEach((l) => l()); }, subscribe: (l) => { ls.add(l); return () => { ls.delete(l); }; } };
};
export const useRaceProgress = (store: ProgressStore) => useSyncExternalStore(store.subscribe, store.get);
