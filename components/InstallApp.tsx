import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';

// "Instalo si app" on the sign-in page. Android/desktop Chrome offer a real install prompt; iPhone has none, so it gets
// the two-step hint (Share -> Add to Home Screen). Hidden once the site already runs as an installed app.
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const isStandalone = (): boolean =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
const isIos = (): boolean => /iphone|ipad|ipod/i.test(navigator.userAgent);

const InstallApp: React.FC = () => {
  const { t } = useI18n();
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as InstallEvent); };
    const onInstalled = () => { setInstalled(true); setEvt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  if (installed || isStandalone()) return null;
  const ios = isIos();
  if (!evt && !ios) return null;

  return (
    <div className="mt-4 text-center">
      <button
        onClick={async () => {
          if (evt) { try { await evt.prompt(); await evt.userChoice; } catch { /* ignore */ } setEvt(null); }
          else setShowHint((v) => !v);
        }}
        className="inline-flex items-center gap-2 text-xs font-bold text-brand-yellow border border-brand-yellow/40 rounded-full px-4 py-2 hover:bg-brand-yellow/10 transition-colors"
      >
        <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5M4 15h12" /></svg>
        {t('Instalo si app')}
      </button>
      {!evt && ios && showHint && (
        <div className="mt-2 text-[11px] text-brand-textMuted leading-relaxed space-y-2">
          <p>{t('Në iPhone: shtyp "Share" (katrori me shigjetë) në Safari, pastaj "Add to Home Screen".')}</p>
          <a href="/365sim.mobileconfig" className="inline-block font-bold text-brand-yellow underline">{t('Ose instalo me një prekje (profil)')}</a>
          <p className="opacity-80">{t('Pas shkarkimit: Settings → "Profile Downloaded" → Install. Ikona shfaqet në ekran.')}</p>
        </div>
      )}
    </div>
  );
};

export default InstallApp;
