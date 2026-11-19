import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarCheck2, CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock3, Copy, Crown, ExternalLink, Link2, Loader2, MapPin,
  Phone, Plus, Settings2, Trash2, UserPlus, Users, Video, X
} from 'lucide-react';
import type {
  GoogleCalendarStatus, Meeting, MeetingAvailabilityWindow, MeetingBookingLink, MeetingBusyBlock, MeetingDetail, MeetingDirectoryEntry, MeetingSettings
} from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { meetingsApi, type BookingLinkInput, type NewMeeting } from '../../lib/api/meetings';
import { SideDrawer } from '../common/SideDrawer';
import { takePendingMeeting, useMeetingsChanged, useOpenMeetingRequest } from './meetingEvents';
import { CeoPresencePanel, useCeoPresence } from './CeoPresence';

/**
 * Meetings: one calendar for appointments, demos, interviews, meetings and meetings with the CEO.
 *  - each employee connects their OWN Google Calendar; booked meetings then appear there with a Google Meet link, and Google sends the invitations
 *  - asking the CEO (Super Admin) for time makes a request the CEO or their delegate approves, declines or answers with another time
 *  - booking links let customers, leads and candidates pick a free slot themselves (/book/<link>)
 *  - demos, interviews and HR meetings booked in their own pages appear here too (changed there)
 * Reminders reach colleagues in the Notification Center and guests by e-mail, 24 hours and 1 hour before.
 */

const BROWSER_TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  } catch {
    return 'Asia/Kolkata';
  }
})();
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const KIND_OPTIONS: { value: NewMeeting['kind']; label: string }[] = [
  { value: 'MEETING', label: 'Meeting' },
  { value: 'APPOINTMENT', label: 'Appointment' },
  { value: 'DEMO', label: 'Demo' },
  { value: 'INTERVIEW', label: 'Interview' }
];
const MODE_LABEL: Record<string, string> = { GOOGLE_MEET: 'Google Meet', ONLINE_LINK: 'Online (own link)', IN_PERSON: 'In person', PHONE: 'Phone call' };
const STATUS_STYLE: Record<string, string> = {
  REQUESTED: 'bg-amber-50 text-amber-800 border-amber-200',
  PROPOSED: 'bg-violet-50 text-violet-800 border-violet-200',
  SCHEDULED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  DECLINED: 'bg-rose-50 text-rose-700 border-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200',
  COMPLETED: 'bg-sky-50 text-sky-800 border-sky-200',
  PENDING_AVAILABILITY: 'bg-orange-50 text-orange-800 border-orange-200'
};
const STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Waiting for approval', PROPOSED: 'Another time proposed', SCHEDULED: 'Scheduled', DECLINED: 'Declined', CANCELLED: 'Cancelled', COMPLETED: 'Done',
  PENDING_AVAILABILITY: 'Pending availability (the CEO is in a meeting)'
};
const SYNC_LABEL: Record<string, string> = {
  SYNCED: 'On Google Calendar', PENDING: 'Sending to Google…', FAILED: 'Google sync failed (retrying)', NOT_CONNECTED: 'Host has not connected Google', SKIPPED: 'Not on Google'
};
const SOURCE_LABEL: Record<string, string> = { ba_demo: 'Business Associate demo', career_interview: 'recruitment interview', employee_meeting: 'HR meeting request' };

const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
const labelCls = 'block text-xs font-semibold text-slate-600 mb-1';
const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50';
const btnPrimary = `${btn} bg-indigo-600 text-white hover:bg-indigo-700`;
const btnGhost = `${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayLabel = (d: Date) => d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
const fullWhen = (s: string, e: string) => `${new Date(s).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${timeOf(s)} – ${timeOf(e)}`;
const startOfWeek = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** A local date + time typed in the form, as an instant. */
const toIso = (date: string, time: string) => new Date(`${date}T${time}`).toISOString();

const ModeIcon: React.FC<{ mode: string; className?: string }> = ({ mode, className = 'w-3.5 h-3.5' }) =>
  mode === 'IN_PERSON' ? <MapPin className={className} /> : mode === 'PHONE' ? <Phone className={className} /> : <Video className={className} />;

const Notice: React.FC<{ tone: 'ok' | 'warn' | 'error'; children: React.ReactNode; onClose?: () => void }> = ({ tone, children, onClose }) => (
  <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
    tone === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : tone === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
    {tone === 'ok' ? <Check className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
    <div className="flex-1">{children}</div>
    {onClose && <button type="button" onClick={onClose} aria-label="Dismiss" className="text-current opacity-60 hover:opacity-100"><X className="w-4 h-4" /></button>}
  </div>
);

const GOOGLE_RETURN: Record<string, { tone: 'ok' | 'warn' | 'error'; text: string }> = {
  connected: { tone: 'ok', text: 'Google Calendar connected. Your meetings now appear in your Google Calendar with a Meet link, and your busy times are respected.' },
  denied: { tone: 'warn', text: 'Google Calendar was not connected: the permission was not given.' },
  expired: { tone: 'warn', text: 'The Google sign-in took too long. Please connect again.' },
  failed: { tone: 'error', text: 'Google Calendar could not be connected. Please try again; if it keeps failing, ask the administrator.' },
  'not-configured': { tone: 'warn', text: 'Google Calendar is not set up on the server yet. Ask the administrator.' }
};

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
type Tab = 'calendar' | 'requests' | 'settings';

export const MeetingsPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('calendar');
  const [google, setGoogle] = useState<GoogleCalendarStatus | null>(null);
  const [approvals, setApprovals] = useState<Meeting[]>([]);
  // The CEO (Super Admin) does not ask themselves for time: their "New meeting" goes straight onto their own calendar.
  const [isCeo, setIsCeo] = useState(false);
  // the CEO's own meetings today: the one being entered can be chosen in the Enter Meeting panel
  const [today, setToday] = useState<Meeting[]>([]);
  const [flash, setFlash] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [composer, setComposer] = useState<null | 'meeting' | 'ceo'>(null);
  // a meeting notification clicked before this page opened: show that meeting
  const [openId, setOpenId] = useState<string | null>(() => takePendingMeeting());
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey(k => k + 1), []);
  // live: a meeting notification (a new request, an approval, a move) reloads the page; so does coming back to the browser tab
  useMeetingsChanged(reload);
  useOpenMeetingRequest(useCallback((id?: string) => { if (id) setOpenId(id); reload(); }, [reload]));
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.removeEventListener('focus', reload); document.removeEventListener('visibilitychange', onVisible); };
  }, [reload]);

  // back from Google's sign-in: ?tab=meetings&google=<outcome>
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const outcome = q.get('google');
    if (outcome && GOOGLE_RETURN[outcome]) setFlash(GOOGLE_RETURN[outcome]);
    if (q.has('google') || q.get('tab') === 'meetings') {
      q.delete('google');
      q.delete('tab');
      const rest = q.toString();
      window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
    }
  }, []);

  useEffect(() => {
    meetingsApi.google().then(setGoogle).catch(() => setGoogle(null));
    meetingsApi.approvals().then(setApprovals).catch(() => setApprovals([]));
    meetingsApi.settings().then(x => setIsCeo(x.isCeo)).catch(() => setIsCeo(false));
  }, [reloadKey]);
  useEffect(() => {
    if (!isCeo) return setToday([]);
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    meetingsApi.list(from.toISOString(), addDays(from, 1).toISOString()).then(setToday).catch(() => setToday([]));
  }, [isCeo, reloadKey]);

  const done = (text: string) => {
    setFlash({ tone: 'ok', text });
    reload();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 font-heading flex items-center gap-2"><CalendarDays className="w-5 h-5 text-indigo-600" /> Meetings</h1>
          <p className="text-sm text-slate-500 mt-0.5">{isCeo ? 'Appointments, demos, interviews, meetings and requests for your time' : 'Appointments, demos, interviews, meetings and meetings with the CEO'} — in one calendar, synced to your Google Calendar.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isCeo && <button type="button" className={btnGhost} onClick={() => setComposer('ceo')}><Crown className="w-4 h-4 text-amber-500" /> Ask the CEO for time</button>}
          <button type="button" className={btnPrimary} onClick={() => setComposer('meeting')}><CalendarPlus className="w-4 h-4" /> New meeting</button>
        </div>
      </div>

      {flash && <Notice tone={flash.tone} onClose={() => setFlash(null)}>{flash.text}</Notice>}
      <CeoPresencePanel isCeo={isCeo} today={today} onDone={done} onError={t => setFlash({ tone: 'error', text: t })} onOpen={setOpenId} reloadKey={reloadKey} />
      {google && tab !== 'settings' && <GoogleBanner status={google} onOpenSettings={() => setTab('settings')} />}

      <div role="tablist" aria-label="Meetings sections" className="flex gap-1 border-b border-slate-200">
        {([['calendar', 'Calendar'], ['requests', `Requests${approvals.length ? ` (${approvals.length})` : ''}`], ['settings', 'Google, hours & booking links']] as [Tab, string][]).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)}
            className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px ${tab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'calendar' && <CalendarTab reloadKey={reloadKey} onOpen={setOpenId} />}
      {tab === 'requests' && <RequestsTab approvals={approvals} reloadKey={reloadKey} onOpen={setOpenId} onDone={done} onError={t => setFlash({ tone: 'error', text: t })} />}
      {tab === 'settings' && <SettingsTab google={google} onGoogleChange={setGoogle} onFlash={setFlash} />}

      {composer && <MeetingComposer mode={composer} onClose={() => setComposer(null)} onSaved={m => {
        setComposer(null);
        done(m.status === 'PENDING_AVAILABILITY'
          ? `${m.hostName} is currently attending another meeting. Your request is saved as PENDING AVAILABILITY and will be scheduled automatically when they are free; you will be told the confirmed time.`
          : m.status === 'REQUESTED'
          ? `Request sent to ${m.hostName}. You will be told when it is approved.`
          : `${m.kindLabel} booked for ${fullWhen(m.startsAt, m.endsAt)}.${m.googleSyncStatus === 'NOT_CONNECTED' ? ' Connect Google Calendar to add it there with a Meet link.' : ''}`);
      }} />}
      {openId && <MeetingDrawer id={openId} onClose={() => setOpenId(null)} onChanged={text => { done(text); }} />}
    </div>
  );
};
export default MeetingsPage;

const GoogleBanner: React.FC<{ status: GoogleCalendarStatus; onOpenSettings: () => void }> = ({ status, onOpenSettings }) => {
  if (status.connected) {
    return <p className="text-xs text-emerald-700 flex items-center gap-1.5"><CalendarCheck2 className="w-4 h-4" /> Google Calendar connected{status.googleEmail ? ` (${status.googleEmail})` : ''}.</p>;
  }
  if (!status.configured) return null;
  return (
    <Notice tone="warn">
      {status.status === 'NEEDS_RECONNECT' ? 'Google stopped accepting the CRM\'s access to your calendar. ' : 'Your Google Calendar is not connected yet. '}
      <button type="button" onClick={onOpenSettings} className="font-semibold underline">Connect Google Calendar</button> so your meetings appear there with a Meet link and nobody books you when you are busy.
    </Notice>
  );
};

// ---------------------------------------------------------------------------
// Calendar (week agenda)
// ---------------------------------------------------------------------------
const MeetingRow: React.FC<{ m: Meeting; onOpen: (id: string) => void }> = ({ m, onOpen }) => (
  <button type="button" onClick={() => onOpen(m.id)}
    className={`w-full text-left flex flex-wrap sm:flex-nowrap items-start gap-3 rounded-xl border px-3 py-2.5 hover:border-indigo-300 hover:bg-indigo-50/30 ${m.status === 'CANCELLED' || m.status === 'DECLINED' ? 'opacity-60' : ''} bg-white border-slate-200`}>
    <div className="sm:w-40 shrink-0 whitespace-nowrap text-sm font-semibold text-slate-800 tabular-nums">{timeOf(m.startsAt)}<span className="text-slate-400 font-normal"> – {timeOf(m.endsAt)}</span></div>
    <div className="flex-1 min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold text-slate-900 truncate">{m.title}</span>
        {m.kind === 'CEO_MEETING' && <Crown className="w-3.5 h-3.5 text-amber-500" aria-label="Meeting with the CEO" />}
      </div>
      <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
        <span>{m.kindLabel}</span>
        <span className="inline-flex items-center gap-1"><ModeIcon mode={m.mode} />{MODE_LABEL[m.mode]}</span>
        <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" />{m.hostName}{m.attendees.length ? ` +${m.attendees.length}` : ''}</span>
      </div>
    </div>
    <span className={`text-[11px] font-semibold border rounded-full px-2 py-0.5 shrink-0 ${STATUS_STYLE[m.status]}`}>{STATUS_LABEL[m.status]}</span>
  </button>
);

const CalendarTab: React.FC<{ reloadKey: number; onOpen: (id: string) => void }> = ({ reloadKey, onOpen }) => {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [items, setItems] = useState<Meeting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  useEffect(() => {
    let live = true;
    setItems(null);
    setError(null);
    meetingsApi.list(weekStart.toISOString(), addDays(weekStart, 7).toISOString())
      .then(r => live && setItems(r))
      .catch(e => live && setError(errorMessage(e)));
    return () => { live = false; };
  }, [weekStart, reloadKey]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const visible = (items ?? []).filter(m => showClosed || !['CANCELLED', 'DECLINED'].includes(m.status));
  const todayKey = dateKey(new Date());

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnGhost} onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week"><ChevronLeft className="w-4 h-4" /></button>
        <button type="button" className={btnGhost} onClick={() => setWeekStart(startOfWeek(new Date()))}>This week</button>
        <button type="button" className={btnGhost} onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week"><ChevronRight className="w-4 h-4" /></button>
        <span className="text-sm font-semibold text-slate-700 ml-1">{weekStart.toLocaleDateString([], { day: 'numeric', month: 'short' })} – {addDays(weekStart, 6).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        <label className="ml-auto text-xs text-slate-600 inline-flex items-center gap-1.5">
          <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} /> Show cancelled and declined
        </label>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {items === null && !error && <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading the week…</p>}
      {items !== null && (
        <div className="space-y-4">
          {days.map(d => {
            const list = visible.filter(m => dateKey(new Date(m.startsAt)) === dateKey(d));
            return (
              <section key={dateKey(d)} aria-label={dayLabel(d)}>
                <h3 className={`text-xs font-bold uppercase tracking-wide mb-1.5 ${dateKey(d) === todayKey ? 'text-indigo-700' : 'text-slate-500'}`}>
                  {dayLabel(d)}{dateKey(d) === todayKey ? ' · Today' : ''}
                </h3>
                {list.length ? <div className="space-y-1.5">{list.map(m => <MeetingRow key={m.id} m={m} onOpen={onOpen} />)}</div>
                  : <p className="text-xs text-slate-400 pl-1">No meetings</p>}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Requests: waiting for my decision (the CEO and their delegates), and my own requests
// ---------------------------------------------------------------------------
const RequestsTab: React.FC<{ approvals: Meeting[]; reloadKey: number; onOpen: (id: string) => void; onDone: (t: string) => void; onError: (t: string) => void }> = ({
  approvals, reloadKey, onOpen, onDone, onError
}) => {
  const [mine, setMine] = useState<Meeting[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const now = new Date();
    meetingsApi.list(addDays(now, -1).toISOString(), addDays(now, 120).toISOString())
      .then(r => setMine(r.filter(m => (m.status === 'REQUESTED' || m.status === 'PROPOSED' || m.status === 'PENDING_AVAILABILITY') && !m.canDecide)))
      .catch(() => setMine([]));
  }, [reloadKey]);
  const act = async (m: Meeting, decision: 'APPROVE' | 'DECLINE') => {
    setBusy(m.id);
    try {
      const note = decision === 'DECLINE' ? window.prompt('Reason for declining (optional, shared with the person asking):') ?? undefined : undefined;
      await meetingsApi.decide(m.id, { decision, note, version: m.version });
      onDone(decision === 'APPROVE' ? `Approved: ${m.title}.` : `Declined: ${m.title}.`);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-bold text-slate-800 mb-2">Waiting for your decision</h2>
        {!approvals.length ? <p className="text-sm text-slate-500">Nothing is waiting for you.</p> : (
          <div className="space-y-2">
            {approvals.map(m => (
              <div key={m.id} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <button type="button" onClick={() => onOpen(m.id)} className="font-semibold text-slate-900 hover:underline text-left">{m.title}</button>
                  <p className="text-xs text-slate-600">{fullWhen(m.startsAt, m.endsAt)} · asked by {m.createdByName ?? m.attendees.find(a => a.role === 'EXTERNAL')?.name ?? 'a guest'} · for {m.hostName}</p>
                  {m.description && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{m.description}</p>}
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={busy === m.id} className={btnPrimary} onClick={() => act(m, 'APPROVE')}><Check className="w-4 h-4" /> Approve</button>
                  <button type="button" disabled={busy === m.id} className={btnGhost} onClick={() => onOpen(m.id)}>Propose another time</button>
                  <button type="button" disabled={busy === m.id} className={btnGhost} onClick={() => act(m, 'DECLINE')}>Decline</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section>
        <h2 className="text-sm font-bold text-slate-800 mb-2">Your requests</h2>
        {mine === null ? <p className="text-sm text-slate-500">Loading…</p> : !mine.length ? <p className="text-sm text-slate-500">You have no open requests.</p> : (
          <div className="space-y-1.5">{mine.map(m => <MeetingRow key={m.id} m={m} onOpen={onOpen} />)}</div>
        )}
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
// One meeting: details and what the viewer may do
// ---------------------------------------------------------------------------
const MeetingDrawer: React.FC<{ id: string; onClose: () => void; onChanged: (text: string) => void }> = ({ id, onClose, onChanged }) => {
  const [m, setM] = useState<MeetingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [when, setWhen] = useState<{ purpose: 'reschedule' | 'propose'; date: string; start: string; end: string } | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(() => meetingsApi.detail(id).then(setM).catch(e => setError(errorMessage(e))), [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, text: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged(text);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const openWhen = (purpose: 'reschedule' | 'propose') => {
    if (!m) return;
    const s = new Date(m.startsAt);
    const e = new Date(m.endsAt);
    setWhen({ purpose, date: dateKey(s), start: `${pad(s.getHours())}:${pad(s.getMinutes())}`, end: `${pad(e.getHours())}:${pad(e.getMinutes())}` });
  };

  return (
    <SideDrawer title={m?.title ?? 'Meeting'} subtitle={m ? `${m.reference} · ${m.kindLabel}` : undefined} onClose={onClose}>
      <div className="p-5 space-y-4 text-sm">
        {error && <Notice tone="error">{error}</Notice>}
        {!m && !error && <p className="text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}
        {m && (
          <>
            <div className="flex flex-wrap gap-2 items-center">
              <span className={`text-xs font-semibold border rounded-full px-2 py-0.5 ${STATUS_STYLE[m.status]}`}>{STATUS_LABEL[m.status]}</span>
              <span className="text-xs text-slate-500">{SYNC_LABEL[m.googleSyncStatus]}</span>
            </div>
            <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-slate-500">When</dt><dd className="font-medium">{fullWhen(m.startsAt, m.endsAt)}</dd>
              {m.status === 'PROPOSED' && m.proposedStartsAt && m.proposedEndsAt && (<><dt className="text-violet-700">Proposed</dt><dd className="font-medium text-violet-800">{fullWhen(m.proposedStartsAt, m.proposedEndsAt)}</dd></>)}
              <dt className="text-slate-500">Where</dt>
              <dd className="flex items-center gap-1.5"><ModeIcon mode={m.mode} />{MODE_LABEL[m.mode]}{m.location ? ` — ${m.location}` : ''}</dd>
              <dt className="text-slate-500">Host</dt><dd>{m.hostName}</dd>
              {m.createdByName && m.createdBy !== m.hostId && (<><dt className="text-slate-500">Booked by</dt><dd>{m.createdByName}</dd></>)}
              {m.decisionNote && (<><dt className="text-slate-500">Note</dt><dd>{m.decisionNote}</dd></>)}
              {m.cancelReason && (<><dt className="text-slate-500">Reason</dt><dd>{m.cancelReason}</dd></>)}
            </dl>
            {m.meetLink && m.status === 'SCHEDULED' && (
              <a href={m.meetLink} target="_blank" rel="noopener noreferrer" className={`${btnPrimary} w-full`}><Video className="w-4 h-4" /> Join the meeting <ExternalLink className="w-3.5 h-3.5" /></a>
            )}
            {m.description && <p className="whitespace-pre-wrap text-slate-700 bg-slate-50 rounded-lg p-3">{m.description}</p>}
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase mb-1.5">People</h3>
              <ul className="space-y-1">
                <li className="flex justify-between"><span>{m.hostName} <span className="text-slate-400">(host)</span></span></li>
                {m.attendees.map(a => (
                  <li key={a.id} className="flex justify-between gap-2">
                    <span className="truncate">{a.name || a.email}{a.role === 'EXTERNAL' && <span className="text-slate-400"> · guest{a.email && a.name ? `, ${a.email}` : ''}</span>}</span>
                    <span className={`text-xs ${a.response === 'DECLINED' ? 'text-rose-600' : a.response === 'ACCEPTED' ? 'text-emerald-700' : 'text-slate-400'}`}>
                      {a.response === 'NEEDS_ACTION' ? 'invited' : a.response.toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {m.sourceType && <Notice tone="warn">This {SOURCE_LABEL[m.sourceType]} is managed in its own page; change or cancel it there and it updates here and in Google.</Notice>}

            {when && (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
                <p className="font-semibold text-slate-800">{when.purpose === 'reschedule' ? 'Move to' : 'Propose this time instead'}</p>
                <div className="grid grid-cols-3 gap-2">
                  <input aria-label="Date" type="date" className={inputCls} value={when.date} onChange={e => setWhen({ ...when, date: e.target.value })} />
                  <input aria-label="Start time" type="time" className={inputCls} value={when.start} onChange={e => setWhen({ ...when, start: e.target.value })} />
                  <input aria-label="End time" type="time" className={inputCls} value={when.end} onChange={e => setWhen({ ...when, end: e.target.value })} />
                </div>
                <input aria-label="Note" className={inputCls} placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} maxLength={1000} />
                <div className="flex gap-2">
                  <button type="button" disabled={busy} className={btnPrimary} onClick={() => run(
                    () => when.purpose === 'reschedule'
                      ? meetingsApi.reschedule(m.id, toIso(when.date, when.start), toIso(when.date, when.end), m.version, note)
                      : meetingsApi.decide(m.id, { decision: 'PROPOSE', note: note || undefined, startsAt: toIso(when.date, when.start), endsAt: toIso(when.date, when.end), version: m.version }),
                    when.purpose === 'reschedule' ? 'Meeting moved. Everyone is told.' : 'Another time proposed.')}>Save</button>
                  <button type="button" className={btnGhost} onClick={() => setWhen(null)}>Back</button>
                </div>
              </div>
            )}

            {!when && (
              <div className="flex flex-wrap gap-2 pt-1">
                {m.canDecide && <>
                  <button type="button" disabled={busy} className={btnPrimary} onClick={() => run(() => meetingsApi.decide(m.id, { decision: 'APPROVE', version: m.version }), 'Approved.')}><Check className="w-4 h-4" /> Approve</button>
                  <button type="button" disabled={busy} className={btnGhost} onClick={() => openWhen('propose')}>Propose another time</button>
                  <button type="button" disabled={busy} className={btnGhost} onClick={() => {
                    const reason = window.prompt('Reason for declining (optional):');
                    if (reason !== null) run(() => meetingsApi.decide(m.id, { decision: 'DECLINE', note: reason || undefined, version: m.version }), 'Request declined.');
                  }}>Decline</button>
                </>}
                {m.canAnswerProposal && <>
                  <button type="button" disabled={busy} className={btnPrimary} onClick={() => run(() => meetingsApi.answerProposal(m.id, true), 'Proposed time accepted. The meeting is scheduled.')}>Accept the proposed time</button>
                  <button type="button" disabled={busy} className={btnGhost} onClick={() => run(() => meetingsApi.answerProposal(m.id, false), 'Proposed time declined.')}>Decline it</button>
                </>}
                {m.canManage && ['REQUESTED', 'PROPOSED', 'SCHEDULED'].includes(m.status) && <>
                  <button type="button" disabled={busy} className={btnGhost} onClick={() => openWhen('reschedule')}><Clock3 className="w-4 h-4" /> Reschedule</button>
                  <button type="button" disabled={busy} className={`${btnGhost} text-rose-700`} onClick={() => {
                    const reason = window.prompt('Why is it cancelled? (optional, shared with everyone invited)');
                    if (reason !== null) run(() => meetingsApi.cancel(m.id, reason || undefined, m.version), 'Meeting cancelled. Everyone is told.');
                  }}><Trash2 className="w-4 h-4" /> Cancel</button>
                </>}
                {m.canManage && m.status === 'SCHEDULED' && new Date(m.startsAt) <= new Date() && (
                  <button type="button" disabled={busy} className={btnGhost} onClick={() => run(() => meetingsApi.complete(m.id), 'Marked as done.')}><Check className="w-4 h-4" /> Mark done</button>
                )}
                {m.status === 'SCHEDULED' && m.myResponse !== null && !m.canManage && (
                  <>
                    <button type="button" disabled={busy} className={btnGhost} onClick={() => run(() => meetingsApi.respond(m.id, 'ACCEPTED'), 'You accepted.')}>I will attend</button>
                    <button type="button" disabled={busy} className={btnGhost} onClick={() => run(() => meetingsApi.respond(m.id, 'DECLINED'), 'The host is told you cannot attend.')}>I cannot attend</button>
                  </>
                )}
              </div>
            )}

            {!!m.history.length && (
              <details className="text-xs text-slate-500">
                <summary className="cursor-pointer font-semibold">History</summary>
                <ul className="mt-2 space-y-1">
                  {m.history.map((h, i) => (
                    <li key={i}>{new Date(h.at).toLocaleString()} — {h.kind.replace(/_/g, ' ').toLowerCase()}{h.actorName ? ` by ${h.actorName}` : ''}{h.note ? `: ${h.note}` : ''}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </SideDrawer>
  );
};

// ---------------------------------------------------------------------------
// New meeting / asking the CEO
// ---------------------------------------------------------------------------
const DURATIONS = [15, 30, 45, 60, 90, 120];

const MeetingComposer: React.FC<{ mode: 'meeting' | 'ceo'; onClose: () => void; onSaved: (m: Meeting) => void }> = ({ mode, onClose, onSaved }) => {
  const tomorrow = addDays(new Date(), 1);
  const [people, setPeople] = useState<MeetingDirectoryEntry[]>([]);
  const [search, setSearch] = useState('');
  const [f, setF] = useState({
    title: '', description: '', kind: 'MEETING' as NewMeeting['kind'], hostId: '', date: dateKey(tomorrow), time: '11:00', duration: 30,
    mode: 'GOOGLE_MEET' as NewMeeting['mode'], location: '', meetLink: ''
  });
  const [invited, setInvited] = useState<string[]>([]);
  const [guests, setGuests] = useState<{ name: string; email: string }[]>([]);
  const [busyBlocks, setBusyBlocks] = useState<MeetingBusyBlock[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlap, setOverlap] = useState(false);

  useEffect(() => { meetingsApi.directory().then(setPeople).catch(() => setPeople([])); }, []);
  const ceos = people.filter(p => p.isCeo);
  // the chosen CEO's live availability: while BUSY the request is saved and waits (it is not confirmed now)
  const { list: presence } = useCeoPresence(mode === 'ceo');
  const ceoBusy = mode === 'ceo' && !!presence?.find(p => p.hostId === f.hostId && p.status === 'BUSY');
  useEffect(() => { if (mode === 'ceo' && !f.hostId && ceos[0]) setF(x => ({ ...x, hostId: ceos[0].id })); }, [mode, ceos, f.hostId]);

  // the chosen day's busy times of the CEO / the invited colleagues (CRM + their Google Calendar)
  const watch = useMemo(() => [...(mode === 'ceo' && f.hostId ? [f.hostId] : []), ...invited].slice(0, 30), [mode, f.hostId, invited]);
  useEffect(() => {
    if (!watch.length || !f.date) { setBusyBlocks([]); return; }
    const from = new Date(`${f.date}T00:00`);
    meetingsApi.busy(watch, from.toISOString(), addDays(from, 1).toISOString()).then(setBusyBlocks).catch(() => setBusyBlocks([]));
  }, [watch, f.date]);

  const start = f.date && f.time ? new Date(`${f.date}T${f.time}`) : null;
  const end = start ? new Date(start.getTime() + f.duration * 60_000) : null;
  const clashes = start && end ? busyBlocks.filter(b => new Date(b.start) < end && new Date(b.end) > start) : [];
  const nameOf = (id: string) => people.find(p => p.id === id)?.name ?? 'Someone';
  const matches = search.trim().length >= 1
    ? people.filter(p => !invited.includes(p.id) && p.id !== f.hostId && (p.name.toLowerCase().includes(search.toLowerCase()) || p.email.toLowerCase().includes(search.toLowerCase()))).slice(0, 8)
    : [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!start || !end) return;
    setSaving(true);
    setError(null);
    try {
      const m = await meetingsApi.create({
        title: f.title, description: f.description || null, kind: mode === 'ceo' ? 'CEO_MEETING' : f.kind, hostId: mode === 'ceo' ? f.hostId : null,
        startsAt: start.toISOString(), endsAt: end.toISOString(), timezone: BROWSER_TZ, mode: f.mode,
        location: f.location || null, meetLink: f.mode === 'ONLINE_LINK' ? f.meetLink : null,
        attendeeIds: invited, guests: guests.filter(g => g.email.trim()).map(g => ({ name: g.name || null, email: g.email.trim() })), allowOverlap: overlap
      });
      onSaved(m);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SideDrawer title={mode === 'ceo' ? 'Ask the CEO for time' : 'New meeting'} subtitle={mode === 'ceo' ? 'The CEO (or their delegate) approves, proposes another time or declines.' : 'Invite colleagues and guests; Google sends the invitations.'} onClose={onClose}>
      <form onSubmit={submit} className="p-5 space-y-4 text-sm">
        {error && <Notice tone="error">{error}</Notice>}
        {mode === 'ceo' && (
          ceos.length ? (
            <div>
              <label className={labelCls} htmlFor="mtg-ceo">With</label>
              <select id="mtg-ceo" className={inputCls} value={f.hostId} onChange={e => setF({ ...f, hostId: e.target.value })}>
                {ceos.map(c => <option key={c.id} value={c.id}>{c.name}{c.position ? ` — ${c.position}` : ' — CEO'}</option>)}
              </select>
            </div>
          ) : <Notice tone="warn">No CEO account was found.</Notice>
        )}
        {ceoBusy && (
          <div role="status" aria-live="polite" data-testid="ceo-busy-notice" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
            <p className="font-bold">Superadmin is currently attending another meeting.</p>
            <p className="mt-0.5">Your time is not confirmed now. Send the request: it is saved as PENDING AVAILABILITY and scheduled automatically, in the order requests were made, at the first free time from the one you choose, as soon as the CEO exits the meeting. You are notified of the confirmed date and time.</p>
          </div>
        )}
        <div>
          <label className={labelCls} htmlFor="mtg-title">{mode === 'ceo' ? 'Subject' : 'Title'}</label>
          <input id="mtg-title" required minLength={2} maxLength={200} className={inputCls} value={f.title} onChange={e => setF({ ...f, title: e.target.value })}
            placeholder={mode === 'ceo' ? 'e.g. Approval for the Pune office budget' : 'e.g. Product demo for Sharma Traders'} />
        </div>
        {mode === 'meeting' && (
          <div>
            <label className={labelCls} htmlFor="mtg-kind">Type</label>
            <select id="mtg-kind" className={inputCls} value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as NewMeeting['kind'] })}>
              {KIND_OPTIONS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <div><label className={labelCls} htmlFor="mtg-date">Date</label><input id="mtg-date" type="date" required className={inputCls} value={f.date} min={dateKey(new Date())} onChange={e => setF({ ...f, date: e.target.value })} /></div>
          <div><label className={labelCls} htmlFor="mtg-time">Start</label><input id="mtg-time" type="time" required className={inputCls} value={f.time} onChange={e => setF({ ...f, time: e.target.value })} /></div>
          <div><label className={labelCls} htmlFor="mtg-dur">Length</label>
            <select id="mtg-dur" className={inputCls} value={f.duration} onChange={e => setF({ ...f, duration: Number(e.target.value) })}>
              {DURATIONS.map(d => <option key={d} value={d}>{d < 60 ? `${d} min` : `${d / 60} h`}</option>)}
            </select>
          </div>
        </div>
        {!!busyBlocks.length && (
          <div className={`rounded-lg border p-2.5 text-xs ${clashes.length ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
            <p className="font-semibold mb-1">{clashes.length ? 'Someone is busy at this time' : 'Busy that day'}</p>
            <ul className="space-y-0.5">
              {busyBlocks.map((b, i) => <li key={i}>{nameOf(b.profileId)}: {timeOf(b.start)} – {timeOf(b.end)}</li>)}
            </ul>
          </div>
        )}
        <div>
          <label className={labelCls} htmlFor="mtg-mode">How</label>
          <select id="mtg-mode" className={inputCls} value={f.mode} onChange={e => setF({ ...f, mode: e.target.value as NewMeeting['mode'] })}>
            {Object.entries(MODE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {f.mode === 'GOOGLE_MEET' && <p className="text-xs text-slate-500 mt-1">A Google Meet link is created when the meeting reaches the host's Google Calendar.</p>}
        </div>
        {f.mode === 'ONLINE_LINK' && (
          <div><label className={labelCls} htmlFor="mtg-link">Meeting link</label><input id="mtg-link" type="url" required pattern="https://.*" className={inputCls} value={f.meetLink} onChange={e => setF({ ...f, meetLink: e.target.value })} placeholder="https://zoom.us/j/…" /></div>
        )}
        {(f.mode === 'IN_PERSON' || f.mode === 'PHONE') && (
          <div><label className={labelCls} htmlFor="mtg-loc">{f.mode === 'PHONE' ? 'Phone number / who calls' : 'Place'}</label><input id="mtg-loc" className={inputCls} maxLength={500} value={f.location} onChange={e => setF({ ...f, location: e.target.value })} /></div>
        )}
        <div>
          <label className={labelCls} htmlFor="mtg-people">Colleagues</label>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {invited.map(id => (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 text-indigo-800 text-xs px-2 py-0.5">
                {nameOf(id)}<button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={() => setInvited(invited.filter(x => x !== id))}><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
          <input id="mtg-people" className={inputCls} value={search} onChange={e => setSearch(e.target.value)} placeholder="Type a name to invite a colleague" autoComplete="off" />
          {!!matches.length && (
            <ul className="mt-1 border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-48 overflow-y-auto">
              {matches.map(p => (
                <li key={p.id}><button type="button" className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex justify-between gap-2" onClick={() => { setInvited([...invited, p.id]); setSearch(''); }}>
                  <span>{p.name} <span className="text-slate-400">· {p.department ?? p.role}</span></span>
                  {!p.googleConnected && <span className="text-[10px] text-slate-400">no Google</span>}
                </button></li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className={labelCls}>Guests outside the company</span>
            <button type="button" className="text-xs font-semibold text-indigo-700 inline-flex items-center gap-1" onClick={() => setGuests([...guests, { name: '', email: '' }])}><UserPlus className="w-3.5 h-3.5" /> Add guest</button>
          </div>
          {guests.map((g, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] gap-1.5 mb-1.5">
              <input aria-label={`Guest ${i + 1} name`} className={inputCls} placeholder="Name" value={g.name} onChange={e => setGuests(guests.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input aria-label={`Guest ${i + 1} e-mail`} type="email" required className={inputCls} placeholder="E-mail" value={g.email} onChange={e => setGuests(guests.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
              <button type="button" aria-label={`Remove guest ${i + 1}`} className="text-slate-400 hover:text-rose-600 px-1" onClick={() => setGuests(guests.filter((_, j) => j !== i))}><X className="w-4 h-4" /></button>
            </div>
          ))}
          {!guests.length && <p className="text-xs text-slate-400">Customers, leads or candidates get the invitation and reminders by e-mail.</p>}
        </div>
        <div>
          <label className={labelCls} htmlFor="mtg-desc">{mode === 'ceo' ? 'What it is about' : 'Agenda'}</label>
          <textarea id="mtg-desc" rows={3} maxLength={4000} className={inputCls} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
        </div>
        {mode === 'meeting' && /already have a meeting/i.test(error ?? '') && (
          <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={overlap} onChange={e => setOverlap(e.target.checked)} /> Book it anyway (overlapping my other meeting)</label>
        )}
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={saving || (mode === 'ceo' && !f.hostId)} className={btnPrimary}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'ceo' ? <Crown className="w-4 h-4" /> : <CalendarPlus className="w-4 h-4" />}
            {mode === 'ceo' ? (ceoBusy ? 'Submit the request (pending availability)' : 'Send the request') : 'Book the meeting'}
          </button>
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </SideDrawer>
  );
};

// ---------------------------------------------------------------------------
// Google, working hours, booking links, delegates
// ---------------------------------------------------------------------------
const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'Australia/Sydney', 'UTC'];

const SettingsTab: React.FC<{ google: GoogleCalendarStatus | null; onGoogleChange: (s: GoogleCalendarStatus) => void; onFlash: (f: { tone: 'ok' | 'warn' | 'error'; text: string }) => void }> = ({
  google, onGoogleChange, onFlash
}) => {
  const [s, setS] = useState<MeetingSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { meetingsApi.settings().then(setS).catch(e => setError(errorMessage(e))); }, []);

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await meetingsApi.googleConnect();
      window.location.assign(url);
    } catch (e) {
      onFlash({ tone: 'error', text: errorMessage(e) });
      setBusy(false);
    }
  };
  const disconnect = async () => {
    if (!window.confirm('Disconnect Google Calendar? New meetings will no longer be added to it. Meetings already there stay.')) return;
    setBusy(true);
    try {
      onGoogleChange(await meetingsApi.googleDisconnect());
      onFlash({ tone: 'ok', text: 'Google Calendar disconnected.' });
    } catch (e) {
      onFlash({ tone: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><CalendarCheck2 className="w-4 h-4 text-indigo-600" /> Your Google Calendar</h2>
        {!google ? <p className="text-sm text-slate-500 mt-2">Loading…</p> : !google.configured ? (
          <p className="text-sm text-slate-600 mt-2">Google Calendar is not set up on the server yet. The administrator adds the Google sign-in keys once (see the Meetings guide); then everyone can connect their own calendar here.</p>
        ) : google.connected ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="text-sm text-slate-700 flex-1">Connected{google.googleEmail ? ` as ${google.googleEmail}` : ''}. Meetings you host are added to it with a Meet link; your busy times there keep others from booking you.</p>
            <button type="button" disabled={busy} className={btnGhost} onClick={disconnect}>Disconnect</button>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="text-sm text-slate-700 flex-1">
              {google.status === 'NEEDS_RECONNECT' ? 'Google stopped accepting the CRM\'s access. Connect again.' : 'Connect your own Google account (work or personal).'} The CRM only creates and changes the meetings it books, and reads when you are busy — never your other events.
            </p>
            <button type="button" disabled={busy} className={btnPrimary} onClick={connect}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Connect Google Calendar</button>
          </div>
        )}
      </section>

      {error && <Notice tone="error">{error}</Notice>}
      {s && <HoursEditor settings={s} onSaved={x => { setS(x); onFlash({ tone: 'ok', text: 'Working hours saved.' }); }} onError={t => onFlash({ tone: 'error', text: t })} />}
      {s && <BookingLinks settings={s} onChanged={l => setS({ ...s, bookingTypes: [...s.bookingTypes.filter(x => x.id !== l.id), l] })} onFlash={onFlash} />}
      {s?.isCeo && <Delegates settings={s} onSaved={x => { setS(x); onFlash({ tone: 'ok', text: 'Delegates saved.' }); }} onError={t => onFlash({ tone: 'error', text: t })} />}
    </div>
  );
};

const HoursEditor: React.FC<{ settings: MeetingSettings; onSaved: (s: MeetingSettings) => void; onError: (t: string) => void }> = ({ settings, onSaved, onError }) => {
  const initial = () => WEEKDAYS.map((_, wd) => {
    const w = settings.availability.find(a => a.weekday === wd);
    const def = settings.availabilityIsDefault && wd >= 1 && wd <= 6;
    return { on: !!w || def, start: w?.start ?? '10:00', end: w?.end ?? '18:00' };
  });
  const [rows, setRows] = useState(initial);
  const [tz, setTz] = useState(settings.timezone);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const availability: MeetingAvailabilityWindow[] = rows.flatMap((r, weekday) => (r.on ? [{ weekday, start: r.start, end: r.end }] : []));
      onSaved(await meetingsApi.setAvailability(tz, availability));
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Clock3 className="w-4 h-4 text-indigo-600" /> Working hours for booking links</h2>
        <p className="text-xs text-slate-500">Guests can only pick times inside these hours (and never when you are busy).{settings.availabilityIsDefault ? ' You have not set your own yet: Monday–Saturday 10:00–18:00 is used.' : ''}</p>
      </div>
      <div>
        <label className={labelCls} htmlFor="mtg-tz">Time zone</label>
        <select id="mtg-tz" className={`${inputCls} max-w-xs`} value={tz} onChange={e => setTz(e.target.value)}>
          {[...new Set([tz, ...TIMEZONES])].map(z => <option key={z} value={z}>{z}</option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        {rows.map((r, wd) => (
          <div key={wd} className="flex flex-wrap items-center gap-2 text-sm">
            <label className="w-32 inline-flex items-center gap-2"><input type="checkbox" checked={r.on} onChange={e => setRows(rows.map((x, j) => (j === wd ? { ...x, on: e.target.checked } : x)))} />{WEEKDAYS[wd]}</label>
            <input aria-label={`${WEEKDAYS[wd]} from`} type="time" disabled={!r.on} className={`${inputCls} w-28`} value={r.start} onChange={e => setRows(rows.map((x, j) => (j === wd ? { ...x, start: e.target.value } : x)))} />
            <span className="text-slate-400">to</span>
            <input aria-label={`${WEEKDAYS[wd]} until`} type="time" disabled={!r.on} className={`${inputCls} w-28`} value={r.end} onChange={e => setRows(rows.map((x, j) => (j === wd ? { ...x, end: e.target.value } : x)))} />
          </div>
        ))}
      </div>
      <button type="button" disabled={saving} className={btnPrimary} onClick={save}>{saving && <Loader2 className="w-4 h-4 animate-spin" />} Save hours</button>
    </section>
  );
};

const emptyLink = (isCeo: boolean): BookingLinkInput => ({
  id: null, slug: '', title: isCeo ? 'Meeting with the CEO' : 'Meeting', description: null, kind: isCeo ? 'CEO_MEETING' : 'APPOINTMENT', durationMinutes: 30, bufferMinutes: 10,
  minNoticeMinutes: 240, maxDaysAhead: 30, mode: 'GOOGLE_MEET', location: null, requiresApproval: isCeo, isActive: true
});

const BookingLinks: React.FC<{ settings: MeetingSettings; onChanged: (l: MeetingBookingLink) => void; onFlash: (f: { tone: 'ok' | 'warn' | 'error'; text: string }) => void }> = ({
  settings, onChanged, onFlash
}) => {
  const [edit, setEdit] = useState<BookingLinkInput | null>(null);
  const [saving, setSaving] = useState(false);
  const urlOf = (slug: string) => `${window.location.origin}/book/${slug}`;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    setSaving(true);
    try {
      const l = await meetingsApi.saveBookingLink(edit);
      onChanged(l);
      setEdit(null);
      onFlash({ tone: 'ok', text: `Booking link saved: ${urlOf(l.slug)}` });
    } catch (err) {
      onFlash({ tone: 'error', text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };
  const copy = async (slug: string) => {
    try {
      await navigator.clipboard.writeText(urlOf(slug));
      onFlash({ tone: 'ok', text: 'Link copied. Share it with customers, leads or candidates.' });
    } catch {
      onFlash({ tone: 'warn', text: urlOf(slug) });
    }
  };
  const num = (k: keyof BookingLinkInput) => (e: React.ChangeEvent<HTMLInputElement>) => edit && setEdit({ ...edit, [k]: Number(e.target.value) });
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Link2 className="w-4 h-4 text-indigo-600" /> Booking links</h2>
          <p className="text-xs text-slate-500">Share a link; customers, leads or candidates pick one of your free slots and get a confirmation{settings.isCeo ? ' (requests for your time always wait for your approval)' : ''}.</p>
        </div>
        {!edit && <button type="button" className={btnGhost} onClick={() => setEdit(emptyLink(settings.isCeo))}><Plus className="w-4 h-4" /> New link</button>}
      </div>
      {!settings.bookingTypes.length && !edit && <p className="text-sm text-slate-500">No booking links yet.</p>}
      <ul className="space-y-2">
        {settings.bookingTypes.map(l => (
          <li key={l.id} className={`rounded-lg border p-3 flex flex-wrap items-center gap-3 ${l.isActive ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-70'}`}>
            <div className="flex-1 min-w-[200px]">
              <p className="font-semibold text-slate-900">{l.title} <span className="text-xs font-normal text-slate-500">· {l.durationMinutes} min · {MODE_LABEL[l.mode]}{l.requiresApproval ? ' · needs approval' : ''}{l.isActive ? '' : ' · switched off'}</span></p>
              <p className="text-xs text-indigo-700 break-all">{urlOf(l.slug)}</p>
            </div>
            <button type="button" className={btnGhost} onClick={() => copy(l.slug)}><Copy className="w-4 h-4" /> Copy</button>
            <a className={btnGhost} href={urlOf(l.slug)} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4" /> Open</a>
            <button type="button" className={btnGhost} onClick={() => setEdit({ ...l })}><Settings2 className="w-4 h-4" /> Edit</button>
          </li>
        ))}
      </ul>
      {edit && (
        <form onSubmit={save} className="rounded-lg border border-indigo-200 bg-indigo-50/30 p-3 grid gap-3 sm:grid-cols-2 text-sm">
          <div><label className={labelCls} htmlFor="bl-title">Title</label><input id="bl-title" required minLength={2} maxLength={120} className={inputCls} value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} /></div>
          <div>
            <label className={labelCls} htmlFor="bl-slug">Link name</label>
            <input id="bl-slug" required pattern="[a-z0-9][a-z0-9\-]{2,62}[a-z0-9]" className={inputCls} value={edit.slug}
              onChange={e => setEdit({ ...edit, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} placeholder="e.g. ravi-product-demo" />
            <p className="text-[11px] text-slate-500 mt-0.5 break-all">{urlOf(edit.slug || '…')}</p>
          </div>
          {!settings.isCeo && (
            <div><label className={labelCls} htmlFor="bl-kind">Type</label>
              <select id="bl-kind" className={inputCls} value={edit.kind} onChange={e => setEdit({ ...edit, kind: e.target.value as BookingLinkInput['kind'] })}>
                {KIND_OPTIONS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </div>
          )}
          <div><label className={labelCls} htmlFor="bl-mode">How</label>
            <select id="bl-mode" className={inputCls} value={edit.mode} onChange={e => setEdit({ ...edit, mode: e.target.value as BookingLinkInput['mode'] })}>
              <option value="GOOGLE_MEET">Google Meet</option><option value="IN_PERSON">In person</option><option value="PHONE">Phone call</option>
            </select>
          </div>
          {edit.mode !== 'GOOGLE_MEET' && <div className="sm:col-span-2"><label className={labelCls} htmlFor="bl-loc">{edit.mode === 'PHONE' ? 'Who calls whom' : 'Address'}</label><input id="bl-loc" maxLength={300} className={inputCls} value={edit.location ?? ''} onChange={e => setEdit({ ...edit, location: e.target.value || null })} /></div>}
          <div><label className={labelCls} htmlFor="bl-dur">Length (minutes)</label><input id="bl-dur" type="number" min={10} max={480} required className={inputCls} value={edit.durationMinutes} onChange={num('durationMinutes')} /></div>
          <div><label className={labelCls} htmlFor="bl-buf">Gap between meetings (minutes)</label><input id="bl-buf" type="number" min={0} max={120} className={inputCls} value={edit.bufferMinutes} onChange={num('bufferMinutes')} /></div>
          <div><label className={labelCls} htmlFor="bl-notice">Earliest booking (minutes from now)</label><input id="bl-notice" type="number" min={0} max={20160} className={inputCls} value={edit.minNoticeMinutes} onChange={num('minNoticeMinutes')} /></div>
          <div><label className={labelCls} htmlFor="bl-days">Bookable up to (days ahead)</label><input id="bl-days" type="number" min={1} max={180} className={inputCls} value={edit.maxDaysAhead} onChange={num('maxDaysAhead')} /></div>
          <div className="sm:col-span-2"><label className={labelCls} htmlFor="bl-desc">Shown on the booking page</label><textarea id="bl-desc" rows={2} maxLength={2000} className={inputCls} value={edit.description ?? ''} onChange={e => setEdit({ ...edit, description: e.target.value || null })} /></div>
          <label className="inline-flex items-center gap-2"><input type="checkbox" disabled={settings.isCeo} checked={edit.requiresApproval || settings.isCeo} onChange={e => setEdit({ ...edit, requiresApproval: e.target.checked })} /> I approve each booking first</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={edit.isActive} onChange={e => setEdit({ ...edit, isActive: e.target.checked })} /> Link is on</label>
          <div className="sm:col-span-2 flex gap-2">
            <button type="submit" disabled={saving} className={btnPrimary}>{saving && <Loader2 className="w-4 h-4 animate-spin" />} Save link</button>
            <button type="button" className={btnGhost} onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
};

const Delegates: React.FC<{ settings: MeetingSettings; onSaved: (s: MeetingSettings) => void; onError: (t: string) => void }> = ({ settings, onSaved, onError }) => {
  const [people, setPeople] = useState<MeetingDirectoryEntry[]>([]);
  const [chosen, setChosen] = useState<string[]>(settings.delegates.map(d => d.id));
  const [saving, setSaving] = useState(false);
  useEffect(() => { meetingsApi.directory().then(p => setPeople(p.filter(x => !x.isCeo))).catch(() => setPeople([])); }, []);
  const save = async () => {
    setSaving(true);
    try {
      onSaved(await meetingsApi.setDelegates(chosen));
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Crown className="w-4 h-4 text-amber-500" /> Who may approve requests for your time</h2>
        <p className="text-xs text-slate-500">An assistant you name here sees your meetings, approves or declines requests, proposes other times, and can book your time directly.</p>
      </div>
      <select multiple aria-label="Delegates" className={`${inputCls} h-40`} value={chosen} onChange={e => setChosen(Array.from(e.target.selectedOptions).map(o => o.value))}>
        {people.map(p => <option key={p.id} value={p.id}>{p.name} — {p.department ?? p.role}</option>)}
      </select>
      <p className="text-[11px] text-slate-500">Hold Ctrl (Cmd on a Mac) to choose more than one. At most 10.</p>
      <button type="button" disabled={saving || chosen.length > 10} className={btnPrimary} onClick={save}>{saving && <Loader2 className="w-4 h-4 animate-spin" />} Save delegates</button>
    </section>
  );
};
