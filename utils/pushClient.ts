import * as api from '../services/api';

// Notifications exist only inside the installed app. Everything here is a no-op in a normal browser tab.
export const isInstalledApp = (): boolean =>
  !!(window.matchMedia?.('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as any).standalone === true);

export const pushSupported = (): boolean =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const urlBase64ToUint8Array = (b64: string): Uint8Array<ArrayBuffer> => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Must be called from a tap (browsers require a gesture to ask for permission). */
export async function enableNotifications(): Promise<boolean> {
  if (!pushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { publicKey } = await api.pushPublicKey();
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  await api.pushSubscribe(sub.toJSON());
  return true;
}

/** Re-attach this phone to the person who just signed in (the same phone may have been used by someone else). */
export async function refreshSubscription(): Promise<void> {
  try {
    if (!isInstalledApp() || !pushSupported() || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.register('/sw.js');
    const sub = await reg.pushManager.getSubscription();
    if (sub) await api.pushSubscribe(sub.toJSON());
  } catch { /* best effort */ }
}

/** On sign-out: stop notifications for this phone. Call BEFORE the session token is cleared. */
export async function disableNotifications(): Promise<void> {
  try {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await api.pushUnsubscribe(endpoint).catch(() => {});
    await sub.unsubscribe();
  } catch { /* best effort */ }
}
