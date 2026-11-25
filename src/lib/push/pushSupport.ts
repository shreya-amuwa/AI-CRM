import { attendanceApi } from '../attendance';
import { registerServiceWorker } from './registerServiceWorker';
import { audioState, setPushActiveOnThisDevice } from '../notifications/notificationSound';

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

export const NOT_SET_UP = 'Notifications are not set up yet. Ask your administrator.';

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
  const state = await detectPushStateOnly();
  // the in-app sound stays quiet in a hidden tab when the operating system shows the push itself (lib/notifications/notificationSound.ts)
  setPushActiveOnThisDevice(state === 'on');
  return state;
}
async function detectPushStateOnly(): Promise<PushState> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  if (isIos() && !isStandalone()) return 'ios-needs-install';
  if (!pushAvailable()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const sub = await currentSubscription().catch(() => null);
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Which kind of device this is, for the setup guide. */
export type Platform = 'ios' | 'android' | 'windows' | 'mac' | 'other';
export function platformOf(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): Platform {
  if (/iPhone|iPad|iPod/.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'mac';
  return 'other';
}

/** Everything this browser can say about itself, for "Check device status". Nothing here is sent anywhere except the summary in reportDeviceCheck. */
export interface DeviceDiagnostics {
  platform: Platform;
  label: string;
  standalone: boolean;
  serviceWorker: boolean;
  pushApi: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
  state: PushState;
  audio: ReturnType<typeof audioState>;
  endpoint: string | null;
}
export async function deviceDiagnostics(): Promise<DeviceDiagnostics> {
  const state = await detectPushState();
  const sub = await currentSubscription().catch(() => null);
  return {
    platform: platformOf(), label: deviceLabel(), standalone: typeof window !== 'undefined' && isStandalone(),
    serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    pushApi: typeof window !== 'undefined' && 'PushManager' in window,
    permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
    subscribed: !!sub, state, audio: audioState(), endpoint: sub?.endpoint ?? null
  };
}

/** This browser's random id (not linked to anything else), so its reports replace each other in Notification Health. */
function clientId(): string {
  const KEY = 'crm.notify.clientId';
  try {
    const have = localStorage.getItem(KEY);
    if (have && /^[A-Za-z0-9-]{8,64}$/.test(have)) return have;
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return 'no-storage-client';
  }
}

/**
 * Tell the server what this browser reports (permission, subscribed, audio allowed): at most once a day per person, or when it changed.
 * Only that summary is sent (no address, no key). Never throws.
 */
export async function reportDeviceCheck(profileId: string, force = false): Promise<void> {
  try {
    const d = await deviceDiagnostics();
    const summary = [profileId, d.permission, d.state, d.audio, d.standalone].join('|');
    const KEY = 'crm.notify.lastCheck';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    let last: { summary?: string; day?: string } = {};
    try { last = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* */ }
    if (!force && last.summary === summary && last.day === today) return;
    await attendanceApi.clientCheck({ clientId: clientId(), label: d.label, permission: d.permission, pushState: d.state, audioState: d.audio, standalone: d.standalone });
    try { localStorage.setItem(KEY, JSON.stringify({ summary, day: today })); } catch { /* */ }
  } catch { /* an older database, or offline: nothing to report */ }
}

/** This browser's own subscription address (only to mark "the test appeared on THIS device"). */
export async function thisDeviceEndpoint(): Promise<string | null> {
  return (await currentSubscription().catch(() => null))?.endpoint ?? null;
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

/**
 * Chrome says "Registration failed - push service error" when the phone cannot reach its push service (Google's FCM): no Play services,
 * Data Saver, a VPN or ad blocker, a flaky connection, or Brave with push messaging switched off. It is often brief, so try once more,
 * then say what to check instead of showing the browser's raw text.
 */
const PUSH_SERVICE_HELP = "This phone could not reach its push service. Check your internet connection, turn off Data Saver, a VPN or an ad blocker, "
  + 'and update Google Play services and Chrome, then tap "Turn on notifications" again. In Brave: Settings > Privacy and security > turn on '
  + '"Use Google Services for Push Messaging".';
async function subscribeWithRetry(reg: ServiceWorkerRegistration, applicationServerKey: BufferSource): Promise<PushSubscription> {
  const attempt = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  try {
    return await attempt();
  } catch (first) {
    if (!isPushServiceError(first)) throw first;
    await new Promise(r => setTimeout(r, 1500));
    try {
      return await attempt();
    } catch (second) {
      throw isPushServiceError(second) ? new Error(PUSH_SERVICE_HELP) : second;
    }
  }
}
const isPushServiceError = (e: unknown) =>
  e instanceof Error && (e.name === 'AbortError' || e.name === 'NetworkError' || /push service|registration failed/i.test(e.message));

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
  if (!pushAvailable()) throw new Error('This browser cannot show notifications.');
  // the first thing the tap does: nothing is awaited before it
  const asked = Notification.requestPermission();
  const [permission, key] = await Promise.all([asked, loadPushKey()]);
  if (!key) throw new Error(NOT_SET_UP);
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? "Notifications are blocked for this site. Allow them in your browser's site settings (see the steps below), then reload."
      : 'Notifications were not allowed. Tap "Turn on notifications" again and choose Allow.');
  }
  const reg = await registerServiceWorker();
  if (!reg) throw new Error('This browser cannot show notifications.');
  const sub = (await reg.pushManager.getSubscription()) ?? (await subscribeWithRetry(reg, keyBytes(key)));
  await save(sub);
  setPushActiveOnThisDevice(true);
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
