import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bug, Loader2, MessageSquarePlus, RefreshCw, Search } from 'lucide-react';
import type { DevBug, DevBugList, DevBugStatus } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { bugsApi } from '../../lib/api/bugs';
import { SideDrawer } from '../common/SideDrawer';
import { BUG_STATUS_LABEL, BugFiles, BugHistory, BugStatusPill, bugWhen, useBugAccess } from './bugUi';

/**
 * Bugs (migration 20270122000300): the Developers team's section. Every technical issue an employee reports lands here. Only the developers
 * on the list (Shreya Mande, Ashish Sinha, Siddhesh Shinde) get it: the menu entry follows the database, and every call is checked there
 * again. Developers open a bug, assign it among themselves, move it through Pending / In Progress / Resolved / Rejected, and leave internal
 * comments the reporter never sees; the reporter sees the status, the developer and the resolution note on their own page.
 */
const FILTERS: { id: string; label: string; q: { status?: string; assignee?: string }; count?: (c: DevBugList['counts']) => number }[] = [
  { id: 'open', label: 'Open', q: { status: 'OPEN' }, count: c => c.PENDING + c.IN_PROGRESS },
  { id: 'mine', label: 'Assigned to me', q: { status: 'OPEN', assignee: 'ME' }, count: c => c.MINE },
  { id: 'unassigned', label: 'Unassigned', q: { status: 'OPEN', assignee: 'UNASSIGNED' }, count: c => c.UNASSIGNED },
  { id: 'PENDING', label: 'Pending', q: { status: 'PENDING' }, count: c => c.PENDING },
  { id: 'IN_PROGRESS', label: 'In Progress', q: { status: 'IN_PROGRESS' }, count: c => c.IN_PROGRESS },
  { id: 'RESOLVED', label: 'Resolved', q: { status: 'RESOLVED' }, count: c => c.RESOLVED },
  { id: 'REJECTED', label: 'Rejected', q: { status: 'REJECTED' }, count: c => c.REJECTED },
  { id: 'all', label: 'All', q: {} }
];
const PAGE = 50;
const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50';
const btnPrimary = `${btn} bg-indigo-600 text-white hover:bg-indigo-700`;
const btnGhost = `${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

export const BugsPage: React.FC = () => {
  const access = useBugAccess();
  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<DevBugList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => { setTerm(search.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);
  const latest = useRef(0);
  const load = useCallback(() => {
    const mine = ++latest.current;
    const f = FILTERS.find(x => x.id === filter) ?? FILTERS[0];
    setError(null);
    bugsApi.list({ ...f.q, search: term || undefined, page, pageSize: PAGE }).then(r => mine === latest.current && setList(r), e => mine === latest.current && setError(errorMessage(e)));
  }, [filter, term, page]);
  useEffect(load, [load]);

  if (access && !access.isDeveloper) {
    return <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600" role="status">The Bugs section is for the Developers team only.</p>;
  }
  const pages = list ? Math.max(1, Math.ceil(list.total / PAGE)) : 1;
  return (
    <div className="space-y-5" data-testid="bugs-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2"><Bug className="w-5 h-5 text-rose-600" aria-hidden /> Bugs</h1>
          <p className="text-sm text-slate-500 mt-0.5">Technical issues reported by employees across the CRM. Assign them among the Developers team and keep the reporter informed.</p>
        </div>
        <button type="button" className={btnGhost} onClick={load}><RefreshCw className="w-4 h-4" aria-hidden /> Refresh</button>
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter bugs">
        {FILTERS.map(f => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => { setFilter(f.id); setPage(1); }}
            className={`h-9 px-3 rounded-full text-[13px] font-bold inline-flex items-center gap-1.5 ${filter === f.id ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
            {f.label}{list && f.count ? <span className={`text-[11px] rounded-full px-1.5 ${filter === f.id ? 'bg-white/20' : 'bg-slate-100 text-slate-600'}`}>{f.count(list.counts)}</span> : null}
          </button>
        ))}
      </div>
      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
        <input className={`${inputCls} pl-9`} aria-label="Search bugs" placeholder="Search by title, reference or reporter" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error} <button type="button" className="underline" onClick={load}>Try again</button></p>}
      {!list && !error && <p className="text-sm text-slate-500 flex items-center gap-2" role="status"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}
      {list && !list.items.length && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">No bugs here.</p>}
      {list && list.items.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm" data-testid="bugs-table">
            <thead className="bg-slate-50 text-xs text-slate-600"><tr>
              {['Reference', 'Issue', 'Reported by', 'Department · Designation', 'Submitted', 'Files', 'Assigned to', 'Status'].map(h => <th key={h} scope="col" className="px-3 py-2.5 text-left font-bold whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.items.map(b => (
                <tr key={b.id} className="hover:bg-indigo-50/40" data-testid="bug-row">
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-500 whitespace-nowrap">{b.reference}</td>
                  <td className="px-3 py-2.5"><button type="button" className="text-left font-semibold text-slate-900 hover:text-indigo-700" onClick={() => setOpenId(b.id)} aria-label={`Open ${b.reference}: ${b.title}`}>{b.title}</button></td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{b.reporterName}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{b.department ?? '–'}{b.designation ? ` · ${b.designation}` : ''}</td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">{bugWhen(b.createdAt)}</td>
                  <td className="px-3 py-2.5 text-xs">{b.attachmentCount || '–'}</td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">{b.assigneeName ?? <span className="text-amber-700 font-semibold">Unassigned</span>}</td>
                  <td className="px-3 py-2.5"><BugStatusPill status={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
              <button type="button" className={btnGhost} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
              Page {page} of {pages}
              <button type="button" className={btnGhost} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </div>
      )}
      {openId && <BugDrawer id={openId} developers={access?.developers ?? []} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
};

const BugDrawer: React.FC<{ id: string; developers: { id: string; name: string }[]; onClose: () => void; onChanged: () => void }> = ({ id, developers, onClose, onChanged }) => {
  const [b, setB] = useState<DevBug | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<DevBugStatus | ''>('');
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const [flash, setFlash] = useState('');
  useEffect(() => { bugsApi.detail(id).then(x => { setB(x); setStatus(x.status); }, e => setError(errorMessage(e))); }, [id]);
  /** true when the change was saved (a failed one keeps what was typed) */
  const run = async (fn: () => Promise<DevBug>, done: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setFlash('');
    try {
      const x = await fn();
      setB(x); setStatus(x.status); setFlash(done); onChanged();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const needsNote = status === 'RESOLVED' || status === 'REJECTED';
  return (
    <SideDrawer title={b?.title ?? 'Bug'} subtitle={b ? `${b.reference} · reported ${bugWhen(b.createdAt)}` : undefined} onClose={onClose}>
      <div className="p-5 space-y-5 text-sm" data-testid="bug-drawer">
        {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
        {flash && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">{flash}</p>}
        {!b && !error && <p className="text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}
        {b && (
          <>
            <div className="flex flex-wrap items-center gap-2"><BugStatusPill status={b.status} />{b.assigneeName && <span className="text-xs text-slate-600">Assigned to <b>{b.assigneeName}</b></span>}</div>
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-slate-500">Reported by</dt><dd>{b.reporterName}</dd>
              <dt className="text-slate-500">Department</dt><dd>{b.department ?? '–'}</dd>
              <dt className="text-slate-500">Designation</dt><dd>{b.designation ?? '–'}</dd>
              <dt className="text-slate-500">Submitted</dt><dd>{bugWhen(b.createdAt)}</dd>
            </dl>
            <section><h3 className="text-xs font-bold uppercase text-slate-500 mb-1">Description</h3><p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-slate-800">{b.description}</p></section>
            {b.steps && <section><h3 className="text-xs font-bold uppercase text-slate-500 mb-1">Steps to reproduce</h3><p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-slate-800">{b.steps}</p></section>}
            <section><h3 className="text-xs font-bold uppercase text-slate-500 mb-1">Screenshots and files</h3><BugFiles files={b.attachments} /></section>
            {b.resolutionNote && <section><h3 className="text-xs font-bold uppercase text-slate-500 mb-1">{b.status === 'REJECTED' ? 'Reason' : 'Resolution'}</h3><p className="whitespace-pre-wrap rounded-lg bg-emerald-50/60 p-3">{b.resolutionNote}</p></section>}

            <section className="space-y-2 rounded-xl border border-slate-200 p-3">
              <label className="block text-xs font-bold text-slate-600" htmlFor="bug-assignee">Assigned developer</label>
              <select id="bug-assignee" className={inputCls} value={b.assigneeId ?? ''} disabled={busy}
                onChange={e => void run(() => bugsApi.assign(b.id, e.target.value || null), e.target.value ? 'Assigned.' : 'Unassigned.')}>
                <option value="">Unassigned</option>
                {developers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </section>
            <section className="space-y-2 rounded-xl border border-slate-200 p-3">
              <label className="block text-xs font-bold text-slate-600" htmlFor="bug-status">Status</label>
              <select id="bug-status" className={inputCls} value={status} disabled={busy} onChange={e => setStatus(e.target.value as DevBugStatus)}>
                {(Object.keys(BUG_STATUS_LABEL) as DevBugStatus[]).map(s => <option key={s} value={s}>{BUG_STATUS_LABEL[s]}</option>)}
              </select>
              <label className="block text-xs font-semibold text-slate-600" htmlFor="bug-note">{needsNote ? (status === 'RESOLVED' ? 'Resolution note (the employee reads it)' : 'Reason for rejecting (the employee reads it)') : 'Note to the employee (optional)'}</label>
              <textarea id="bug-note" rows={3} maxLength={3000} className={inputCls} value={note} onChange={e => setNote(e.target.value)} />
              <button type="button" className={btnPrimary} disabled={busy || !status || (status === b.status && !note.trim()) || (needsNote && note.trim().length < 5)}
                onClick={() => void run(() => bugsApi.setStatus(b.id, status as DevBugStatus, note.trim() || null), `Status: ${BUG_STATUS_LABEL[status as DevBugStatus]}. The employee is told.`).then(ok => ok && setNote(''))}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Update status
              </button>
            </section>
            <section className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
              <label className="block text-xs font-bold text-violet-800" htmlFor="bug-comment">Internal comment (developers only)</label>
              <textarea id="bug-comment" rows={2} maxLength={3000} className={inputCls} value={comment} onChange={e => setComment(e.target.value)} />
              <button type="button" className={btnGhost} disabled={busy || !comment.trim()} onClick={() => void run(() => bugsApi.comment(b.id, comment.trim()), 'Comment added.').then(ok => ok && setComment(''))}>
                <MessageSquarePlus className="w-4 h-4" aria-hidden /> Add comment
              </button>
            </section>
            <section><h3 className="text-xs font-bold uppercase text-slate-500 mb-1.5">History</h3><BugHistory history={b.history} /></section>
          </>
        )}
      </div>
    </SideDrawer>
  );
};

export default BugsPage;
