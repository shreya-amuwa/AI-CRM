import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Bell, CheckCircle2, Loader2, Megaphone, Pencil, RefreshCw, Search, Send, Trash2 } from 'lucide-react';
import type { CompanyNotice, NoticeAudienceOptions, NoticeAudienceType, NoticeList, NoticeManagers, NoticePriority, NoticeReceipts } from '../../../shared/contracts';
import { NOTICE_CATEGORIES, NOTICE_CATEGORY_LABELS, NOTICE_PRIORITIES, noticePublishSchema } from '../../../shared/validation';
import { ApiError } from '../../lib/api/client';
import { noticesApi } from '../../lib/api/notices';
import { btn, Card, Dialog, ErrorBanner, Field, inputCls, selectCls, Spinner, useDebounced } from '../team-member/pipeline/shared';
import { StagedFiles, TicketFileButton, useTicketFiles } from '../tickets/TicketFiles';
import { issueFileTransport } from '../issues/issueFiles';
import { BugFiles } from '../bugs/bugUi';
import { noticesChanged, takePendingNotice, useOpenNoticeRequest } from './noticeEvents';

/**
 * Notice Board (migration 20270131000200), in the side panel of every dashboard.
 *  - View Notices: everyone; the notices addressed to them (publishers also every company notice), filters, read / unread; opening one
 *    records the read receipt.
 *  - Send Notice: only the Super Admin, HR and the CRM team (named accounts, 20270202000100). The database refuses anyone
 *    else and checks the audience; this screen only hides what they cannot do. The Super Admin also sees Managers (who the CRM team is).
 *  - Acknowledge: every recipient acknowledges a notice once (here, or in the popup that opens when they enter the CRM). Publishers also manage their notices: read receipts,
 *    delivery status, edit (history kept), archive.
 */
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`);
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '–');
const PRIORITY_LABEL: Record<NoticePriority, string> = { NORMAL: 'Normal', IMPORTANT: 'Important', URGENT: 'Urgent' };
const PRIORITY_STYLE: Record<NoticePriority, string> = {
  NORMAL: 'bg-slate-50 text-slate-700 border-slate-200', IMPORTANT: 'bg-amber-50 text-amber-800 border-amber-200', URGENT: 'bg-rose-50 text-rose-700 border-rose-200'
};
const ROLE_LABEL = { SUPER_ADMIN: 'Super Admin', OPERATIONS_HEAD: 'Operations Head', HR: 'HR', DEVELOPER: 'Developers', CRM_TEAM: 'CRM team' } as const;
const AUDIENCE_LABEL: Record<NoticeAudienceType, string> = {
  COMPANY: 'Entire company – all employees', DEPARTMENT: 'Specific departments', ROLE: 'Specific designations or roles', EMPLOYEES: 'Selected employees'
};
const audienceText = (n: CompanyNotice) => n.audience.type === 'COMPANY' ? 'Entire company'
  : n.audience.type === 'DEPARTMENT' ? `Departments: ${n.audience.departmentNames.join(', ')}`
  : n.audience.type === 'ROLE' ? `Designations: ${n.audience.roles.join(', ').replace(/_/g, ' ').toLowerCase()}${n.audience.departmentNames.length ? ` (${n.audience.departmentNames.join(', ')})` : ''}`
  : `${n.audience.employees.length} selected employee${n.audience.employees.length === 1 ? '' : 's'}`;

const PriorityPill: React.FC<{ p: NoticePriority }> = ({ p }) => (
  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${PRIORITY_STYLE[p]}`} data-testid="notice-priority">{PRIORITY_LABEL[p]}</span>
);

// ---------------------------------------------------------------------------------------------------- delete
/**
 * "Delete Notice?" (20270205000100). Nothing is sent until Delete is pressed; Cancel closes without a request; while the request is running both buttons are off, so a
 * double click sends one request. The database decides who may delete (the publisher, or the Super Admin) and keeps the record and its receipts: this screen only
 * hides the button from people who cannot use it. A refusal or a failure is shown here and the notice stays.
 */
const DeleteNoticeDialog: React.FC<{ notice: { id: string; title: string }; onClose: () => void; onDeleted: (id: string) => void }> = ({ notice, onClose, onDeleted }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await noticesApi.remove(notice.id);
      onDeleted(notice.id);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };
  return (
    <Dialog title="Delete Notice?" description="Are you sure you want to delete this notice? This action cannot be undone." onClose={() => { if (!busy) onClose(); }} persistent>
      <div className="space-y-3" data-testid="delete-notice-dialog">
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 break-words">{notice.title}</p>
        {error ? <ErrorBanner message={error} /> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} disabled={busy} onClick={onClose} data-testid="cancel-delete">Cancel</button>
          <button type="button" className={btn.danger} disabled={busy} onClick={() => void confirm()} data-testid="confirm-delete">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Trash2 className="w-4 h-4" aria-hidden />} Delete
          </button>
        </div>
      </div>
    </Dialog>
  );
};

// ---------------------------------------------------------------------------------------------------- one notice
const NoticeDialog: React.FC<{ id: string; onClose: () => void; onChanged: () => void; onDeleted: (id: string) => void }> = ({ id, onClose, onChanged, onDeleted }) => {
  const [n, setN] = useState<CompanyNotice | null>(null);
  const [receipts, setReceipts] = useState<NoticeReceipts | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ title: string; body: string; priority: NoticePriority; expiresAt: string; again: boolean } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const load = useCallback(() => {
    setError('');
    noticesApi.open(id).then(x => {
      setN(x);
      noticesChanged();
      onChanged();
      if (x.canManage) noticesApi.receipts(id).then(setReceipts, () => setReceipts(null));
    }, e => setError(errText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(load, [load]);
  const run = async (fn: () => Promise<CompanyNotice>) => {
    setBusy(true);
    setError('');
    try { await fn(); setEdit(null); setConfirmArchive(false); load(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog title={n ? n.title : 'Notice'} onClose={onClose} wide>
      <div className="space-y-4 text-sm" data-testid="notice-dialog">
        {error ? <ErrorBanner message={error} /> : null}
        {!n && !error ? <Spinner /> : null}
        {n && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <PriorityPill p={n.priority} />
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">{NOTICE_CATEGORY_LABELS[n.category]}</span>
              {n.status === 'ARCHIVED' ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-700">Archived</span> : null}
              {n.status === 'SCHEDULED' ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-800">Scheduled</span> : null}
              {n.expired ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">Expired</span> : null}
              <span className="text-xs text-slate-500 font-mono">{n.reference}</span>
            </div>
            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-slate-500">Published by</dt><dd className="font-semibold">{n.publisherName ?? '–'} <span className="font-normal text-slate-500">({ROLE_LABEL[n.publisherRole]})</span></dd>
              <dt className="text-slate-500">Published</dt><dd>{when(n.publishAt)}</dd>
              {n.expiresAt ? <><dt className="text-slate-500">Expires</dt><dd>{when(n.expiresAt)}</dd></> : null}
              {n.canManage ? <><dt className="text-slate-500">For</dt><dd>{audienceText(n)}</dd></> : null}
            </dl>
            {edit ? (
              <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/30 p-3" data-testid="notice-edit">
                <Field label="Notice title" required htmlFor="notice-edit-title"><input id="notice-edit-title" className={inputCls} maxLength={200} value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} /></Field>
                <Field label="Notice description" required htmlFor="notice-edit-body"><textarea id="notice-edit-body" rows={6} className={inputCls} maxLength={10000} value={edit.body} onChange={e => setEdit({ ...edit, body: e.target.value })} /></Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Priority" htmlFor="notice-edit-priority"><select id="notice-edit-priority" className={`${selectCls} w-full`} value={edit.priority} onChange={e => setEdit({ ...edit, priority: e.target.value as NoticePriority })}>{NOTICE_PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></Field>
                  <Field label="Expiry (optional)" htmlFor="notice-edit-expiry"><input id="notice-edit-expiry" type="datetime-local" className={inputCls} value={edit.expiresAt} onChange={e => setEdit({ ...edit, expiresAt: e.target.value })} /></Field>
                </div>
                <label className="flex items-start gap-2 text-xs text-slate-700">
                  <input type="checkbox" className="mt-0.5" checked={edit.again} onChange={e => setEdit({ ...edit, again: e.target.checked })} data-testid="notice-ack-again" />
                  <span><b>Employees must acknowledge this change again.</b> Tick it for a change that matters (a new date, a different rule). Leave it for a typo: nobody is asked again.</span>
                </label>
                <p className="text-[11px] text-slate-500">The audience stays the same. The earlier text is kept in the history.</p>
                <div className="flex justify-end gap-2">
                  <button type="button" className={btn.secondary} onClick={() => setEdit(null)}>Cancel</button>
                  <button type="button" className={btn.primary} disabled={busy || edit.title.trim().length < 3 || !edit.body.trim()} data-testid="notice-save"
                    onClick={() => void run(() => noticesApi.update(n.id, { title: edit.title.trim(), body: edit.body.trim(), priority: edit.priority,
                      expiresAt: edit.expiresAt ? new Date(edit.expiresAt).toISOString() : null, acknowledgeAgain: edit.again || undefined, version: n.version }))}>{busy ? 'Saving…' : 'Save changes'}</button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-4 text-[15px] leading-relaxed text-slate-800" data-testid="notice-body">{n.body}</p>
            )}
            {n.attachments.length ? <div><h3 className="text-xs font-bold uppercase text-slate-500 mb-1">Attachments</h3><BugFiles files={n.attachments} /></div> : null}
            {n.canManage && receipts ? (
              <section className="rounded-xl border border-slate-200 p-3 space-y-2" data-testid="notice-receipts">
                <h3 className="text-xs font-bold uppercase text-slate-500">Read receipts and delivery</h3>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-semibold">Targeted: {receipts.total}</span>
                  <span className="rounded-lg bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800">Read: {receipts.read}</span>
                  <span className="rounded-lg bg-amber-50 px-2.5 py-1 font-semibold text-amber-800">Not read: {receipts.unread} ({receipts.readPercent}% read)</span>
                  <span className="rounded-lg bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800" data-testid="receipt-ack">Acknowledged: {receipts.acknowledged} ({receipts.acknowledgedPercent}%)</span>
                  <span className="rounded-lg bg-amber-50 px-2.5 py-1 font-semibold text-amber-800">Not acknowledged: {receipts.notAcknowledged}</span>
                  <span className="rounded-lg bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-800">Push: {receipts.push.accepted} delivered{receipts.push.pending ? `, ${receipts.push.pending} sending` : ''}{receipts.push.failed ? `, ${receipts.push.failed} failed` : ''} ({receipts.push.devices} devices)</span>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  <table className="min-w-full text-xs">
                    <thead className="text-slate-500"><tr>{['Employee', 'Department', 'Read', 'Acknowledged'].map(h => <th key={h} scope="col" className="px-2 py-1 text-left font-semibold">{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100">{receipts.rows.map(r => (
                      <tr key={r.profileId} data-testid="receipt-row"><td className="px-2 py-1 font-semibold">{r.name}</td><td className="px-2 py-1">{r.department ?? '–'}</td>
                        <td className="px-2 py-1">{r.readAt ? <span className="text-emerald-700">{when(r.readAt)}</span> : <span className="text-amber-700">Not read</span>}</td>
                        <td className="px-2 py-1" data-testid="receipt-ack-cell">{r.acknowledgedAt ? <span className="text-emerald-700">{when(r.acknowledgedAt)}</span> : <span className="text-amber-700">Not yet</span>}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>
            ) : null}
            {n.canManage && n.history && n.history.length > 1 ? (
              <details className="text-xs"><summary className="cursor-pointer font-semibold text-slate-600">History ({n.history.length})</summary>
                <ol className="mt-1 space-y-1">{n.history.map(h => <li key={h.version + h.action}>v{h.version} · {h.action.toLowerCase()} by {h.by ?? '–'} · {when(h.at)}{h.before && typeof h.before.title === 'string' && h.before.title !== (h.after?.title as string) ? ` · was "${h.before.title}"` : ''}</li>)}</ol>
              </details>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              {n.canManage && n.status !== 'ARCHIVED' && !edit ? (
                <>
                  <button type="button" className={btn.secondary} onClick={() => setEdit({ title: n.title, body: n.body, priority: n.priority, expiresAt: n.expiresAt ? new Date(new Date(n.expiresAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '', again: false })} data-testid="notice-edit-button"><Pencil className="w-4 h-4" aria-hidden /> Edit</button>
                  <button type="button" className={btn.secondary} onClick={() => setConfirmArchive(true)} data-testid="notice-archive"><Archive className="w-4 h-4" aria-hidden /> Archive</button>
                </>
              ) : null}
              {n.canManage && !edit ? (
                <button type="button" className={btn.danger} onClick={() => setConfirmDelete(true)} data-testid="notice-delete"><Trash2 className="w-4 h-4" aria-hidden /> Delete</button>
              ) : null}
              {n.isRecipient && !n.acknowledged && n.status === 'PUBLISHED' && !edit ? (
                <button type="button" className={btn.primary} disabled={busy} data-testid="notice-acknowledge"
                  onClick={() => void run(async () => { await noticesApi.acknowledge(n.id); noticesChanged(); return noticesApi.open(n.id); })}><CheckCircle2 className="w-4 h-4" aria-hidden /> Acknowledge</button>
              ) : null}
              {n.isRecipient && n.acknowledged && n.acknowledgedAt ? <span className="mr-auto self-center text-xs text-emerald-700" data-testid="notice-acknowledged">Acknowledged {when(n.acknowledgedAt)}</span> : null}
              <button type="button" className={btn.secondary} onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
      {confirmDelete && n ? <DeleteNoticeDialog notice={n} onClose={() => setConfirmDelete(false)} onDeleted={onDeleted} /> : null}
      {confirmArchive && n ? (
        <Dialog title="Archive this notice?" description="It leaves everyone's Notice Board. It is kept, with its read receipts and history." onClose={() => setConfirmArchive(false)} persistent>
          <div className="flex justify-end gap-2">
            <button type="button" className={btn.secondary} onClick={() => setConfirmArchive(false)}>Keep it</button>
            <button type="button" className={btn.danger} disabled={busy} onClick={() => void run(() => noticesApi.archive(n.id))} data-testid="confirm-archive">Yes, archive</button>
          </div>
        </Dialog>
      ) : null}
    </Dialog>
  );
};

// ---------------------------------------------------------------------------------------------------- the list
const NoticeCard: React.FC<{ n: CompanyNotice; onOpen: () => void; showReceipts?: boolean; onDelete?: () => void }> = ({ n, onOpen, showReceipts, onDelete }) => (
  <li className={onDelete ? 'flex items-start gap-2' : undefined}>
    {/* the whole card opens the notice */}
    <button type="button" onClick={onOpen} data-testid="notice-card" data-read={n.read ? 'true' : 'false'} aria-label={`Open notice: ${n.title}${n.read ? '' : ' (unread)'}`}
      className={`w-full ${onDelete ? 'flex-1 min-w-0' : ''} text-left rounded-2xl border p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${n.priority === 'URGENT' ? 'border-l-4 border-l-rose-500' : n.priority === 'IMPORTANT' ? 'border-l-4 border-l-amber-400' : ''} ${n.read ? 'bg-white border-slate-200' : 'bg-blue-50/40 border-blue-200'}`}>
      <div className="flex flex-wrap items-center gap-2">
        {!n.read ? <span className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">New</span> : null}
        <span className="flex-1 min-w-[10rem] text-[15px] font-bold text-slate-900">{n.title}</span>
        <PriorityPill p={n.priority} />
        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">{NOTICE_CATEGORY_LABELS[n.category]}</span>
        {n.status === 'SCHEDULED' ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-800">Scheduled</span> : null}
        {n.status === 'ARCHIVED' ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-700">Archived</span> : null}
        {n.expired ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">Expired</span> : null}
      </div>
      <p className="mt-1.5 text-sm text-slate-600 line-clamp-2 whitespace-pre-line">{n.body}</p>
      <p className="mt-2 text-[11px] text-slate-500">
        {n.publisherName ?? '–'} · {ROLE_LABEL[n.publisherRole]} · {when(n.publishAt)}{n.attachments.length ? ` · ${n.attachments.length} attachment${n.attachments.length > 1 ? 's' : ''}` : ''}
        {showReceipts ? <span className="ml-1 font-semibold text-slate-700" data-testid="notice-read-count"> · {n.readCount}/{n.recipientCount} read</span> : null}
      </p>
    </button>
    {onDelete ? (
      <button type="button" onClick={onDelete} aria-label={`Delete notice: ${n.title}`} title="Delete notice" data-testid="notice-card-delete" className={`${btn.danger} !px-2.5 shrink-0`}>
        <Trash2 className="w-4 h-4" aria-hidden /><span className="sr-only sm:not-sr-only">Delete</span>
      </button>
    ) : null}
  </li>
);

const ViewNotices: React.FC<{ canPublish: boolean; onOpen: (id: string) => void; reloadKey: number }> = ({ canPublish, onOpen, reloadKey }) => {
  const [scope, setScope] = useState<'INBOX' | 'ALL'>('INBOX');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [unread, setUnread] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const [list, setList] = useState<NoticeList | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    noticesApi.list({ scope, category: category || undefined, priority: priority || undefined, unread, search: q || undefined,
      from: from ? new Date(`${from}T00:00:00+05:30`).toISOString() : undefined, to: to ? new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86400000).toISOString() : undefined, limit: 50 })
      .then(setList, e => setError(errText(e)));
  }, [scope, category, priority, unread, q, from, to]);
  useEffect(load, [load, reloadKey]);
  return (
    <section className="space-y-3" aria-label="View Notices" data-testid="view-notices">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          {canPublish ? (
            <div role="tablist" aria-label="Which notices" className="flex rounded-lg border border-slate-200 p-0.5">
              {([['INBOX', 'For me'], ['ALL', 'All company notices']] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={scope === id} onClick={() => setScope(id)}
                  className={`px-3 h-8 rounded-md text-xs font-bold ${scope === id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{label}</button>
              ))}
            </div>
          ) : null}
          <div className="relative flex-1 min-w-[12rem]">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden />
            <input className={`${inputCls} !py-1.5 pl-8`} aria-label="Search notices" placeholder="Search title or reference" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className={selectCls} aria-label="Category" value={category} onChange={e => setCategory(e.target.value)} data-testid="filter-category"><option value="">All categories</option>{NOTICE_CATEGORIES.map(c => <option key={c} value={c}>{NOTICE_CATEGORY_LABELS[c]}</option>)}</select>
          <select className={selectCls} aria-label="Priority" value={priority} onChange={e => setPriority(e.target.value)} data-testid="filter-priority"><option value="">All priorities</option>{NOTICE_PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
          <label className="text-[11px] text-slate-500 flex items-center gap-1">From<input type="date" className={`${inputCls} !py-1.5`} aria-label="From date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></label>
          <label className="text-[11px] text-slate-500 flex items-center gap-1">To<input type="date" className={`${inputCls} !py-1.5`} aria-label="To date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>
          <label className="text-xs text-slate-600 inline-flex items-center gap-1.5"><input type="checkbox" checked={unread} onChange={e => setUnread(e.target.checked)} data-testid="filter-unread" /> Unread only</label>
          <button type="button" className={btn.secondary} onClick={load} aria-label="Refresh"><RefreshCw className="w-3.5 h-3.5" aria-hidden /></button>
        </div>
      </Card>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {!list && !error ? <Spinner /> : null}
      {list && list.items.length === 0 ? <Card className="p-10 text-center text-sm text-slate-500" ><span data-testid="notices-empty">{category || priority || unread || q || from || to ? 'No notices match these filters.' : 'No notices yet.'}</span></Card> : null}
      {list && list.items.length > 0 ? <ul className="space-y-2.5" data-testid="notice-list">{list.items.map(n => <NoticeCard key={n.id} n={n} onOpen={() => onOpen(n.id)} />)}</ul> : null}
    </section>
  );
};

// ---------------------------------------------------------------------------------------------------- sending
const SendNotice: React.FC<{ options: NoticeAudienceOptions; onOpen: (id: string) => void; reloadKey: number; onSent: () => void; onDeleted: (id: string) => void }> = ({ options, onOpen, reloadKey, onSent, onDeleted }) => {
  const [requestId, setRequestId] = useState(newRequestId);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<(typeof NOTICE_CATEGORIES)[number]>('GENERAL');
  const [priority, setPriority] = useState<NoticePriority>('NORMAL');
  const [audience, setAudience] = useState<NoticeAudienceType>(options.audiences[0] ?? 'DEPARTMENT');
  const [depts, setDepts] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [emps, setEmps] = useState<string[]>([]);
  const [empSearch, setEmpSearch] = useState('');
  const [publishAt, setPublishAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<CompanyNotice | null>(null);
  const files = useTicketFiles(issueFileTransport, {});
  const [mine, setMine] = useState<NoticeList | null>(null);
  const [deleting, setDeleting] = useState<CompanyNotice | null>(null);
  const loadMine = useCallback(() => { noticesApi.list({ scope: 'MINE', limit: 50 }).then(setMine, () => setMine({ items: [], total: 0, unread: 0, publisherRole: null })); }, []);
  useEffect(loadMine, [loadMine, reloadKey]);
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const shownEmployees = useMemo(() => {
    const t = empSearch.trim().toLowerCase();
    return options.employees.filter(e => (!depts.length || (e.departmentId && depts.includes(e.departmentId))) && (!t || e.name.toLowerCase().includes(t))).slice(0, 200);
  }, [options.employees, empSearch, depts]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy || files.busy) return;
    const payload = {
      title: title.trim(), body: body.trim(), category, priority, audienceType: audience,
      departmentIds: audience === 'DEPARTMENT' || audience === 'ROLE' ? depts : [], roles: audience === 'ROLE' ? roles : [], employeeIds: audience === 'EMPLOYEES' ? emps : [],
      attachmentIds: files.ids, publishAt: publishAt ? new Date(publishAt).toISOString() : null, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      clientRequestId: requestId
    };
    const checked = noticePublishSchema.safeParse(payload);
    const e: Record<string, string> = {};
    if (!checked.success) for (const i of checked.error.issues) { const k = String(i.path[0] ?? ''); if (k && !e[k]) e[k] = i.message; }
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setProblem('');
    try {
      const n = await noticesApi.publish(payload);
      setDone(n);
      setTitle(''); setBody(''); setCategory('GENERAL'); setPriority('NORMAL'); setDepts([]); setRoles([]); setEmps([]); setPublishAt(''); setExpiresAt(''); files.clear();
      setRequestId(newRequestId());
      loadMine();
      onSent();
    } catch (err) {
      setProblem(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5" aria-label="Send Notice" data-testid="send-notice">
      {done ? (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4" data-testid="notice-sent">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden />
          <p className="text-sm text-emerald-900"><b>{done.status === 'SCHEDULED' ? 'Notice scheduled.' : 'Notice published.'}</b> {done.duplicate ? 'It was already sent, so nothing new was created. ' : ''}
            Reference <span className="font-mono font-bold">{done.reference}</span>{done.status === 'PUBLISHED' ? ` · ${done.recipientCount} employee${done.recipientCount === 1 ? '' : 's'} notified.` : ` · goes out ${when(done.publishAt)}.`}</p>
        </div>
      ) : null}
      <Card className="p-5">
        <form onSubmit={submit} noValidate className="space-y-4" aria-label="Send a notice" data-testid="notice-form">
          <p className="text-xs text-slate-500">You publish as <b>{options.role ? ROLE_LABEL[options.role] : ''}</b>. The default audience is all employees.</p>
          <Field label="Notice title" required htmlFor="notice-title" error={errors.title}><input id="notice-title" className={inputCls} maxLength={200} value={title} onChange={e => setTitle(e.target.value)} aria-invalid={!!errors.title} /></Field>
          <Field label="Notice description" required htmlFor="notice-body" error={errors.body}><textarea id="notice-body" rows={6} className={inputCls} maxLength={10000} value={body} onChange={e => setBody(e.target.value)} aria-invalid={!!errors.body} /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Notice category" required htmlFor="notice-category"><select id="notice-category" className={`${selectCls} w-full`} value={category} onChange={e => setCategory(e.target.value as typeof category)}>{NOTICE_CATEGORIES.map(c => <option key={c} value={c}>{NOTICE_CATEGORY_LABELS[c]}</option>)}</select></Field>
            <Field label="Priority" required htmlFor="notice-priority"><select id="notice-priority" className={`${selectCls} w-full`} value={priority} onChange={e => setPriority(e.target.value as NoticePriority)}>{NOTICE_PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></Field>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-slate-700">Target audience <span className="text-rose-600">*</span></legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Target audience">
              {options.audiences.map(a => (
                <label key={a} className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm cursor-pointer ${audience === a ? 'border-blue-600 bg-blue-50/50' : 'border-slate-200 bg-white'}`}>
                  <input type="radio" name="notice-audience" value={a} checked={audience === a} onChange={() => setAudience(a)} data-testid={`audience-${a}`} /> {AUDIENCE_LABEL[a]}
                </label>
              ))}
            </div>
            {(audience === 'DEPARTMENT' || audience === 'ROLE' || audience === 'EMPLOYEES') ? (
              <div>
                <div className="text-xs font-semibold text-slate-600 mb-1">{audience === 'DEPARTMENT' ? 'Departments' : 'Departments (optional: narrow the list)'}</div>
                <div className="flex flex-wrap gap-1.5" data-testid="audience-departments">
                  {options.departments.map(d => (
                    <label key={d.id} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs cursor-pointer ${depts.includes(d.id) ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-700'}`}>
                      <input type="checkbox" className="sr-only" checked={depts.includes(d.id)} onChange={() => toggle(depts, setDepts, d.id)} aria-label={d.name} /> {d.name}
                    </label>
                  ))}
                </div>
                {errors.departmentIds ? <p className="text-xs text-rose-700 mt-1" role="alert">{errors.departmentIds}</p> : null}
              </div>
            ) : null}
            {audience === 'ROLE' ? (
              <div>
                <div className="text-xs font-semibold text-slate-600 mb-1">Designations or roles</div>
                <div className="flex flex-wrap gap-1.5" data-testid="audience-roles">
                  {options.roles.map(r => (
                    <label key={r.id} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs cursor-pointer ${roles.includes(r.id) ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-700'}`}>
                      <input type="checkbox" className="sr-only" checked={roles.includes(r.id)} onChange={() => toggle(roles, setRoles, r.id)} aria-label={r.label} /> {r.label}
                    </label>
                  ))}
                </div>
                {errors.roles ? <p className="text-xs text-rose-700 mt-1" role="alert">{errors.roles}</p> : null}
              </div>
            ) : null}
            {audience === 'EMPLOYEES' ? (
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold text-slate-600">Employees ({emps.length} selected)</span>
                  <input className={`${inputCls} !py-1 max-w-[14rem]`} aria-label="Find an employee" placeholder="Find an employee" value={empSearch} onChange={e => setEmpSearch(e.target.value)} />
                </div>
                <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100" data-testid="audience-employees">
                  {shownEmployees.map(p => (
                    <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={emps.includes(p.id)} onChange={() => toggle(emps, setEmps, p.id)} /> <span className="font-semibold">{p.name}</span>
                      <span className="text-[11px] text-slate-500">{p.department ?? ''}</span>
                    </label>
                  ))}
                  {shownEmployees.length === 0 ? <p className="px-3 py-2 text-xs text-slate-500">Nobody matches.</p> : null}
                </div>
                {errors.employeeIds ? <p className="text-xs text-rose-700 mt-1" role="alert">{errors.employeeIds}</p> : null}
              </div>
            ) : null}
          </fieldset>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Publish date (empty: now)" htmlFor="notice-publish"><input id="notice-publish" type="datetime-local" className={inputCls} value={publishAt} onChange={e => setPublishAt(e.target.value)} /></Field>
            <Field label="Expiry date (optional)" htmlFor="notice-expiry" error={errors.expiresAt}><input id="notice-expiry" type="datetime-local" className={inputCls} value={expiresAt} onChange={e => setExpiresAt(e.target.value)} /></Field>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-600 mb-1">Attachments (optional)</div>
            <TicketFileButton files={files} label disabled={busy} className="tf-attach-btn" />
            <StagedFiles files={files} hint />
          </div>
          {problem ? <ErrorBanner message={problem} /> : null}
          <button type="submit" className={btn.primary} disabled={busy || files.busy} data-testid="publish-notice">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Send className="w-4 h-4" aria-hidden />} {publishAt ? 'Schedule notice' : 'Publish notice'}
          </button>
        </form>
      </Card>
      <section aria-label="My published notices" className="space-y-2">
        <h2 className="text-sm font-bold text-slate-900">{options.role === 'SUPER_ADMIN' ? 'All published notices (manage)' : 'My published notices'}</h2>
        {!mine ? <Spinner /> : mine.items.length === 0 ? <Card className="p-6 text-center text-sm text-slate-500">Nothing published yet.</Card>
          : <ul className="space-y-2.5" data-testid="my-notices">{mine.items.map(n => <NoticeCard key={n.id} n={n} onOpen={() => onOpen(n.id)} showReceipts onDelete={n.canManage ? () => setDeleting(n) : undefined} />)}</ul>}
      </section>
      {deleting ? (
        <DeleteNoticeDialog notice={deleting} onClose={() => setDeleting(null)}
          onDeleted={id => { setMine(m => (m ? { ...m, items: m.items.filter(x => x.id !== id), total: Math.max(0, m.total - 1) } : m)); setDeleting(null); onDeleted(id); }} />
      ) : null}
    </section>
  );
};

// ---------------------------------------------------------------------------------------------------- who runs the board (the Super Admin)
const Managers: React.FC = () => {
  const [data, setData] = useState<NoticeManagers | null>(null);
  const [error, setError] = useState('');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { noticesApi.managers().then(x => { setData(x); setError(''); }, e => setError(errText(e))); }, []);
  useEffect(load, [load]);
  const set = async (id: string, enabled: boolean) => {
    setBusy(true);
    try { await noticesApi.setManager(id, enabled); setPick(''); load(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <section className="space-y-3" aria-label="Notice Board managers" data-testid="notice-managers">
      <Card className="p-4 space-y-3">
        <p className="text-sm text-slate-600">Who may send, edit and archive company notices: the Super Admin, HR, and these named people (the CRM team). Nobody else, whatever their role.</p>
        {error ? <ErrorBanner message={error} onRetry={load} /> : null}
        {!data && !error ? <Spinner /> : null}
        {data ? (
          <>
            <ul className="divide-y divide-slate-100" aria-label="CRM team">
              {data.managers.length === 0 ? <li className="py-2 text-sm text-slate-500">No one yet.</li> : null}
              {data.managers.map(m => (
                <li key={m.profileId} className="flex items-center gap-3 py-2 text-sm" data-testid="notice-manager">
                  <span className="flex-1"><b>{m.name}</b> <span className="text-xs text-slate-500">{m.department ?? ''}{m.status !== 'ACTIVE' ? ` · ${m.status.toLowerCase()} (no access while not active)` : ''}</span></span>
                  <button type="button" className={btn.secondary} disabled={busy} onClick={() => void set(m.profileId, false)}>Remove</button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <select className={selectCls} aria-label="Add a person" value={pick} onChange={e => setPick(e.target.value)} data-testid="notice-manager-pick">
                <option value="">Add a person…</option>
                {data.candidates.map(c => <option key={c.profileId} value={c.profileId}>{c.name}{c.department ? ` · ${c.department}` : ''}</option>)}
              </select>
              <button type="button" className={btn.primary} disabled={busy || !pick} onClick={() => void set(pick, true)} data-testid="notice-manager-add">Add</button>
            </div>
          </>
        ) : null}
      </Card>
    </section>
  );
};

// ---------------------------------------------------------------------------------------------------- the page
export const NoticeBoard: React.FC = () => {
  const [options, setOptions] = useState<NoticeAudienceOptions | null>(null);
  const [tab, setTab] = useState<'VIEW' | 'SEND' | 'MANAGERS'>('VIEW');
  const [open, setOpen] = useState<string | null>(() => takePendingNotice()?.id ?? null);
  const [reloadKey, setReloadKey] = useState(0);
  const [unread, setUnread] = useState<number | null>(null);
  const [flash, setFlash] = useState('');
  const reload = useCallback(() => setReloadKey(k => k + 1), []);
  useEffect(() => { noticesApi.audience().then(setOptions, () => setOptions({ canPublish: false, role: null, audiences: [], departments: [], roles: [], employees: [] })); }, []);
  useEffect(() => { noticesApi.unreadCount().then(setUnread, () => undefined); }, [reloadKey]);
  // a notice notification tapped while the board is open
  useOpenNoticeRequest(useCallback((id?: string) => { takePendingNotice(); setTab('VIEW'); if (id) setOpen(id); reload(); }, [reload]));
  // a deleted notice leaves every list at once; the others read the database again
  const deleted = useCallback(() => { setOpen(null); setFlash('Notice deleted.'); noticesChanged(); reload(); }, [reload]);
  const canPublish = !!options?.canPublish;
  return (
    <div className="space-y-5" data-testid="notice-board">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-slate-900 flex items-center gap-2"><Megaphone className="w-6 h-6 text-blue-700" aria-hidden /> Notice Board</h1>
          <p className="mt-1 text-sm text-slate-600">Company announcements published for you.{unread ? ` You have ${unread} unread.` : ''}</p>
        </div>
        {unread ? <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white" data-testid="unread-count"><Bell className="w-3.5 h-3.5" aria-hidden /> {unread} unread</span> : null}
      </div>
      {canPublish ? (
        <div role="tablist" aria-label="Notice Board sections" className="flex gap-2">
          {([['VIEW', 'View Notices'], ['SEND', 'Send Notice'], ...(options?.role === 'SUPER_ADMIN' ? [['MANAGERS', 'Managers'] as const] : [])] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`notice-tab-${id}`}
              className={`px-3.5 h-9 rounded-xl text-sm font-bold border ${tab === id ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-600'}`}>{label}</button>
          ))}
        </div>
      ) : null}
      {flash ? (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" data-testid="notice-flash">
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden /> <span className="flex-1">{flash}</span>
          <button type="button" onClick={() => setFlash('')} aria-label="Dismiss" className="text-emerald-700 hover:underline text-xs font-semibold">Dismiss</button>
        </div>
      ) : null}
      {tab === 'SEND' && canPublish && options ? <SendNotice options={options} onOpen={setOpen} reloadKey={reloadKey} onSent={reload} onDeleted={deleted} />
        : tab === 'MANAGERS' && options?.role === 'SUPER_ADMIN' ? <Managers />
        : <ViewNotices canPublish={canPublish} onOpen={setOpen} reloadKey={reloadKey} />}
      {open ? <NoticeDialog id={open} onClose={() => { setOpen(null); reload(); }} onChanged={() => noticesApi.unreadCount().then(setUnread, () => undefined)} onDeleted={deleted} /> : null}
    </div>
  );
};

export default NoticeBoard;
