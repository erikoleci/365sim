import * as api from '../services/api';

// Web Push on the staff's own device: service worker + permission + subscription sent to the server.
export type PushState = 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => (window.matchMedia?.('(display-mode: standalone)').matches) || (navigator as any).standalone === true;
const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const keyBytes = (b64u: string) => {
  const pad = '='.repeat((4 - (b64u.length % 4)) % 4);
  const raw = atob((b64u + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export async function registerServiceWorker() {
  try { if ('serviceWorker' in navigator) await navigator.serviceWorker.register('/sw.js'); } catch { /* notifications just stay off */ }
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return isIos() && !isStandalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'on' : 'off';
  } catch { return 'off'; }
}

export async function enablePush(): Promise<PushState> {
  if (!supported()) return isIos() && !isStandalone() ? 'ios-install' : 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { publicKey } = await api.pushKey();
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await api.pushSubscribe(sub.toJSON());
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await api.pushUnsubscribe(sub.endpoint).catch(() => {}); await sub.unsubscribe(); }
  } catch { /* nothing to undo */ }
  return 'off';
}
