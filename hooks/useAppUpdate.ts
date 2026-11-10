import { useEffect, useRef, useState } from 'react';

// A pushed update reaches an app that is already open (an installed app can stay open in the background for days).
// index.html is served no-cache and names the current hashed bundle, so a tiny fetch of it tells whether this tab runs
// the latest build. Checked when the app comes back to the foreground and every 10 minutes while it is open.
// Coming back after a longer pause reloads by itself (nothing is in progress then); otherwise a small bar offers it.
const CHECK_EVERY_MS = 10 * 60 * 1000;
const AUTO_RELOAD_AFTER_HIDDEN_MS = 2 * 60 * 1000;

const bundleOf = (html: string): string | null => html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? null;

export function useAppUpdate() {
  const [updateReady, setUpdateReady] = useState(false);
  const running = useRef<string | null>(null);
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    // Not in dev / tests: there is no hashed bundle to compare.
    const current = Array.from(document.scripts).map((s) => s.getAttribute('src') || '').find((s) => /\/assets\/index-[^/]+\.js$/.test(s));
    if (!current) return;
    running.current = current.startsWith('http') ? new URL(current).pathname : current;

    let busy = false;
    const check = async (): Promise<boolean> => {
      if (busy) return false;
      busy = true;
      try {
        const res = await fetch('/', { cache: 'no-store', headers: { Accept: 'text/html' } });
        if (!res.ok) return false;
        const latest = bundleOf(await res.text());
        const isNew = !!latest && latest !== running.current;
        if (isNew) setUpdateReady(true);
        return isNew;
      } catch { return false; } finally { busy = false; }
    };

    const onVisibility = async () => {
      if (document.visibilityState === 'hidden') { hiddenAt.current = Date.now(); return; }
      const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = null;
      const isNew = await check();
      if (isNew && away >= AUTO_RELOAD_AFTER_HIDDEN_MS) window.location.reload();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void check(); }, CHECK_EVERY_MS);
    return () => { document.removeEventListener('visibilitychange', onVisibility); window.clearInterval(timer); };
  }, []);

  return { updateReady, reload: () => window.location.reload() };
}
