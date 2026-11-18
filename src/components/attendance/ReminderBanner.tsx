import React, { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { canInstall, claimThisDevice, detectPushState, installApp, loadPushKey, onInstallChange, subscribeThisDevice, type PushState } from '../../lib/push/pushSupport';

/** "Not now" hides the banner until the next office day (India time). */
const HIDDEN_KEY = 'att-reminder-banner-hidden';
const officeDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const hiddenToday = () => { try { return localStorage.getItem(HIDDEN_KEY) === officeDate(); } catch { return false; } };

const btn = 'inline-flex items-center justify-center h-9 px-3 rounded-lg text-sm font-semibold disabled:opacity-50';

/**
 * Attendance reminders on this device: shown at the top of every staff dashboard until the device gets reminders. It cannot be turned off
 * for good (the reminders are the point); "Not now" hides it for the rest of the day.
 */
export const ReminderBanner: React.FC = () => {
  const [state, setState] = useState<PushState | null>(null);
  const [hidden, setHidden] = useState(hiddenToday);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [justOn, setJustOn] = useState(false);
  const [installable, setInstallable] = useState(canInstall);

  useEffect(() => {
    let live = true;
    void detectPushState().then(async s => {
      if (s === 'off') void loadPushKey();
      // already subscribed: claim it for the person signed in now; a device they removed from their list is off again
      if (s === 'on' && (await claimThisDevice()) === 'removed') { s = 'off'; void loadPushKey(); }
      if (live) setState(s);
    });
    const off = onInstallChange(() => setInstallable(canInstall()));
    return () => { live = false; off(); };
  }, []);

  const turnOn = async () => {
    setBusy(true);
    setError('');
    try {
      await subscribeThisDevice();
      setJustOn(true);
      setState('on');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Notifications could not be turned on.');
      setState(await detectPushState());
    } finally {
      setBusy(false);
    }
  };
  const notNow = () => {
    try { localStorage.setItem(HIDDEN_KEY, officeDate()); } catch { /* private mode: hidden for this page only */ }
    setHidden(true);
  };

  if (justOn) {
    return <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Notifications are on for this device.</p>;
  }
  if (!state || state === 'on' || state === 'unsupported' || hidden) return null;
  const text = state === 'ios-needs-install'
    ? 'To get notifications on iPhone: tap Share, then Add to Home Screen, then open Amuwa CRM from your Home Screen.'
    : state === 'blocked'
      ? "Notifications are blocked for this site. Allow them in your browser's site settings, then reload."
      : 'Get chat messages and attendance reminders on this device.';
  return (
    <section data-testid="reminder-banner" aria-label="Notifications on this device" className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-slate-800">
      <div className="flex flex-wrap items-center gap-3">
        <BellRing className="w-5 h-5 shrink-0 text-blue-700" aria-hidden="true" />
        <p className="flex-1 min-w-[12rem]">{text}</p>
        <div className="flex flex-wrap gap-2">
          {state === 'off' && (
            <button type="button" className={`${btn} bg-blue-700 text-white hover:bg-blue-800`} disabled={busy} onClick={() => void turnOn()}>
              {busy ? 'Turning on…' : 'Turn on notifications'}
            </button>
          )}
          {installable && (
            <button type="button" className={`${btn} border border-blue-300 bg-white text-blue-800 hover:bg-blue-100`} onClick={() => void installApp()}>Install app</button>
          )}
          <button type="button" className={`${btn} text-slate-600 hover:bg-blue-100`} onClick={notNow}>Not now</button>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  );
};

export default ReminderBanner;
