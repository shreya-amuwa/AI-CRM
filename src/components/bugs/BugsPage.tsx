import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bug, Loader2, MessageSquarePlus, RefreshCw, Reply, Search } from 'lucide-react';
import type { DevBug, DevBugList, DevBugStatus } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { bugsApi } from '../../lib/api/bugs';
import { SideDrawer } from '../common/SideDrawer';
import { BUG_STATUS_LABEL, BugFiles, BugHistory, BugProgress, BugStatusPill, BugTags, bugWhen, useBugAccess } from './bugUi';

/**
 * Bugs (migrations 20270122000300, 20270122000400, 20270312000100): the Developers team's section. Every technical issue an employee reports lands here
 * and is seen by the whole team. Only the developers on the list get the section (the menu follows the database, which checks every call again).
 * A bug has no mandatory assignee: all three developers (the Team Lead and the two developers) see every bug and work on it together. Each one
 * adds progress updates (what they did, the new status and progress, notes): every update is kept with who made it and when, none overwrites
 * another, and the bug shows its contributors, its overall progress and the latest update. The Team Lead may still name an optional primary
 * contact; nothing depends on it. Everyone leaves internal comments the reporter never sees; the reporter follows the status and resolution.
 * Issue routing (20270128000200): each issue carries its category, priority and source (an employee, an HR report, or an employee issue HR
 * escalated, with its files); the team replies to the reporter or asks for information (Pending Information), and the reporter answers.
 */
interface Filter { id: string; label: string; q: { status?: string; assignee?: string }; count?: (c: DevBugList['counts']) => number }
const FILTERS: Filter[] = [
  { id: 'open', label: 'Open', q: { status: 'OPEN' }, count: c => c.OPEN ?? c.PENDING + c.IN_PROGRESS },
  { id: 'contributed', label: 'I worked on', q: { assignee: 'CONTRIBUTED' } },
  { id: 'PENDING', label: 'Pending', q: { status: 'PENDING' }, count: c => c.PENDING },
  { id: 'UNDER_REVIEW', label: 'Under Review', q: { status: 'UNDER_REVIEW' }, count: c => c.UNDER_REVIEW ?? 0 },
  { id: 'IN_PROGRESS', label: 'In Progress', q: { status: 'IN_PROGRESS' }, count: c => c.IN_PROGRESS },
  { id: 'TESTING', label: 'Testing', q: { status: 'TESTING' }, count: c => c.TESTING ?? 0 },
  { id: 'NEEDS_INFO', label: 'Pending Information', q: { status: 'NEEDS_INFO' }, count: c => c.NEEDS_INFO ?? 0 },
  { id: 'RESOLVED', label: 'Resolved', q: { status: 'RESOLVED' }, count: c => c.RESOLVED },
  { id: 'REJECTED', label: 'Rejected', q: { status: 'REJECTED' }, count: c => c.REJECTED },
  { id: 'CLOSED', label: 'Closed', q: { status: 'CLOSED' }, count: c => c.CLOSED ?? 0 },
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
  const lead = !!access?.isLead;
  const filters: Filter[] = FILTERS;
  const load = useCallback(() => {
    const mine = ++latest.current;
    const f = filters.find(x => x.id === filter) ?? FILTERS[0];
    setError(null);
    bugsApi.list({ ...f.q, search: term || undefined, page, pageSize: PAGE }).then(r => mine === latest.current && setList(r), e => mine === latest.current && setError(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, term, page, access?.isLead]);
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
          <p className="text-sm text-slate-500 mt-0.5">Every bug reported across the CRM. The whole team works on them together: add a progress update whenever you work on one.</p>
        </div>
        <button type="button" className={btnGhost} onClick={load}><RefreshCw className="w-4 h-4" aria-hidden /> Refresh</button>
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter bugs">
        {filters.map(f => (
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
      {list && list.byDeveloper.length > 0 && (
        <section aria-label="Team contributions" className="flex flex-wrap gap-2" data-testid="team-workload">
          {list.byDeveloper.map(d => (
            <div key={d.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
              <span className="block font-bold text-slate-800">{d.name}</span>
              <span className="text-slate-600">{d.updates ?? 0} progress updates</span>
            </div>
          ))}
        </section>
      )}
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error} <button type="button" className="underline" onClick={load}>Try again</button></p>}
      {!list && !error && <p className="text-sm text-slate-500 flex items-center gap-2" role="status"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}
      {list && !list.items.length && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">No bugs here.</p>}
      {list && list.items.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm" data-testid="bugs-table">
            <thead className="bg-slate-50 text-xs text-slate-600"><tr>
              {['Reference', 'Issue', 'Priority', 'Reported by', 'Department · Designation', 'Submitted', 'Files', 'Progress', 'Worked on by', 'Status'].map(h => <th key={h} scope="col" className="px-3 py-2.5 text-left font-bold whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.items.map(b => (
                // the whole row opens the bug; the title stays a button for the keyboard
                <tr key={b.id} className="hover:bg-indigo-50/40 cursor-pointer" data-testid="bug-row" onClick={() => setOpenId(b.id)}>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-500 whitespace-nowrap">{b.reference}</td>
                  <td className="px-3 py-2.5">
                    <button type="button" className="text-left font-semibold text-slate-900 hover:text-indigo-700" onClick={e => { e.stopPropagation(); setOpenId(b.id); }} aria-label={`Open ${b.reference}: ${b.title}`}>{b.title}</button>
                    {(b.source && b.source !== 'EMPLOYEE') || b.affectedEmployee ? (
                      <div className="mt-0.5 text-[11px] text-slate-500">{b.source && b.source !== 'EMPLOYEE' ? <BugTags b={{ source: b.source, sourceIssueReference: b.sourceIssueReference }} /> : null}{b.affectedEmployee ? ` Affects ${b.affectedEmployee}` : ''}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5"><BugTags b={{ priority: b.priority }} /></td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{b.reporterName}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{b.department ?? '–'}{b.designation ? ` · ${b.designation}` : ''}</td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">{bugWhen(b.createdAt)}</td>
                  <td className="px-3 py-2.5 text-xs">{b.attachmentCount || '–'}</td>
                  <td className="px-3 py-2.5"><BugProgress value={b.progress} compact /></td>
                  <td className="px-3 py-2.5 text-xs" data-testid="bug-contributors">{b.contributors?.length ? b.contributors.join(', ') : <span className="text-slate-400">No update yet</span>}</td>
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
      {openId && <BugDrawer id={openId} lead={lead} developers={access?.developers ?? []} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
};

const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

const BugDrawer: React.FC<{ id: string; lead: boolean; developers: { id: string; name: string }[]; onClose: () => void; onChanged: () => void }> = ({
  id, lead, developers, onClose, onChanged
}) => {
  const [b, setB] = useState<DevBug | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  // the Add Progress Update form
  const [work, setWork] = useState('');
  const [status, setStatus] = useState<DevBugStatus | ''>('');
  const [progress, setProgress] = useState(0);
  const [notes, setNotes] = useState('');
  const requestId = useRef(newRequestId());
  const [comment, setComment] = useState('');
  const [reply, setReply] = useState('');
  const [flash, setFlash] = useState('');
  const adopt = (x: DevBug) => { setB(x); setStatus(x.status); setProgress(x.progress ?? 0); };
  useEffect(() => { bugsApi.detail(id).then(adopt, e => setError(errorMessage(e))); }, [id]);
  /** true when the change was saved (a failed one keeps what was typed) */
  const run = async (fn: () => Promise<DevBug>, done: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setConflict(false);
    setFlash('');
    try {
      const x = await fn();
      adopt(x); setFlash(done); onChanged();
      return true;
    } catch (e) {
      const m = errorMessage(e);
      setError(m);
      setConflict(/updated this bug while you were writing/i.test(m));
      return false;
    } finally {
      setBusy(false);
    }
  };
  // somebody else saved first: load their version; what was typed stays
  const reload = () => { setError(null); setConflict(false); bugsApi.detail(id).then(adopt, e => setError(errorMessage(e))); };
  const needsNote = status === 'RESOLVED' || status === 'REJECTED';
  const changed = !!b && (status !== b.status || progress !== (b.progress ?? 0));
  const resolutionText = (notes.trim() || work.trim());
  const canSave = !!b && !busy && work.trim().length >= 3 && !!status && !(needsNote && status !== b.status && resolutionText.length < 5);
  return (
    <SideDrawer title={b?.title ?? 'Bug'} subtitle={b ? `${b.reference} · reported ${bugWhen(b.createdAt)}` : undefined} onClose={onClose}>
      <div className="p-5 space-y-5 text-sm" data-testid="bug-drawer">
        {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">{error}{conflict && <> <button type="button" className="underline font-semibold" onClick={reload} data-testid="bug-reload">Load the latest version</button></>}</p>}
        {flash && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">{flash}</p>}
        {!b && !error && <p className="text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}
        {b && (
          <>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2"><BugStatusPill status={b.status} />{b.assigneeName && <span className="text-xs text-slate-600">Primary contact <b>{b.assigneeName}</b></span>}</div>
              <BugProgress value={b.progress} />
            </div>
            <BugTags b={b} />
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-slate-500">Reported by</dt><dd>{b.reporterName}</dd>
              {b.affectedDepartment ? <><dt className="text-slate-500">Affects (dept.)</dt><dd>{b.affectedDepartment}</dd></> : null}
              {b.affectedEmployee ? <><dt className="text-slate-500">Affects</dt><dd>{b.affectedEmployee}</dd></> : null}
              <dt className="text-slate-500">Department</dt><dd>{b.department ?? '–'}</dd>
              <dt className="text-slate-500">Designation</dt><dd>{b.designation ?? '–'}</dd>
              <dt className="text-slate-500">Created</dt><dd>{bugWhen(b.createdAt)}</dd>
              <dt className="text-slate-500">Latest update</dt>
              <dd data-testid="bug-latest-update">{b.latestUpdate ? <>{b.latestUpdate.by ?? '–'} · {bugWhen(b.latestUpdate.at)}{b.latestUpdate.work ? <span className="block text-slate-600">{b.latestUpdate.work}</span> : null}</> : <span className="text-slate-400">No progress update yet</span>}</dd>
              <dt className="text-slate-500">Contributors</dt>
              <dd data-testid="bug-contributor-list">{b.contributors?.length ? (
                <ul className="flex flex-wrap gap-1.5">{b.contributors.map(c => <li key={c.id} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{c.name} · {c.updates} {c.updates === 1 ? 'update' : 'updates'}</li>)}</ul>
              ) : <span className="text-slate-400">Nobody yet</span>}</dd>
            </dl>
            <section><h3 className="text-xs font-bold uppercase text-slate-500 mb-1">Description</h3><p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-slate-800">{b.description}</p></section>
            {b.steps && <section><h3 className="text-xs font-bold uppercase text-slate-500 mb-1">Steps to reproduce</h3><p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-slate-800">{b.steps}</p></section>}
            <section><h3 className="text-xs font-bold uppercase text-slate-500 mb-1">Screenshots and files</h3><BugFiles files={b.attachments} /></section>
            {b.resolutionNote && <section><h3 className="text-xs font-bold uppercase text-slate-500 mb-1">{b.status === 'REJECTED' ? 'Reason' : 'Resolution'}</h3><p className="whitespace-pre-wrap rounded-lg bg-emerald-50 p-3 text-slate-800">{b.resolutionNote}</p></section>}

            <section className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3" data-testid="bug-progress-form">
              <h3 className="text-xs font-bold uppercase text-indigo-800">Add Progress Update</h3>
              <label className="block text-xs font-semibold text-slate-600" htmlFor="bug-work">What did you work on?</label>
              <textarea id="bug-work" rows={3} maxLength={3000} className={inputCls} value={work} onChange={e => setWork(e.target.value)} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-600" htmlFor="bug-status">Status</label>
                  <select id="bug-status" className={inputCls} value={status} disabled={busy} onChange={e => setStatus(e.target.value as DevBugStatus)}>
                    {(Object.keys(BUG_STATUS_LABEL) as DevBugStatus[]).map(s => <option key={s} value={s}>{BUG_STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600" htmlFor="bug-progress">Progress (%)</label>
                  <input id="bug-progress" type="number" inputMode="numeric" min={0} max={100} step={5} className={inputCls} value={progress} disabled={busy}
                    onChange={e => setProgress(Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))))} />
                </div>
              </div>
              <label className="block text-xs font-semibold text-slate-600" htmlFor="bug-notes">{needsNote ? (status === 'RESOLVED' ? 'Resolution note (the employee reads it)' : 'Reason for rejecting (the employee reads it)') : 'Notes (optional)'}</label>
              <textarea id="bug-notes" rows={2} maxLength={3000} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} />
              <p className="text-[11px] text-slate-500">Saved with your name and the time. It is added to the history: nobody’s earlier update is replaced.{changed ? '' : ' (The status and progress stay as they are.)'}</p>
              <button type="button" className={btnPrimary} disabled={!canSave} data-testid="bug-save-update"
                onClick={() => void run(() => bugsApi.addUpdate(b.id, { work: work.trim(), status: status as DevBugStatus, progress, notes: notes.trim() || null, expectedVersion: b.version, clientRequestId: requestId.current }),
                  'Progress update saved.').then(ok => { if (ok) { setWork(''); setNotes(''); requestId.current = newRequestId(); } })}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save progress update
              </button>
            </section>
            {lead && (
              <section className="space-y-2 rounded-xl border border-slate-200 p-3" data-testid="bug-assignment">
                <label className="block text-xs font-bold text-slate-600" htmlFor="bug-assignee">Primary contact (optional)</label>
                <select id="bug-assignee" className={inputCls} value={b.assigneeId ?? ''} disabled={busy}
                  onChange={e => void run(() => bugsApi.assign(b.id, e.target.value || null),
                    e.target.value ? `${developers.find(d => d.id === e.target.value)?.name ?? 'The developer'} is the primary contact. Everyone on the team can still work on it.` : 'No primary contact.')}>
                  <option value="">None: the whole team works on it</option>
                  {developers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                {b.assignedAt && <p className="text-[11px] text-slate-500">{b.assigneeName ? 'Named' : 'Cleared'} by {b.assignedByName ?? '–'} · {bugWhen(b.assignedAt)}</p>}
              </section>
            )}
            {b.status !== 'CLOSED' && (
              <section className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3" data-testid="bug-reply">
                <label className="block text-xs font-bold text-indigo-800" htmlFor="bug-reply-text">Reply to {b.reporterName} (they read it)</label>
                <textarea id="bug-reply-text" rows={2} maxLength={3000} className={inputCls} value={reply} onChange={e => setReply(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnGhost} disabled={busy || reply.trim().length < 2}
                    onClick={() => void run(() => bugsApi.reply(b.id, reply.trim(), false), `Reply sent to ${b.reporterName}.`).then(ok => ok && setReply(''))}>
                    <Reply className="w-4 h-4" aria-hidden /> Send reply
                  </button>
                  <button type="button" className={btnGhost} disabled={busy || reply.trim().length < 2} data-testid="ask-info"
                    onClick={() => void run(() => bugsApi.reply(b.id, reply.trim(), true), `Asked ${b.reporterName} for information: Pending Information.`).then(ok => ok && setReply(''))}>
                    Ask for information
                  </button>
                </div>
              </section>
            )}
            <section className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
              <label className="block text-xs font-bold text-violet-800" htmlFor="bug-comment">Internal comment (developers only)</label>
              <textarea id="bug-comment" rows={2} maxLength={3000} className={inputCls} value={comment} onChange={e => setComment(e.target.value)} />
              <button type="button" className={btnGhost} disabled={busy || !comment.trim()} onClick={() => void run(() => bugsApi.comment(b.id, comment.trim()), 'Comment added.').then(ok => ok && setComment(''))}>
                <MessageSquarePlus className="w-4 h-4" aria-hidden /> Add comment
              </button>
            </section>
            <section><h3 className="text-xs font-bold uppercase text-slate-500 mb-1.5">Progress and activity history</h3><BugHistory history={b.history} /></section>
          </>
        )}
      </div>
    </SideDrawer>
  );
};

export default BugsPage;
