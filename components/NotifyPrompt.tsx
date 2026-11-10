import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { enableNotifications, isInstalledApp, pushSupported, refreshSubscription } from '../utils/pushClient';

// Installed app only. A visible strip with "Aktivizo" (a tap is what lets the phone show its "Allow notifications?"
// question) and, if the phone can't do notifications at all, a short reason instead of silence.
const NotifyPrompt: React.FC = () => {
  const { t } = useI18n();
  const [state, setState] = useState<'hidden' | 'ask' | 'unsupported' | 'denied' | 'error'>('hidden');

  useEffect(() => {
    if (!isInstalledApp()) return;
    if (!pushSupported()) { setState('unsupported'); return; }
    if (Notification.permission === 'granted') { void refreshSubscription(); return; }
    if (Notification.permission === 'denied') { setState('denied'); return; }
    setState('ask');
  }, []);

  if (state === 'hidden') return null;
  const enable = async () => {
    try {
      const ok = await enableNotifications();
      setState(ok ? 'hidden' : Notification.permission === 'denied' ? 'denied' : 'ask');
    } catch { setState('error'); }
  };
  const text = state === 'ask' ? t('🔔 Merr njoftime kur bileta fiton/humbet dhe kur mbaron një ndeshje me yll')
    : state === 'unsupported' ? t('Ky telefon nuk i mbështet njoftimet në këtë app (iPhone: duhet iOS 16.4+ dhe app-i i shtuar nga Share → Add to Home Screen).')
    : state === 'denied' ? t('Njoftimet janë bllokuar. Lejoji te Settings të telefonit për 365sim.')
    : t('Nuk u aktivizuan njoftimet. Provo përsëri.');
  return (
    <div className="mx-3 mt-2 flex items-center gap-3 rounded-xl border border-brand-yellow/30 bg-black/40 px-3 py-2 text-xs text-brand-text">
      <span className="flex-1">{text}</span>
      {(state === 'ask' || state === 'error') && (
        <button onClick={enable} className="rounded-full bg-brand-yellow px-3 py-1 font-bold text-black">{t('Aktivizo njoftimet')}</button>
      )}
      <button onClick={() => setState('hidden')} className="text-brand-text/60" aria-label="close">✕</button>
    </div>
  );
};
export default NotifyPrompt;
