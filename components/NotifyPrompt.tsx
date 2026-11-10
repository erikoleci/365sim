import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { enableNotifications, isInstalledApp, pushSupported, refreshSubscription } from '../utils/pushClient';

const DISMISS_KEY = 'notify-prompt-dismissed';
const read = (): boolean => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } };

// Small strip shown only inside the installed app, until the person turns notifications on (or says "Jo tani").
const NotifyPrompt: React.FC = () => {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isInstalledApp() || !pushSupported()) return;
    if (Notification.permission === 'granted') { void refreshSubscription(); return; }
    if (Notification.permission === 'default' && !read()) setVisible(true);
  }, []);

  if (!visible) return null;
  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } setVisible(false); };
  const enable = async () => { try { await enableNotifications(); } catch { /* ignore */ } setVisible(false); };

  return (
    <div className="mx-3 mt-2 flex items-center gap-3 rounded-xl border border-brand-yellow/30 bg-black/40 px-3 py-2 text-xs">
      <span className="flex-1 text-brand-text">🔔 {t('Njoftime kur bileta fiton/humbet dhe kur mbaron një ndeshje me yll')}</span>
      <button onClick={enable} className="rounded-full bg-brand-yellow px-3 py-1 font-bold text-black">{t('Aktivizo')}</button>
      <button onClick={dismiss} className="text-brand-text/60">{t('Jo tani')}</button>
    </div>
  );
};
export default NotifyPrompt;
