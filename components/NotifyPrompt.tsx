import { useEffect } from 'react';
import { enableNotifications, isInstalledApp, pushSupported, refreshSubscription } from '../utils/pushClient';

// Inside the installed app only: on the first tap after opening the app the system asks "Allow notifications?".
// (Browsers only allow that question right after a tap, so it can't be asked before the person touches the screen.)
// Already allowed -> just re-attach this phone to the signed-in person. Refused -> never asked again.
const NotifyPrompt: React.FC = () => {
  useEffect(() => {
    if (!isInstalledApp() || !pushSupported()) return;
    if (Notification.permission === 'granted') { void refreshSubscription(); return; }
    if (Notification.permission !== 'default') return;
    const ask = () => {
      document.removeEventListener('pointerup', ask, true);
      void enableNotifications().catch(() => {});
    };
    document.addEventListener('pointerup', ask, true);
    return () => document.removeEventListener('pointerup', ask, true);
  }, []);
  return null;
};
export default NotifyPrompt;
