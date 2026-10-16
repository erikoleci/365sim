import { RefObject, useEffect } from 'react';

/**
 * Calls `onDismiss` when the mouse goes down outside `containerRef`, unless the target sits inside
 * an element matching `ignoreSelector` (the toggle that opened it, which would reopen it at once).
 */
export function useDismissOnOutsideClick(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  ignoreSelector: string,
) {
  useEffect(() => {
    if (!active) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (containerRef.current && !containerRef.current.contains(target) && !target.closest(ignoreSelector)) onDismiss();
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [active, containerRef, onDismiss, ignoreSelector]);
}
