import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Eye, List, Plus } from 'lucide-react';
import type { BaDemo, DemoStatus } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { businessAssociateApi } from '../../lib/api/endpoints';
import { incomeApi } from '../../lib/income';
import { useAuth } from '../../context/AuthContext';
import { PageTitle } from '../layout/shell';
import { Card, Tabs } from '../tasks/head/headParts';
import { Avatar, Dialog, ErrorBanner, Field, Spinner } from '../team-member/pipeline/shared';
import { EmptyState, dateText, tcBtn, tcInput } from '../telecaller/ui';
import type { BaNavigate } from './BusinessAssociateDashboard';
import { notifyBaChanged, toIsoDate, useContactOptions } from './ui';

type Tab = 'UPCOMING' | 'COMPLETED' | 'CANCELLED' | 'RESCHEDULED' | 'ALL';
const TABS: { id: Tab; label: string }[] = [
  { id: 'UPCOMING', label: 'Upcoming Demos' }, { id: 'COMPLETED', label: 'Completed Demos' }, { id: 'CANCELLED', label: 'Cancelled Demos' }, { id: 'RESCHEDULED', label: 'Rescheduled Demos' }, { id: 'ALL', label: 'All' }
];
const STATUS_STYLE: Record<DemoStatus, string> = {
  SCHEDULED: 'bg-blue-50 text-blue-700 ring-blue-200', RESCHEDULED: 'bg-amber-50 text-amber-800 ring-amber-200', COMPLETED: 'bg-emerald-50 text-emerald-700 ring-emerald-200', CANCELLED: 'bg-slate-100 text-slate-600 ring-slate-200'
};
const STATUS_LABEL: Record<DemoStatus, string> = { SCHEDULED: 'Scheduled', RESCHEDULED: 'Rescheduled', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
const StatusBadge: React.FC<{ s: DemoStatus }> = ({ s }) => <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset ${STATUS_STYLE[s]}`}>{STATUS_LABEL[s]}</span>;
const timeText = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });
const dayKey = (iso: string) => toIsoDate(new Date(iso));
const hhmm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const live = (d: BaDemo) => d.status === 'SCHEDULED' || d.status === 'RESCHEDULED';

/** Demo Schedule: book, move, cancel and complete client demos. Invitations and reminders are NOT sent from here: the meeting is recorded in the CRM only. */
export const DemoSchedulePage: React.FC<{ go: BaNavigate; initialContactId?: string; openNew?: boolean }> = ({ initialContactId, openNew }) => {
  const [demos, setDemos] = useState<BaDemo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('UPCOMING');
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [form, setForm] = useState<{ demo?: BaDemo; date?: string; contactId?: string } | null>(openNew ? { contactId: initialContactId } : null);
  const [detail, setDetail] = useState<BaDemo | null>(null);
  const [finish, setFinish] = useState<{ demo: BaDemo; status: 'COMPLETED' | 'CANCELLED' } | null>(null);

  const load = useCallback(() => {
    setError(null);
    const from = new Date(Date.now() - 400 * 86400e3).toISOString();
    const to = new Date(Date.now() + 400 * 86400e3).toISOString();
    businessAssociateApi.demos({ from, to, contactId: initialContactId }).then(setDemos, err => (setError(errorMessage(err)), setDemos([])));
  }, [initialContactId]);
  useEffect(load, [load]);
  const say = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 4500); };
  const changed = (m: string) => { setForm(null); setDetail(null); setFinish(null); say(m); load(); notifyBaChanged(); };

  const shown = useMemo(() => {
    const now = Date.now();
    const all = demos ?? [];
    const f = all.filter(d => tab === 'ALL' || (tab === 'UPCOMING' ? live(d) && new Date(d.endsAt).getTime() >= now : tab === 'COMPLETED' ? d.status === 'COMPLETED' : tab === 'CANCELLED' ? d.status === 'CANCELLED' : d.status === 'RESCHEDULED' || d.rescheduleCount > 0));
    return f.sort((a, b) => (tab === 'UPCOMING' ? a.startsAt.localeCompare(b.startsAt) : b.startsAt.localeCompare(a.startsAt)));
  }, [demos, tab]);
  const count = (t: Tab) => (demos ?? []).filter(d => t === 'ALL' || (t === 'UPCOMING' ? live(d) && new Date(d.endsAt).getTime() >= Date.now() : t === 'COMPLETED' ? d.status === 'COMPLETED' : t === 'CANCELLED' ? d.status === 'CANCELLED' : d.status === 'RESCHEDULED' || d.rescheduleCount > 0)).length;

  return (
    <div className="space-y-5">
      <PageTitle title="Demo Schedule" subtitle="Client demonstrations: book them, move them, and record how they went." actions={<button type="button" className={tcBtn.primary} onClick={() => setForm({ contactId: initialContactId })}><Plus className="w-4 h-4" aria-hidden="true" /> Schedule demo</button>} />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {notice && <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">{notice}</div>}
      <p className="text-xs text-slate-500">Meetings are recorded here. This page does not send invitations, create video meetings or send reminders; share the link with the client yourself.</p>

      <Card>
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100">
          <div className="flex-1 min-w-0"><Tabs label="Demos" value={tab} onChange={v => setTab(v as Tab)} options={TABS.map(t => ({ id: t.id as string, label: t.label, count: count(t.id) }))} /></div>
          <div className="inline-flex rounded-xl border border-slate-200 overflow-hidden" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={`px-3 py-2 text-xs font-bold inline-flex items-center gap-1 ${view === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}><List className="w-4 h-4" aria-hidden="true" /> List</button>
            <button type="button" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')} className={`px-3 py-2 text-xs font-bold inline-flex items-center gap-1 ${view === 'calendar' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}><CalendarClock className="w-4 h-4" aria-hidden="true" /> Calendar</button>
          </div>
        </div>

        {demos === null ? <Spinner label="Loading demos…" /> : view === 'list' ? (
          shown.length === 0 ? <EmptyState title={tab === 'UPCOMING' ? 'No upcoming demo' : 'Nothing here'}>{tab === 'UPCOMING' ? 'Schedule a demo for one of your contacts.' : 'No demo matches this view.'}</EmptyState> : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[1000px]"><thead><tr className="text-left text-[11px] text-slate-500 bg-slate-50/60">{['Client', 'Company', 'Demo', 'Date', 'Time', 'Mode', 'Assigned to', 'Status', 'Actions'].map(h => <th key={h} scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">{shown.map(d => (
                    <tr key={d.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3"><div className="flex items-center gap-3"><Avatar name={d.client || d.title} /><span className="font-semibold text-slate-900 text-[13px] whitespace-nowrap">{d.client}</span></div></td><td className="px-4 py-3 text-slate-600">{d.company || '-'}</td><td className="px-4 py-3">{d.title}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{dateText(d.startsAt)}</td><td className="px-4 py-3 whitespace-nowrap">{timeText(d.startsAt)} – {timeText(d.endsAt)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{d.mode === 'ONLINE' ? 'Online' : 'In person'}</td><td className="px-4 py-3 whitespace-nowrap">{d.assignee || '-'}</td>
                      <td className="px-4 py-3"><StatusBadge s={d.status} /></td>
                      <td className="px-4 py-3"><button type="button" className={tcBtn.row} onClick={() => setDetail(d)} aria-label={`Open the demo ${d.title} for ${d.client}`}><Eye className="w-3.5 h-3.5" aria-hidden="true" /> Open</button></td>
                    </tr>))}</tbody></table>
              </div>
              <ul className="md:hidden divide-y divide-slate-100">{shown.map(d => (
                <li key={d.id} className="p-4 space-y-1.5">
                  <div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-slate-900">{d.title}</div><div className="text-xs text-slate-500">{d.client}{d.company ? ` · ${d.company}` : ''}</div></div><StatusBadge s={d.status} /></div>
                  <div className="text-xs text-slate-500">{dateText(d.startsAt)} · {timeText(d.startsAt)} – {timeText(d.endsAt)} · {d.mode === 'ONLINE' ? 'Online' : 'In person'}</div>
                  <button type="button" className={tcBtn.secondary} onClick={() => setDetail(d)}>Open</button>
                </li>))}</ul>
            </>
          )
        ) : (
          <CalendarView month={month} setMonth={setMonth} demos={(tab === 'ALL' ? demos : shown)} onOpen={setDetail} onDay={date => setForm({ date, contactId: initialContactId })} />
        )}
      </Card>

      {form && <DemoForm demo={form.demo} date={form.date} contactId={form.contactId} onClose={() => setForm(null)} onSaved={(d, created) => changed(created ? `The demo with ${d.client} is scheduled.` : d.status === 'RESCHEDULED' ? 'The demo was rescheduled.' : 'The demo was updated.')} />}
      {detail && !form && !finish && <DemoDetail demo={detail} onClose={() => setDetail(null)} onEdit={() => { setForm({ demo: detail }); }} onFinish={status => setFinish({ demo: detail, status })} onAuthorised={d => { setDetail(d); setDemos(list => list && list.map(x => (x.id === d.id ? d : x))); }} />}
      {finish && <FinishDialog demo={finish.demo} status={finish.status} onClose={() => setFinish(null)} onDone={d => changed(`The demo was marked ${STATUS_LABEL[d.status].toLowerCase()}.`)} />}
    </div>
  );
};

const CalendarView: React.FC<{ month: Date; setMonth: (d: Date) => void; demos: BaDemo[]; onOpen: (d: BaDemo) => void; onDay: (date: string) => void }> = ({ month, setMonth, demos, onOpen, onDay }) => {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7)); // weeks start on Monday
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const byDay = new Map<string, BaDemo[]>();
  demos.forEach(d => { const k = dayKey(d.startsAt); byDay.set(k, [...(byDay.get(k) ?? []), d]); });
  const today = toIsoDate(new Date());
  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <button type="button" className={tcBtn.secondary} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft className="w-4 h-4" aria-hidden="true" /></button>
        <h2 className="text-base font-extrabold text-slate-900" aria-live="polite">{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h2>
        <button type="button" className={tcBtn.secondary} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight className="w-4 h-4" aria-hidden="true" /></button>
      </div>
      <div className="grid grid-cols-7 text-xs font-medium text-slate-500 mb-1">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="px-1 py-1">{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-px bg-slate-200 rounded-xl overflow-hidden border border-slate-200">
        {days.map(d => {
          const k = toIsoDate(d);
          const list = byDay.get(k) ?? [];
          const inMonth = d.getMonth() === month.getMonth();
          return (
            <div key={k} className={`min-h-[78px] sm:min-h-[96px] p-1 ${inMonth ? 'bg-white' : 'bg-slate-50'} ${k === today ? 'ring-2 ring-inset ring-blue-400' : ''}`}>
              <button type="button" onClick={() => onDay(k)} className={`text-xs font-bold rounded px-1 hover:bg-blue-50 ${inMonth ? 'text-slate-700' : 'text-slate-300'}`} aria-label={`Schedule a demo on ${d.toDateString()}`}>{d.getDate()}</button>
              <div className="space-y-0.5 mt-0.5">
                {list.slice(0, 3).map(x => (
                  <button key={x.id} type="button" onClick={() => onOpen(x)} className={`w-full text-left truncate rounded px-1 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${STATUS_STYLE[x.status]}`} title={`${x.title} · ${x.client}`}>{timeText(x.startsAt)} {x.client}</button>
                ))}
                {list.length > 3 && <div className="text-[10px] text-slate-500 px-1">+{list.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const DemoDetail: React.FC<{ demo: BaDemo; onClose: () => void; onEdit: () => void; onFinish: (s: 'COMPLETED' | 'CANCELLED') => void; onAuthorised: (d: BaDemo) => void }> = ({ demo: d, onClose, onEdit, onFinish, onAuthorised }) => (
  <Dialog title={d.title} description={`${d.client}${d.company ? ` · ${d.company}` : ''}`} onClose={onClose}>
    <div className="flex items-center gap-2"><StatusBadge s={d.status} />{d.rescheduleCount > 0 && <span className="text-xs text-slate-500">Rescheduled {d.rescheduleCount}×</span>}</div>
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
      {([['Date', dateText(d.startsAt)], ['Time', `${timeText(d.startsAt)} – ${timeText(d.endsAt)}`], ['Mode', d.mode === 'ONLINE' ? 'Online' : 'In person'], [d.mode === 'ONLINE' ? 'Platform' : 'Location', d.location], ['Assigned to', d.assignee], ['Description', d.description], ['Internal notes', d.internalNotes], ['Feedback', d.feedback], ['Follow-up notes', d.followUpNotes]] as [string, string | null][]).map(([k, v]) => (
        <div key={k}><dt className="text-xs font-medium text-slate-500">{k}</dt><dd className="text-slate-800 whitespace-pre-wrap break-words">{v || '-'}</dd></div>
      ))}
      {d.meetingLink && <div className="sm:col-span-2"><dt className="text-xs font-medium text-slate-500">Meeting link</dt><dd><a href={d.meetingLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">{d.meetingLink}</a></dd></div>}
    </dl>
    {d.status === 'COMPLETED' && <AuthorisedTick demo={d} onChanged={onAuthorised} />}
    <div className="flex flex-wrap justify-end gap-2 pt-1">
      <button type="button" className={tcBtn.secondary} onClick={onClose}>Close</button>
      {live(d) && <>
        <button type="button" className={tcBtn.secondary} onClick={() => onFinish('CANCELLED')}>Cancel demo</button>
        <button type="button" className={tcBtn.secondary} onClick={onEdit}>Edit / Reschedule</button>
        <button type="button" className={tcBtn.primary} onClick={() => onFinish('COMPLETED')}>Mark completed</button>
      </>}
    </div>
  </Dialog>
);

/** "The client's authorised person attended": a completed demo earns its incentive only with this tick (20270119000100). */
const AuthorisedTick: React.FC<{ demo: BaDemo; onChanged: (d: BaDemo) => void }> = ({ demo, onChanged }) => {
  const [checked, setChecked] = useState(!!demo.authorisedPersonAttended);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const change = async (next: boolean) => {
    setSaving(true); setError(null); setChecked(next);
    try {
      const r = await incomeApi.setDemoAuthorised(demo.id, next);
      onChanged({ ...demo, authorisedPersonAttended: r.authorisedPersonAttended });
    } catch (err) { setChecked(!next); setError(errorMessage(err)); } finally { setSaving(false); }
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1">
      <label className="flex items-start gap-2 text-sm text-slate-800">
        <input type="checkbox" className="mt-0.5" checked={checked} disabled={saving} onChange={e => void change(e.target.checked)} />
        <span><span className="font-semibold">The client's authorised person attended</span><br /><span className="text-xs text-slate-500">The demo counts towards incentives only when the person who can decide was there.</span></span>
      </label>
      {error && <ErrorBanner message={error} />}
    </div>
  );
};

const FinishDialog: React.FC<{ demo: BaDemo; status: 'COMPLETED' | 'CANCELLED'; onClose: () => void; onDone: (d: BaDemo) => void }> = ({ demo, status, onClose, onDone }) => {
  const [feedback, setFeedback] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [authorised, setAuthorised] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true; setSaving(true); setError(null);
    let done: BaDemo;
    try { done = await businessAssociateApi.demoStatus(demo.id, status, feedback.trim() || null, followUp.trim() || null); } catch (err) { setError(errorMessage(err)); busy.current = false; setSaving(false); return; }
    // the tick is saved after the demo is completed; if it fails the demo stays completed and the tick can be set from the demo's details
    if (status === 'COMPLETED' && authorised) {
      try { done = { ...done, authorisedPersonAttended: (await incomeApi.setDemoAuthorised(demo.id, true)).authorisedPersonAttended }; } catch { /* shown as not ticked */ }
    }
    onDone(done);
  };
  return (
    <Dialog title={status === 'COMPLETED' ? `Mark the demo completed` : `Cancel the demo`} description={`${demo.title} · ${demo.client}`} onClose={onClose} persistent>
      <form onSubmit={submit} className="space-y-3">
        <Field label={status === 'COMPLETED' ? 'Demo feedback' : 'Reason (optional)'} htmlFor="dm-fb"><textarea id="dm-fb" className={`${tcInput} min-h-[84px]`} maxLength={3000} value={feedback} onChange={e => setFeedback(e.target.value)} /></Field>
        <Field label="Follow-up notes" htmlFor="dm-fu"><textarea id="dm-fu" className={`${tcInput} min-h-[70px]`} maxLength={3000} value={followUp} onChange={e => setFollowUp(e.target.value)} /></Field>
        {status === 'COMPLETED' && (
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input type="checkbox" className="mt-0.5" checked={authorised} onChange={e => setAuthorised(e.target.checked)} />
            <span><span className="font-semibold">The client's authorised person attended</span><br /><span className="text-xs text-slate-500">The demo counts towards incentives only when the person who can decide was there.</span></span>
          </label>
        )}
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className={tcBtn.secondary} onClick={onClose} disabled={saving}>Back</button><button type="submit" className={tcBtn.primary} disabled={saving}>{saving ? 'Saving…' : status === 'COMPLETED' ? 'Mark completed' : 'Cancel the demo'}</button></div>
      </form>
    </Dialog>
  );
};

const DemoForm: React.FC<{ demo?: BaDemo; date?: string; contactId?: string; onClose: () => void; onSaved: (d: BaDemo, created: boolean) => void }> = ({ demo, date, contactId, onClose, onSaved }) => {
  const { profile } = useAuth();
  const contacts = useContactOptions();
  const [f, setF] = useState(() => ({
    contactId: demo?.contactId ?? contactId ?? '', title: demo?.title ?? 'Product demo', description: demo?.description ?? '', date: demo ? toIsoDate(new Date(demo.startsAt)) : date ?? '',
    start: demo ? hhmm(demo.startsAt) : '', end: demo ? hhmm(demo.endsAt) : '', mode: (demo?.mode ?? 'ONLINE') as 'ONLINE' | 'IN_PERSON', location: demo?.location ?? '', meetingLink: demo?.meetingLink ?? '', internalNotes: demo?.internalNotes ?? ''
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }));
  const rescheduling = !!demo && live(demo);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return; // a double click must not book twice
    const found: Record<string, string> = {};
    if (!demo && !f.contactId) found.contactId = 'Select the client.';
    if (!f.title.trim()) found.title = 'Enter the demo title.';
    if (!f.date) found.date = 'Choose the date.';
    if (!f.start) found.start = 'Choose the start time.';
    if (!f.end) found.end = 'Choose the end time.';
    const starts = f.date && f.start ? new Date(`${f.date}T${f.start}`) : null;
    const ends = f.date && f.end ? new Date(`${f.date}T${f.end}`) : null;
    if (starts && ends && ends <= starts) found.end = 'The end time must be after the start time.';
    if (starts && (!demo || starts.toISOString() !== demo.startsAt) && starts.getTime() < Date.now() - 5 * 60e3) found.date = 'Choose a time that has not passed yet.';
    if (f.mode === 'IN_PERSON' && !f.location.trim()) found.location = 'Enter where the demo takes place.';
    if (f.mode === 'ONLINE' && !f.location.trim() && !f.meetingLink.trim()) found.location = 'Enter the meeting platform or the link.';
    if (f.meetingLink.trim() && !/^https?:\/\//i.test(f.meetingLink.trim())) found.meetingLink = 'The link must start with http:// or https://.';
    setErrors(found);
    if (Object.keys(found).length > 0 || !starts || !ends) return;
    busy.current = true; setSaving(true); setError(null);
    try {
      const body = { title: f.title.trim(), description: f.description.trim() || null, startsAt: starts.toISOString(), endsAt: ends.toISOString(), mode: f.mode, location: f.location.trim() || null, meetingLink: f.mode === 'ONLINE' ? f.meetingLink.trim() || null : null, internalNotes: f.internalNotes.trim() || null };
      onSaved(demo ? await businessAssociateApi.updateDemo(demo.id, body) : await businessAssociateApi.createDemo(f.contactId, body), !demo);
    } catch (err) { setError(errorMessage(err)); busy.current = false; setSaving(false); }
  };

  return (
    <Dialog title={demo ? (rescheduling ? 'Edit or reschedule the demo' : 'Demo') : 'Schedule a demo'} description="Fields marked * are required." onClose={onClose} wide persistent>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Client / contact" htmlFor="dm-contact" required error={errors.contactId}>
            <select id="dm-contact" className={tcInput} disabled={!!demo} value={f.contactId} onChange={e => set('contactId', e.target.value)}>
              <option value="">{contacts.items === null ? 'Loading…' : 'Choose a contact…'}</option>
              {(contacts.items ?? []).map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Company" htmlFor="dm-company"><input id="dm-company" className={`${tcInput} bg-slate-50`} readOnly value={demo?.company ?? contacts.items?.find(c => c.id === f.contactId)?.company ?? ''} /></Field>
          <Field label="Demo title" htmlFor="dm-title" required error={errors.title}><input id="dm-title" className={tcInput} maxLength={200} value={f.title} onChange={e => set('title', e.target.value)} /></Field>
          <Field label="Assigned Business Associate" htmlFor="dm-ba"><input id="dm-ba" className={`${tcInput} bg-slate-50`} readOnly value={demo?.assignee ?? profile?.fullName ?? ''} /></Field>
          <div className="sm:col-span-2"><Field label="Demo description" htmlFor="dm-desc"><textarea id="dm-desc" className={`${tcInput} min-h-[70px]`} maxLength={3000} value={f.description} onChange={e => set('description', e.target.value)} /></Field></div>
          <Field label="Demo date" htmlFor="dm-date" required error={errors.date}><input id="dm-date" type="date" className={tcInput} value={f.date} onChange={e => set('date', e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start time" htmlFor="dm-start" required error={errors.start}><input id="dm-start" type="time" className={tcInput} value={f.start} onChange={e => set('start', e.target.value)} /></Field>
            <Field label="End time" htmlFor="dm-end" required error={errors.end}><input id="dm-end" type="time" className={tcInput} value={f.end} onChange={e => set('end', e.target.value)} /></Field>
          </div>
          <div>
            <span id="dm-mode-l" className="block text-xs font-medium text-slate-600 mb-1">Meeting mode <span aria-hidden="true">*</span></span>
            <div role="radiogroup" aria-labelledby="dm-mode-l" className="flex gap-2">
              {(['ONLINE', 'IN_PERSON'] as const).map(m => <button key={m} type="button" role="radio" aria-checked={f.mode === m} onClick={() => set('mode', m)} className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-bold ring-1 ring-inset ${f.mode === m ? 'bg-blue-50 text-blue-700 ring-blue-300' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}>{m === 'ONLINE' ? 'Online' : 'In person'}</button>)}
            </div>
          </div>
          <Field label={f.mode === 'ONLINE' ? 'Meeting platform' : 'Location'} htmlFor="dm-loc" required error={errors.location}><input id="dm-loc" className={tcInput} maxLength={300} value={f.location} onChange={e => set('location', e.target.value)} placeholder={f.mode === 'ONLINE' ? 'e.g. Google Meet, Zoom' : 'Address of the meeting'} /></Field>
          {f.mode === 'ONLINE' && <div className="sm:col-span-2"><Field label="Meeting link" htmlFor="dm-link" error={errors.meetingLink}><input id="dm-link" type="url" className={tcInput} maxLength={500} value={f.meetingLink} onChange={e => set('meetingLink', e.target.value)} placeholder="https://…" /></Field></div>}
          <div className="sm:col-span-2"><Field label="Internal notes" htmlFor="dm-notes"><textarea id="dm-notes" className={`${tcInput} min-h-[70px]`} maxLength={3000} value={f.internalNotes} onChange={e => set('internalNotes', e.target.value)} /></Field></div>
          <div><span className="block text-xs font-medium text-slate-600 mb-1">Meeting status</span>{demo ? <StatusBadge s={demo.status} /> : <StatusBadge s="SCHEDULED" />}</div>
        </div>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className={tcBtn.secondary} onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className={tcBtn.primary} disabled={saving}>{saving ? 'Saving…' : demo ? 'Save changes' : 'Schedule demo'}</button></div>
      </form>
    </Dialog>
  );
};
