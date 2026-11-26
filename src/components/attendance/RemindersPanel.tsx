import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, Smartphone } from 'lucide-react';
import { attendanceApi, type PushDevice, type ReminderCompany, type ReminderSettings } from '../../lib/attendance';
import { claimThisDevice, detectPushState, loadPushKey, subscribeThisDevice, type PushState } from '../../lib/push/pushSupport';
import { DeviceGuide, DeviceStatusCheck, NotificationSoundSettings, TestConfirm } from '../notifications/DeviceSetup';
import { playTestSound } from '../../lib/notifications/notificationSound';
import { MeetingNoticeSettings } from './MeetingNoticeSettings';

const card = 'rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4';
const field = 'h-10 px-3 rounded-xl border border-slate-200 text-sm bg-white w-full max-w-[10rem]';
const btn = 'inline-flex items-center justify-center h-10 px-4 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed';
const primary = `${btn} bg-blue-700 text-white hover:bg-blue-800`;
const secondary = `${btn} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'not yet');

type Times = { punchIn: string; lunch: string; punchOut: string };
const TIME_FIELDS: { key: keyof Times; label: string; range: string }[] = [
  { key: 'punchIn', label: 'Punch In', range: '06:00–13:00' },
  { key: 'lunch', label: 'Lunch', range: '11:00–17:00' },
  { key: 'punchOut', label: 'Punch Out', range: '14:00–23:30' }
];

/** Chat messages on this person's devices: saved as soon as it is switched (no Save button). */
const ChatSwitch: React.FC<{ settings: ReminderSettings; onSaved: (s: ReminderSettings) => void }> = ({ settings, onSaved }) => {
  const [on, setOn] = useState(settings.chatPush !== false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = async (next: boolean) => {
    setBusy(true);
    setError('');
    setOn(next);
    try { onSaved(await attendanceApi.setChatPush(next)); } catch (e) { setOn(!next); setError(message(e)); } finally { setBusy(false); }
  };
  return (
    <div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="h-4 w-4" checked={on} disabled={busy} onChange={e => void toggle(e.target.checked)} /> Chat notifications
      </label>
      <p className="ml-6 text-xs text-slate-500">New chat messages. Colleague chats show the message; client chats show only the name.</p>
      {error && <p role="alert" className="ml-6 text-sm text-red-700">{error}</p>}
    </div>
  );
};

/** Your own reminder times: empty = the company time. */
const MyReminders: React.FC<{ settings: ReminderSettings; onSaved: (s: ReminderSettings) => void }> = ({ settings, onSaved }) => {
  const mine = settings.mine!;
  const [enabled, setEnabled] = useState(mine.enabled);
  const [times, setTimes] = useState<Times>({ punchIn: mine.punchIn ?? '', lunch: mine.lunch ?? '', punchOut: mine.punchOut ?? '' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      onSaved(await attendanceApi.saveMyReminders(enabled, times.punchIn || null, times.lunch || null, times.punchOut || null));
      setNote({ ok: true, text: 'Saved.' });
    } catch (e) {
      setNote({ ok: false, text: message(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={card} aria-label="My reminder times" data-testid="my-reminders">
      <div>
        <h3 className="text-base font-bold">My notifications</h3>
        <p className="text-sm text-slate-600">Monday to Saturday, India time. Leave a time empty to use the company time. Nothing is sent on approved leave or once it is done.</p>
      </div>
      <ChatSwitch settings={settings} onSaved={onSaved} />
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="h-4 w-4" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Attendance reminders
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        {TIME_FIELDS.map(f => (
          <div key={f.key} className="space-y-1">
            <label htmlFor={`my-${f.key}`} className="block text-sm font-semibold">{f.label} reminder</label>
            <div className="flex items-center gap-2">
              <input id={`my-${f.key}`} type="time" className={field} value={times[f.key]} disabled={!enabled}
                onChange={e => setTimes(t => ({ ...t, [f.key]: e.target.value }))} />
              {times[f.key] && <button type="button" className="text-xs font-semibold text-blue-700 hover:underline" onClick={() => setTimes(t => ({ ...t, [f.key]: '' }))}>Use company time</button>}
            </div>
            <p className="text-xs text-slate-500">Company time {settings.company[f.key]} · allowed {f.range}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={primary} disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save my times'}</button>
        {note && <p role={note.ok ? 'status' : 'alert'} className={`text-sm ${note.ok ? 'text-emerald-700' : 'text-red-700'}`}>{note.text}</p>}
      </div>
    </section>
  );
};

/** This device's state, the person's devices (Remove), and a test notification. */
const MyDevices: React.FC = () => {
  const [state, setState] = useState<PushState | null>(null);
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [askConfirm, setAskConfirm] = useState(false);
  const [registered, setRegistered] = useState<boolean | null>(null);
  const load = useCallback(async () => {
    try { setDevices(await attendanceApi.devices()); } catch (e) { setNote({ ok: false, text: message(e) }); }
  }, []);
  // is THIS browser's subscription known to the server for the signed-in person? (the same check the banner makes at every load)
  useEffect(() => {
    if (state !== 'on') { setRegistered(state === null ? null : false); return; }
    let live = true;
    void claimThisDevice().then(r => { if (live) setRegistered(r === 'claimed'); });
    return () => { live = false; };
  }, [state]);
  useEffect(() => { void detectPushState().then(s => { if (s === 'off') void loadPushKey(); setState(s); }); void load(); }, [load]);
  const run = async (key: string, work: () => Promise<string | void>) => {
    setBusy(key);
    setNote(null);
    try {
      const text = await work();
      if (text) setNote({ ok: true, text });
    } catch (e) {
      setNote({ ok: false, text: message(e) });
    } finally {
      setBusy('');
    }
  };
  const stateText: Record<PushState, string> = {
    on: 'Notifications are on for this device.',
    off: 'Enable notifications to receive Punch In, Lunch, Resume Work and Punch Out reminders.',
    blocked: "Notifications are blocked for this site. Allow them in your browser's site settings (see Notification troubleshooting below), then reload.",
    'ios-needs-install': 'To get notifications on iPhone: tap Share, then Add to Home Screen, then open Amuwa CRM from your Home Screen.',
    unsupported: 'This browser cannot show notifications. Use Chrome, Edge, Firefox or Safari.'
  };
  return (
    <section className={card} aria-label="My devices">
      <h3 className="text-base font-bold">My devices</h3>
      <div data-testid="this-device" className="flex flex-wrap items-center gap-3 text-sm">
        <BellRing className="w-5 h-5 text-blue-700" aria-hidden="true" />
        <p className="flex-1 min-w-[12rem]">{state ? stateText[state] : 'Checking this device…'}</p>
        {state === 'off' && (
          <button type="button" className={primary} disabled={!!busy} onClick={() => void run('on', async () => { await subscribeThisDevice(); setState('on'); await load(); return 'Notifications are on for this device.'; })}>
            Turn on notifications
          </button>
        )}
      </div>
      {devices === null ? <p className="text-sm text-slate-500" role="status">Loading devices…</p>
        : devices.length === 0 ? <p className="text-sm text-slate-500">No devices yet. Turn on notifications on your phone and your laptop.</p>
        : (
          <ul className="divide-y divide-slate-100">
            {devices.map(d => (
              <li key={d.id} data-testid="device-row" className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <Smartphone className="w-4 h-4 text-slate-500" aria-hidden="true" />
                <div className="flex-1 min-w-[10rem]">
                  <p className="font-semibold">{d.label || 'A device'}{d.active ? '' : ' (switched off)'}</p>
                  <p className="text-xs text-slate-500">Added {when(d.createdAt)} · last accepted by the push service {when(d.lastSuccessAt)}
                    {d.testConfirmedAt ? ` · test confirmed ${when(d.testConfirmedAt)}` : ''}</p>
                  {!d.active && d.deactivatedReason === 'EXPIRED_AT_PUSH_SERVICE' && <p className="text-xs text-amber-700">The browser ended this subscription. Turn notifications on again on that device.</p>}
                  {d.active && d.lastFailureAt && (!d.lastSuccessAt || d.lastFailureAt > d.lastSuccessAt) && (
                    <p className="text-xs text-red-700">Last attempt failed {when(d.lastFailureAt)}{d.lastFailureCode ? ` (${d.lastFailureCode})` : ''}. It is retried automatically; if it keeps failing, remove the device and turn notifications on again.</p>
                  )}
                </div>
                <button type="button" className={secondary} disabled={!!busy} aria-label={`Remove ${d.label || 'device'}`}
                  onClick={() => void run(d.id, async () => {
                    await attendanceApi.removeDeviceById(d.id);
                    setDevices(ds => (ds ?? []).filter(x => x.id !== d.id));
                    // the device in your hand: its browser stops too, and this page says so
                    if (state === 'on' && (await claimThisDevice()) === 'removed') { setState('off'); void loadPushKey(); }
                  })}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={secondary} disabled={!!busy || !devices?.length}
          onClick={() => void run('test', async () => {
            setAskConfirm(false);
            const r = await attendanceApi.testPush();
            await load();
            if (r.pushConfigured === false) return 'Push notifications are not set up on the server yet. Ask your administrator; reminders still appear in the bell.';
            if (r.sent) setAskConfirm(true);
            return r.sent ? `Accepted by the push service for ${r.sent} device${r.sent === 1 ? '' : 's'}. It should appear in a few seconds.`
              : r.retry ? 'The push service is busy; the test will be retried shortly.' : 'Nothing was accepted. Turn notifications on again on your device.';
          })}>
          Send test notification
        </button>
        <button type="button" className={secondary} onClick={() => { playTestSound('attendance'); }}>Test sound</button>
        {note && <p role={note.ok ? 'status' : 'alert'} className={`text-sm ${note.ok ? 'text-emerald-700' : 'text-red-700'}`}>{note.text}</p>}
      </div>
      {askConfirm && <TestConfirm onDone={text => { setAskConfirm(false); setNote({ ok: true, text }); void load(); }} />}
      <DeviceStatusCheck registeredOnServer={registered} />
      <DeviceGuide />
    </section>
  );
};

/** HR: the Resume Work follow-up (when the database has it, 20270126000200). Saved on its own; audited. */
const ResumeFollowUp: React.FC<{ settings: ReminderSettings; onSaved: (s: ReminderSettings) => void }> = ({ settings, onSaved }) => {
  const [minutes, setMinutes] = useState(settings.company.resumeFollowUpMinutes ?? 10);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  if (settings.company.resumeFollowUpMinutes === undefined) return null;
  const save = async () => {
    setBusy(true);
    setNote(null);
    try { onSaved(await attendanceApi.saveResumeFollowUp(minutes)); setNote({ ok: true, text: 'Saved.' }); } catch (e) { setNote({ ok: false, text: message(e) }); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-1" data-testid="resume-follow-up">
      <label htmlFor="co-resume" className="block text-sm font-semibold">Resume Work follow-up (minutes, 0 = none)</label>
      <div className="flex flex-wrap items-center gap-3">
        <input id="co-resume" type="number" min={0} max={60} className={field} value={minutes} onChange={e => setMinutes(Number(e.target.value))} />
        <button type="button" className={secondary} disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save follow-up'}</button>
        {note && <p role={note.ok ? 'status' : 'alert'} className={`text-sm ${note.ok ? 'text-emerald-700' : 'text-red-700'}`}>{note.text}</p>}
      </div>
      <p className="text-xs text-slate-500">"Time to Resume Work" is sent when an open lunch reaches the {settings.company.lunchAllowanceMinutes ?? 45}-minute allowance left for the day; this is the one reminder after it.</p>
    </div>
  );
};

/** HR and the Super Admin: the company times, the days, the follow-up and the lunch warning, the master switch, "off for today". */
const CompanyReminders: React.FC<{ settings: ReminderSettings; onSaved: (s: ReminderSettings) => void }> = ({ settings, onSaved }) => {
  const [c, setC] = useState<ReminderCompany>(settings.company);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (work: () => Promise<ReminderSettings>, done: string) => {
    setBusy(true);
    setNote(null);
    try { onSaved(await work()); setNote({ ok: true, text: done }); } catch (e) { setNote({ ok: false, text: message(e) }); } finally { setBusy(false); }
  };
  const toggleDay = (d: number) => setC(x => ({ ...x, days: x.days.includes(d) ? x.days.filter(y => y !== d) : [...x.days, d].sort((a, b) => a - b) }));
  return (
    <section className={card} aria-label="Company reminder times" data-testid="company-reminders">
      <div>
        <h3 className="text-base font-bold">Company reminder times</h3>
        <p className="text-sm text-slate-600">Used by everyone who has not chosen their own time. Changes are recorded in the audit log.</p>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="h-4 w-4" checked={c.enabled} onChange={e => setC(x => ({ ...x, enabled: e.target.checked }))} /> Reminders are on for the company
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        {TIME_FIELDS.map(f => (
          <div key={f.key} className="space-y-1">
            <label htmlFor={`co-${f.key}`} className="block text-sm font-semibold">Company {f.label}</label>
            <input id={`co-${f.key}`} type="time" className={field} value={c[f.key]} onChange={e => setC(x => ({ ...x, [f.key]: e.target.value }))} />
            <p className="text-xs text-slate-500">allowed {f.range}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="co-follow" className="block text-sm font-semibold">Follow-up after (minutes)</label>
          <input id="co-follow" type="number" min={5} max={60} className={field} value={c.followUpMinutes} onChange={e => setC(x => ({ ...x, followUpMinutes: Number(e.target.value) }))} />
        </div>
        <div className="space-y-1">
          <label htmlFor="co-warn" className="block text-sm font-semibold">Lunch warning before the end (minutes)</label>
          <input id="co-warn" type="number" min={2} max={15} className={field} value={c.lunchWarningMinutes} onChange={e => setC(x => ({ ...x, lunchWarningMinutes: Number(e.target.value) }))} />
        </div>
      </div>
      <ResumeFollowUp settings={settings} onSaved={onSaved} />
      <fieldset>
        <legend className="text-sm font-semibold mb-2">Reminder days</legend>
        <div className="flex flex-wrap gap-3">
          {DAYS.map((name, i) => (
            <label key={name} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={c.days.includes(i + 1)} onChange={() => toggleDay(i + 1)} /> {name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={primary} disabled={busy} onClick={() => void act(() => attendanceApi.saveCompanyReminders(c), 'Company times saved.')}>
          {busy ? 'Saving…' : 'Save company times'}
        </button>
        <button type="button" className={secondary} disabled={busy}
          onClick={() => void act(() => attendanceApi.pauseToday(!settings.pausedToday), settings.pausedToday ? 'Reminders are back on for today.' : 'No more reminders today.')}>
          {settings.pausedToday ? 'Turn reminders back on for today' : 'Turn off reminders for today'}
        </button>
        {note && <p role={note.ok ? 'status' : 'alert'} className={`text-sm ${note.ok ? 'text-emerald-700' : 'text-red-700'}`}>{note.text}</p>}
      </div>
    </section>
  );
};

/** Attendance → Reminders. Staff: their times and devices. HR and the Super Admin also: the company defaults (the database checks again). */
export const RemindersPanel: React.FC = () => {
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    attendanceApi.reminderSettings().then(setSettings).catch(e => setError(message(e)));
  }, []);
  return (
    <div className="space-y-4" data-testid="reminders-panel">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!settings && !error && <p role="status" className="text-sm text-slate-500">Loading reminders…</p>}
      {settings?.mine && <MyReminders settings={settings} onSaved={setSettings} />}
      {settings?.mine && <MyDevices />}
      {settings && <NotificationSoundSettings confirmedAt={settings.sound?.confirmedAt ?? null} />}
      {settings?.canManage && <CompanyReminders settings={settings} onSaved={setSettings} />}
      {settings?.canManage && <MeetingNoticeSettings />}
    </div>
  );
};

export default RemindersPanel;
