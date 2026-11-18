import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

// A casino game opens as its own page: it covers the whole screen (also the site's header, because it is drawn straight
// into <body>, outside every other stacking context), has a bar that is always on top with a "Back to casino" button,
// and the phone's back button / browser back closes it too. The page behind does not scroll while a game is open.
interface Props {
  title: string;
  onBack: () => void;
  balance?: string;
  /** Floating things (music button...) that must sit above the game. */
  extra?: React.ReactNode;
  children: React.ReactNode;
}

const GameShell: React.FC<Props> = ({ title, onBack, balance, extra, children }) => {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    try { window.history.pushState({ casinoGame: true }, ''); } catch { /* ignore */ }
    const pop = () => onBack();
    window.addEventListener('popstate', pop);
    return () => { window.removeEventListener('popstate', pop); document.body.style.overflow = prev; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The bar above already has "Back to casino": hide the old inner "‹ Exit / ← Casino / ‹ Lobby" buttons the games draw themselves.
  const mainRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mainRef.current; if (!el) return undefined;
    let t = 0;
    const sweep = () => { t = 0; el.querySelectorAll('button').forEach((b) => { if (/^\s*(‹|←)\s+\S/.test(b.textContent || '')) (b as HTMLElement).style.display = 'none'; }); };
    const mo = new MutationObserver(() => { if (!t) t = window.setTimeout(sweep, 60); });
    mo.observe(el, { childList: true, subtree: true }); sweep();
    return () => { mo.disconnect(); window.clearTimeout(t); };
  }, []);
  const back = () => { try { if (window.history.state?.casinoGame) { window.history.back(); return; } } catch { /* ignore */ } onBack(); };

  return createPortal(
    <div className="gs-root fixed inset-0 z-[1000] flex flex-col text-white" role="dialog" aria-label={title}>
      <header className="gs-bar shrink-0 flex items-center gap-2 px-2 sm:px-4">
        <button type="button" onClick={back} className="gs-back" aria-label="Back to casino"><span aria-hidden>‹</span><span className="hidden xs:inline sm:inline"> Casino</span></button>
        <div className="flex-1 min-w-0 text-center truncate font-extrabold tracking-wide gs-title">{title}</div>
        <div className="gs-bal tabular-nums">{balance ?? ''}</div>
      </header>
      <main className="flex-1 overflow-y-auto overscroll-contain">
        <div ref={mainRef} className="gs-main max-w-5xl mx-auto p-2 sm:p-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 5rem)' }}>{children}</div>
      </main>
      {extra}
    </div>,
    document.body,
  );
};

export default GameShell;
