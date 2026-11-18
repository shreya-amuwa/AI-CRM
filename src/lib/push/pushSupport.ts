import { attendanceApi } from '../attendance';
import { registerServiceWorker } from './registerServiceWorker';

/**
 * Attendance reminders on this device (Web Push). What the browser can do, turning reminders on and off, and the "Install app" prompt.
 *
 * - off: the browser can receive reminders and this device has none yet
 * - on: this device is subscribed
 * - blocked: notifications are blocked for the site (only the person can change that, in the browser's site settings)
 * - ios-needs-install: an iPhone / iPad browser tab; iOS shows web notifications only for an app added to the Home Screen
 * - unsupported: no push in this browser
 */
export type PushState = 'unsupported' | 'ios-needs-install' | 'blocked' | 'off' | 'on';

export const NOT_SET_UP = 'Reminders are not set up yet. Ask your administrator.';

const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
  || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const pushAvailable = () => 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushAvailable()) return null;
  const reg = await registerServiceWorker();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function detectPushState(): Promise<PushState> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  if (isIos() && !isStandalone()) return 'ios-needs-install';
  if (!pushAvailable()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const sub = await currentSubscription().catch(() => null);
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** "Chrome on Android", "Safari on iPhone": how the device shows in the person's list. */
export function deviceLabel(ua: string = navigator.userAgent): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'device';
  return `${browser} on ${os}`;
}

const keyBytes = (base64url: string) => {
  const bin = atob(base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};

const parts = (sub: PushSubscription) => {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('This browser did not give a usable subscription.');
  return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
};
async function save(sub: PushSubscription): Promise<void> {
  const p = parts(sub);
  await attendanceApi.saveDevice(p.endpoint, p.p256dh, p.auth, deviceLabel());
}

/**
 * The server's public push key, fetched once when the banner or the Reminders tab shows. Safari (and Firefox) only show the permission
 * prompt when it is asked for straight from the tap, so "Turn on reminders" must not wait for the network before asking.
 */
let pushKey: Promise<string | null> | null = null;
let pushKeyValue: string | null | undefined;
export function loadPushKey(): Promise<string | null> {
  pushKey ??= attendanceApi.pushKey().then(k => { pushKeyValue = k; return k; }, () => { pushKey = null; return null; });
  return pushKey;
}

/** "Turn on reminders": ask for permission, subscribe this browser and save it for the signed-in person. Throws a message to show. */
export async function subscribeThisDevice(): Promise<void> {
  if (pushKeyValue === null) throw new Error(NOT_SET_UP);
  if (!pushAvailable()) throw new Error('This browser cannot show reminders.');
  // the first thing the tap does: nothing is awaited before it
  const asked = Notification.requestPermission();
  const [permission, key] = await Promise.all([asked, loadPushKey()]);
  if (!key) throw new Error(NOT_SET_UP);
  if (permission !== 'granted') throw new Error('Notifications were not allowed. Allow them for this site to get reminders.');
  const reg = await registerServiceWorker();
  if (!reg) throw new Error('This browser cannot show reminders.');
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  await save(sub);
}

/**
 * A device already subscribed is claimed by whoever is signed in now: on a shared phone where the last person did not sign out (an expired
 * session), the reminders then follow the person using it. A device the person removed from their list is never brought back: the browser
 * unsubscribes instead ('removed'). Never throws.
 */
export async function claimThisDevice(): Promise<'claimed' | 'removed' | 'none'> {
  try {
    const sub = await currentSubscription();
    if (!sub) return 'none';
    const p = parts(sub);
    if (await attendanceApi.claimDevice(p.endpoint, p.p256dh, p.auth, deviceLabel())) return 'claimed';
    await sub.unsubscribe().catch(() => undefined);
    return 'removed';
  } catch {
    return 'none';
  }
}

/** Signing out: this browser stops getting the person's reminders. Never throws and never takes long (sign-out must not wait on it). */
export async function unsubscribeThisDevice(): Promise<void> {
  const work = (async () => {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    await attendanceApi.removeDevice(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  })().catch(() => undefined);
  await Promise.race([work, new Promise(r => setTimeout(r, 2000))]);
}

// --- "Install app" (Android and desktop Chrome / Edge): the browser offers it once; keep the offer for the banner's button.
interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let installPrompt: InstallPromptEvent | null = null;
const installListeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPrompt = e as InstallPromptEvent;
    installListeners.forEach(l => l());
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; installListeners.forEach(l => l()); });
}
export const canInstall = () => installPrompt !== null;
export const onInstallChange = (listener: () => void) => { installListeners.add(listener); return () => { installListeners.delete(listener); }; };
export async function installApp(): Promise<void> {
  const p = installPrompt;
  if (!p) return;
  installPrompt = null;
  await p.prompt();
  installListeners.forEach(l => l());
}
