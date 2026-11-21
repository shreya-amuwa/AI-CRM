import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Briefcase, CheckCircle2, Loader2, MailWarning, RefreshCw, Send, XCircle } from 'lucide-react';
import type { ClientMeetingResult, Meeting, MeetingDirectoryEntry, MeetingMail } from '../../../shared/contracts';
import { clientMeetingSchema } from '../../../shared/validation';
import { errorMessage } from '../../lib/api/client';
import { meetingsApi } from '../../lib/api/meetings';
import { SideDrawer } from '../common/SideDrawer';

/**
 * Client Meeting (migration 20270122000200): a meeting with a client outside the company, on the existing meetings system.
 *  - The form is checked with the same schema as the server (shared/validation.ts clientMeetingSchema); the database checks it again.
 *  - The invitation, the new-time and the cancellation e-mails to the client are sent by the server through the meeting e-mail outbox (never
 *    from the browser), once per meeting version, retried when they fail; MeetingMailLog shows how each one went and sends a failed one again.
 */
const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
const labelCls = 'block text-xs font-semibold text-slate-600 mb-1';
const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50';
const btnPrimary = `${btn} bg-indigo-600 text-white hover:bg-indigo-700`;
const btnGhost = `${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
const BROWSER_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'; } catch { return 'Asia/Kolkata'; } })();
const pad = (n: number) => String(n).padStart(2, '0');
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const when = (s: string, e: string) => `${new Date(s).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${
  new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${new Date(e).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `cm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

/** Scheduled / Rescheduled / Completed / Cancelled, as the client-meeting screens name them. */
export function clientStatus(m: Pick<Meeting, 'status' | 'rescheduleCount'>): { label: string; cls: string } {
  if (m.status === 'CANCELLED') return { label: 'Cancelled', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  if (m.status === 'COMPLETED') return { label: 'Completed', cls: 'bg-sky-50 text-sky-800 border-sky-200' };
  if (m.rescheduleCount > 0) return { label: 'Rescheduled', cls: 'bg-violet-50 text-violet-800 border-violet-200' };
  return { label: 'Scheduled', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------
interface Form {
  clientName: string; clientEmail: string; companyName: string; title: string; agenda: string;
  date: string; start: string; end: string; mode: 'ONLINE' | 'OFFLINE'; meetLink: string; location: string; hostId: string;
}
const EMPTY: Form = { clientName: '', clientEmail: '', companyName: '', title: '', agenda: '', date: '', start: '', end: '', mode: 'ONLINE', meetLink: '', location: '', hostId: '' };

export const ClientMeetingComposer: React.FC<{ onClose: () => void; onSaved: (m: ClientMeetingResult) => void }> = ({ onClose, onSaved }) => {
  const [f, setF] = useState<Form>(EMPTY);
  const [people, setPeople] = useState<MeetingDirectoryEntry[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // one id per filled-in form: sending it twice (a double click, a retry) gives the first meeting back, never a second one or a second e-mail
  const key = useRef(newKey());
  useEffect(() => { meetingsApi.directory().then(setPeople).catch(() => setPeople([])); }, []);
  // the CEO's time is asked for, not booked: the Super Admin is not offered as a host
  const hosts = useMemo(() => people.filter(p => !p.isCeo), [people]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(x => ({ ...x, [k]: v }));

  const payload = () => {
    const startsAt = f.date && f.start ? new Date(`${f.date}T${f.start}`).toISOString() : '';
    const endsAt = f.date && f.end ? new Date(`${f.date}T${f.end}`).toISOString() : '';
    return {
      clientName: f.clientName, clientEmail: f.clientEmail, companyName: f.companyName, title: f.title, agenda: f.agenda, startsAt, endsAt, timezone: BROWSER_TZ,
      mode: f.mode, meetLink: f.mode === 'ONLINE' ? f.meetLink : null, location: f.mode === 'OFFLINE' ? f.location : null,
      hostId: f.hostId || null, clientRequestId: key.current
    };
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const body = payload();
    const checked = clientMeetingSchema.safeParse(body);
    const errs: Record<string, string> = {};
    if (!f.date) errs.date = 'Choose the meeting date.';
    if (!f.start) errs.start = 'Choose the start time.';
    if (!f.end) errs.end = 'Choose the end time.';
    if (!checked.success) for (const i of checked.error.issues) { const k = String(i.path[0] ?? ''); if (k && !errs[k]) errs[k === 'startsAt' ? 'start' : k === 'endsAt' ? 'end' : k] = i.message; }
    if (body.startsAt && new Date(body.startsAt).getTime() < Date.now() - 5 * 60_000) errs.start = 'Pick a time in the future.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      onSaved(await meetingsApi.createClient(body as never));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const field = (id: keyof Form | 'start' | 'end', label: string, input: React.ReactNode) => (
    <div>
      <label className={labelCls} htmlFor={`cm-${id}`}>{label}</label>
      {input}
      {errors[id] && <p className="mt-1 text-xs text-rose-700" id={`cm-${id}-err`}>{errors[id]}</p>}
    </div>
  );
  const inp = (id: keyof Form, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={`cm-${id}`} className={inputCls} value={f[id]} onChange={e => set(id, e.target.value as never)} aria-invalid={!!errors[id]}
      aria-describedby={errors[id] ? `cm-${id}-err` : undefined} {...props} />
  );

  return (
    <SideDrawer title="Client meeting" subtitle="The client receives a meeting invitation by e-mail from the CRM." onClose={onClose}>
      <form onSubmit={submit} noValidate className="p-5 space-y-4 text-sm" data-testid="client-meeting-form">
        {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
        <fieldset className="space-y-3">
          <legend className="text-xs font-bold uppercase text-slate-500 mb-1">Client</legend>
          {field('clientName', 'Client name', inp('clientName', { maxLength: 200, autoComplete: 'off' }))}
          {field('clientEmail', 'Client e-mail address', inp('clientEmail', { type: 'email', maxLength: 320, autoComplete: 'off' }))}
          {field('companyName', 'Company name', inp('companyName', { maxLength: 200 }))}
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-xs font-bold uppercase text-slate-500 mb-1">Meeting</legend>
          {field('title', 'Meeting title', inp('title', { maxLength: 200, placeholder: 'e.g. AI CRM walkthrough' }))}
          {field('agenda', 'Meeting agenda', (
            <textarea id="cm-agenda" rows={4} maxLength={4000} className={inputCls} value={f.agenda} onChange={e => set('agenda', e.target.value)} aria-invalid={!!errors.agenda} />
          ))}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {field('date', 'Meeting date', inp('date', { type: 'date', min: todayKey() }))}
            {field('start', 'Start time', <input id="cm-start" type="time" className={inputCls} value={f.start} onChange={e => set('start', e.target.value)} aria-invalid={!!errors.start} />)}
            {field('end', 'End time', <input id="cm-end" type="time" className={inputCls} value={f.end} onChange={e => set('end', e.target.value)} aria-invalid={!!errors.end} />)}
          </div>
          <div role="radiogroup" aria-label="Meeting mode" className="flex gap-2">
            {(['ONLINE', 'OFFLINE'] as const).map(mo => (
              <label key={mo} className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-center font-semibold ${f.mode === mo ? 'border-indigo-600 bg-indigo-50 text-indigo-800' : 'border-slate-300 text-slate-600'}`}>
                <input type="radio" name="cm-mode" className="sr-only" checked={f.mode === mo} onChange={() => set('mode', mo)} /> {mo === 'ONLINE' ? 'Online' : 'Offline'}
              </label>
            ))}
          </div>
          {f.mode === 'ONLINE'
            ? field('meetLink', 'Meeting link', inp('meetLink', { type: 'url', maxLength: 500, placeholder: 'https://meet.google.com/…' }))
            : field('location', 'Physical meeting location', inp('location', { maxLength: 500, placeholder: 'Office address' }))}
          {field('hostId', 'Assigned employee / meeting host', (
            <select id="cm-hostId" className={inputCls} value={f.hostId} onChange={e => set('hostId', e.target.value)}>
              <option value="">Me (the one creating it)</option>
              {hosts.map(p => <option key={p.id} value={p.id}>{p.name}{p.department ? ` · ${p.department}` : ''}</option>)}
            </select>
          ))}
        </fieldset>
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={saving} className={`${btnPrimary} flex-1`}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Create and send the invitation
          </button>
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </SideDrawer>
  );
};

// ---------------------------------------------------------------------------
// E-mail delivery of a meeting (shown in its details to the host and the one who booked it)
// ---------------------------------------------------------------------------
const MAIL_KIND: Record<string, string> = { CONFIRMED: 'Invitation', RESCHEDULED: 'New time', CANCELLED: 'Cancellation', REMINDER_24H: 'Reminder (24 h)', REMINDER_1H: 'Reminder (1 h)',
  DECLINED: 'Declined', PROPOSED: 'Another time proposed', REQUEST_RECEIVED: 'Request received' };

export const MeetingMailLog: React.FC<{ meetingId: string; version: number }> = ({ meetingId, version }) => {
  const [mails, setMails] = useState<MeetingMail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(() => {
    meetingsApi.mails(meetingId).then(m => { setMails(m); setError(null); }, e => setError(errorMessage(e)));
  }, [meetingId]);
  useEffect(load, [load, version]);
  // while an e-mail is on its way, look again shortly (the server's worker sends it within seconds)
  useEffect(() => {
    if (!mails?.some(m => m.external && (m.status === 'PENDING' || m.status === 'SENDING'))) return;
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, [mails, load]);

  const retry = async (id: number) => {
    setBusy(id);
    try { await meetingsApi.retryMail(id); load(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  };
  const client = (mails ?? []).filter(m => m.external);
  return (
    <section aria-label="E-mails to the client" data-testid="mail-log">
      <h3 className="text-xs font-bold text-slate-500 uppercase mb-1.5 flex items-center gap-2">E-mails to the client
        <button type="button" className="text-indigo-700 normal-case font-semibold inline-flex items-center gap-1" onClick={load}><RefreshCw className="w-3 h-3" /> Refresh</button></h3>
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
      {!mails && !error && <p className="text-xs text-slate-500">Loading…</p>}
      {mails && !client.length && <p className="text-xs text-slate-500">No e-mail to the client yet.</p>}
      <ul className="space-y-1.5">
        {client.map(m => (
          <li key={m.id} className="rounded-lg border border-slate-200 px-3 py-2 text-xs" data-testid="mail-row" data-status={m.status}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-800">{MAIL_KIND[m.kind] ?? m.kind} → {m.toEmail}</span>
              {m.status === 'SENT' ? <span className="inline-flex items-center gap-1 font-bold text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> Sent</span>
                : m.status === 'PENDING' || m.status === 'SENDING' ? <span className="inline-flex items-center gap-1 font-bold text-amber-700"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</span>
                : <span className="inline-flex items-center gap-1 font-bold text-rose-700">{m.status === 'FAILED' ? <MailWarning className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />} {m.status === 'FAILED' ? 'Failed' : 'Not sent'}</span>}
            </div>
            <div className="mt-0.5 text-slate-500">
              {m.sentAt ? `Sent ${new Date(m.sentAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : `Queued ${new Date(m.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`}
              {m.attempts > 0 && ` · ${m.attempts} attempt${m.attempts === 1 ? '' : 's'}`}
              {m.lastError && m.status !== 'SENT' && <span className="block text-rose-700">Why: {m.lastError}</span>}
              {m.superseded && m.status !== 'SENT' && <span className="block text-slate-500">Replaced by a newer e-mail.</span>}
            </div>
            {(m.status === 'FAILED' || m.status === 'SKIPPED') && !m.superseded && (
              <button type="button" disabled={busy === m.id} className={`${btnGhost} mt-1.5 !py-1 !text-xs`} onClick={() => retry(m.id)}>
                {busy === m.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Send again
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};

// ---------------------------------------------------------------------------
// The client meetings a person takes part in
// ---------------------------------------------------------------------------
export const ClientMeetingsTab: React.FC<{ reloadKey: number; onOpen: (id: string) => void }> = ({ reloadKey, onOpen }) => {
  const [scope, setScope] = useState<'UPCOMING' | 'PAST'>('UPCOMING');
  const [status, setStatus] = useState('');
  const [list, setList] = useState<ClientMeetingResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    meetingsApi.clientMeetings({ scope, status: status || undefined }).then(setList, e => { setError(errorMessage(e)); setList([]); });
  }, [scope, status, reloadKey]);
  return (
    <section className="space-y-3" aria-label="Client meetings" data-testid="client-meetings">
      <div className="flex flex-wrap items-center gap-2">
        {(['UPCOMING', 'PAST'] as const).map(s => (
          <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${scope === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300'}`}>{s === 'UPCOMING' ? 'Upcoming' : 'Past'}</button>
        ))}
        <select aria-label="Status" className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Any status</option><option value="SCHEDULED">Scheduled</option><option value="RESCHEDULED">Rescheduled</option>
          <option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option>
        </select>
      </div>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {!list && !error && <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}
      {list && !list.length && !error && <p className="text-sm text-slate-500">No client meetings {scope === 'UPCOMING' ? 'coming up' : 'in the past'}{status ? ' with this status' : ''}.</p>}
      <ul className="space-y-2">
        {(list ?? []).map(m => {
          const st = clientStatus(m);
          return (
            <li key={m.id}>
              <button type="button" onClick={() => onOpen(m.id)} className="w-full text-left rounded-xl border border-slate-200 bg-white p-3 hover:border-indigo-300" data-testid="client-meeting-row">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 flex items-center gap-1.5"><Briefcase className="w-4 h-4 text-indigo-600" />{m.title}</span>
                  <span className={`text-xs font-semibold border rounded-full px-2 py-0.5 ${st.cls}`}>{st.label}</span>
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {when(m.startsAt, m.endsAt)} · {m.clientCompany ?? ''}{m.client?.name ? ` · ${m.client.name}` : ''} · {m.mode === 'IN_PERSON' ? 'Offline' : 'Online'} · Host {m.hostName}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
