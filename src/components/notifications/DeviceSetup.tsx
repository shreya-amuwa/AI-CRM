import React, { useEffect, useState } from 'react';
import { CheckCircle2, Stethoscope, Volume2, XCircle } from 'lucide-react';
import { attendanceApi } from '../../lib/attendance';
import { deviceDiagnostics, platformOf, thisDeviceEndpoint, type DeviceDiagnostics, type Platform } from '../../lib/push/pushSupport';
import { audioState, onAudioStateChange, playTestSound, setSoundEnabled, useSoundPrefs, type SoundCategory } from '../../lib/notifications/notificationSound';

/**
 * Notification setup on this device (Attendance → Reminders): the in-app sound switches and their test, what this browser reports about
 * itself, and the steps to fix blocked notifications per platform. The CRM bell keeps working whatever is chosen here.
 */
const card = 'rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4';
const btn = 'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed';
const secondary = `${btn} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`;
const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');

const SOUND_ROWS: { key: SoundCategory; label: string; help: string }[] = [
  { key: 'attendance', label: 'Attendance reminders', help: 'Punch In, Lunch, Resume Work and Punch Out.' },
  { key: 'chat', label: 'Chat messages', help: 'A new message while the chat is not on screen.' },
  { key: 'general', label: 'General notifications', help: 'Tasks, meetings, approvals and other alerts in the bell.' }
];

/** The three sound switches (saved with your settings, so they follow you to other browsers) and "Test sound". */
export const NotificationSoundSettings: React.FC<{ confirmedAt?: string | null }> = ({ confirmedAt }) => {
  const prefs = useSoundPrefs();
  const [audio, setAudio] = useState(audioState);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [asked, setAsked] = useState(false);
  const [confirmed, setConfirmed] = useState(!!confirmedAt);
  useEffect(() => onAudioStateChange(() => setAudio(audioState())), []);
  const test = () => {
    setNote(null);
    // inside the click: the browser allows sound now (it never does before the first tap on the page)
    const ok = playTestSound('attendance');
    setAudio(audioState());
    setAsked(ok);
    if (!ok) setNote({ ok: false, text: 'This browser did not allow sound. Check that the tab is not muted and the volume is up, then try again.' });
  };
  const heard = async (yes: boolean) => {
    setAsked(false);
    if (!yes) { setNote({ ok: false, text: 'Check the device volume, that this browser tab is not muted, and that the device is not on silent or Do Not Disturb.' }); return; }
    try { await attendanceApi.soundConfirm(); setConfirmed(true); setNote({ ok: true, text: 'Thanks — sound is confirmed on this device.' }); }
    catch (e) { setNote({ ok: false, text: message(e) }); }
  };
  return (
    <section className={card} aria-label="Notification sound" data-testid="notification-sound">
      <div>
        <h3 className="text-base font-bold">Notification sound</h3>
        <p className="text-sm text-slate-600">A short chime when a new notification arrives while the CRM is open. This is separate from your browser&apos;s permission to show notifications.</p>
      </div>
      <div className="space-y-2">
        {SOUND_ROWS.map(r => (
          <label key={r.key} className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 mt-0.5" checked={prefs[r.key]} onChange={e => setSoundEnabled(r.key, e.target.checked)} />
            <span><span className="font-semibold">{r.label}</span><span className="block text-xs text-slate-500">{r.help}</span></span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={secondary} onClick={test}><Volume2 className="w-4 h-4" aria-hidden="true" /> Test sound</button>
        <p className="text-xs text-slate-500" data-testid="audio-state">
          {audio === 'running' ? 'Sound is allowed in this tab.' : audio === 'unsupported' ? 'This browser cannot play sounds.'
            : 'The browser allows sound after you tap the page once (Test sound does that).'}
          {confirmed ? ' You confirmed hearing the test sound.' : ''}
        </p>
      </div>
      {asked && (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Did you hear the sound?">
          <span>Did you hear the chime?</span>
          <button type="button" className={secondary} onClick={() => void heard(true)}>Yes</button>
          <button type="button" className={secondary} onClick={() => void heard(false)}>No</button>
        </div>
      )}
      {note && <p role={note.ok ? 'status' : 'alert'} className={`text-sm ${note.ok ? 'text-emerald-700' : 'text-red-700'}`}>{note.text}</p>}
      <p className="text-xs text-slate-500">
        When the CRM is closed or in the background, notifications use your phone or computer&apos;s own notification sound, volume and
        Do Not Disturb settings. Websites cannot choose that sound, and some browsers show web notifications silently.
      </p>
    </section>
  );
};

/** "Did the test notification appear?" after a test: optional, recorded for this device only. */
export const TestConfirm: React.FC<{ onDone: (text: string) => void }> = ({ onDone }) => {
  const [appeared, setAppeared] = useState<boolean | null>(null);
  const answer = async (sound: boolean | null, seen = appeared) => {
    try {
      await attendanceApi.testConfirm(!!seen, sound, await thisDeviceEndpoint());
      onDone(seen ? 'Thanks — recorded for this device.' : 'Recorded. See "Check device status" and the steps below.');
    } catch (e) { onDone(message(e)); }
  };
  if (appeared === null) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Did the test notification appear?">
        <span>Did the test notification appear on this device?</span>
        <button type="button" className={secondary} onClick={() => setAppeared(true)}>Yes</button>
        <button type="button" className={secondary} onClick={() => void answer(null, false)}>No</button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Did it make a sound?">
      <span>Did it make a sound?</span>
      <button type="button" className={secondary} onClick={() => void answer(true)}>Yes</button>
      <button type="button" className={secondary} onClick={() => void answer(false)}>No</button>
    </div>
  );
};

const Row: React.FC<{ ok: boolean | null; label: string; value: string }> = ({ ok, label, value }) => (
  <li className="flex items-start gap-2 text-sm">
    {ok === null ? <span className="w-4 h-4 mt-0.5 shrink-0" /> : ok
      ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" aria-label="OK" />
      : <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" aria-label="Problem" />}
    <span><span className="font-semibold">{label}:</span> {value}</span>
  </li>
);

/** "Check device status": what this browser itself reports, one line each. */
export const DeviceStatusCheck: React.FC<{ registeredOnServer: boolean | null }> = ({ registeredOnServer }) => {
  const [d, setD] = useState<DeviceDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { setD(await deviceDiagnostics()); } finally { setBusy(false); } };
  return (
    <div className="space-y-2" data-testid="device-status">
      <button type="button" className={secondary} disabled={busy} onClick={() => void run()}>
        <Stethoscope className="w-4 h-4" aria-hidden="true" /> {busy ? 'Checking…' : 'Check device status'}
      </button>
      {d && (
        <ul className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <Row ok={null} label="Device" value={`${d.label}${d.standalone ? ' (installed app)' : ''}`} />
          <Row ok={d.serviceWorker && d.pushApi} label="Browser support" value={d.serviceWorker && d.pushApi ? 'Web notifications are supported.'
            : d.platform === 'ios' && !d.standalone ? 'On iPhone / iPad, notifications work only in the app added to the Home Screen.' : 'This browser cannot receive web notifications.'} />
          <Row ok={d.permission === 'granted'} label="Permission" value={d.permission === 'granted' ? 'Allowed.' : d.permission === 'denied' ? 'Blocked for this site.'
            : d.permission === 'default' ? 'Not asked yet: tap "Turn on notifications".' : 'Not available.'} />
          <Row ok={d.subscribed} label="This browser" value={d.subscribed ? 'Subscribed to CRM notifications.' : 'Not subscribed.'} />
          {registeredOnServer !== null && <Row ok={registeredOnServer} label="CRM" value={registeredOnServer ? 'This device is in your device list.' : 'This device is not in your list: turn notifications on again.'} />}
          <Row ok={d.audio === 'running'} label="In-app sound" value={d.audio === 'running' ? 'Allowed in this tab.' : d.audio === 'unsupported' ? 'Not supported.' : 'Waiting for a tap on the page (use Test sound).'} />
        </ul>
      )}
    </div>
  );
};

const GUIDES: Record<Platform, { title: string; steps: string[] }> = {
  ios: { title: 'iPhone / iPad', steps: [
    'Use iOS 16.4 or later. Open the CRM in Safari, tap Share, then Add to Home Screen.',
    'Open Amuwa CRM from the Home Screen icon (not from Safari) and sign in.',
    'Go to Attendance → Reminders and tap Turn on notifications, then Allow.',
    'If nothing appears: Settings → Notifications → Amuwa CRM → Allow Notifications, Sounds on; check Focus / Do Not Disturb.',
    'A normal Safari tab cannot receive these notifications; only the Home Screen app can.'] },
  android: { title: 'Android (Chrome)', steps: [
    'Tap Turn on notifications and choose Allow.',
    'If blocked: tap the icon left of the address → Permissions → Notifications → Allow, then reload.',
    'Android Settings → Apps → Chrome → Notifications: on, with sound. Turn off battery optimisation for Chrome if reminders arrive late.',
    'Optional: Install app (Chrome menu → Install app) for a CRM icon.'] },
  windows: { title: 'Windows (Chrome / Edge)', steps: [
    'Click Turn on notifications and choose Allow.',
    'If blocked: click the padlock left of the address → Site settings → Notifications → Allow, then reload.',
    'Windows Settings → System → Notifications: notifications on for Chrome / Edge; Do Not Disturb off.',
    'The browser must be running (it can be minimised) to receive notifications.'] },
  mac: { title: 'Mac (Safari / Chrome)', steps: [
    'Click Turn on notifications and choose Allow.',
    'If blocked: Safari → Settings → Websites → Notifications, or Chrome → padlock → Site settings → Notifications → Allow.',
    'System Settings → Notifications → your browser: Allow notifications, Play sound; check Focus.'] },
  other: { title: 'Your browser', steps: [
    'Click Turn on notifications and choose Allow.',
    "If blocked, allow notifications for this site in the browser's site settings, then reload.",
    'Check the system notification settings and Do Not Disturb.'] }
};

/** Troubleshooting steps for this kind of device (the others are one click away). */
export const DeviceGuide: React.FC = () => {
  const [p, setP] = useState<Platform>(() => platformOf());
  const g = GUIDES[p];
  return (
    <details className="rounded-xl border border-slate-200 p-3 text-sm" data-testid="device-guide">
      <summary className="cursor-pointer font-semibold">Notification troubleshooting</summary>
      <div className="mt-2 space-y-2">
        <label className="flex items-center gap-2 text-xs text-slate-600">Device
          <select className="h-8 px-2 rounded-lg border border-slate-200 bg-white" value={p} onChange={e => setP(e.target.value as Platform)}>
            {(Object.keys(GUIDES) as Platform[]).map(k => <option key={k} value={k}>{GUIDES[k].title}</option>)}
          </select>
        </label>
        <ol className="list-decimal pl-5 space-y-1 text-slate-700">{g.steps.map(s => <li key={s}>{s}</li>)}</ol>
        <p className="text-xs text-slate-500">"Sent" in the CRM means the push service accepted the notification; whether it shows or sounds also depends on these device settings.</p>
      </div>
    </details>
  );
};
