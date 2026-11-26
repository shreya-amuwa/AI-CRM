import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowDownUp, CalendarDays, CheckCircle2, Clock3, Flag, Play, RefreshCw, Trash2, X } from 'lucide-react';
import { notifyWorkTasksChanged, workTasksApi, type TaskDetailsData, type TaskStatus, type TaskTimelineItem, type TaskUpdateRecord } from '../../lib/workTasks';
import { notifyWorkUpdatesChanged } from '../../lib/workUpdates';
import { fmtDate, fmtDateTime, PriorityPill, ProgressBar, STATUS_UI, StatusPill } from './TaskParts';
import { Avatar } from './PeoplePicker';
import { FollowUpButton, RequestStatusPill, RequestUpdate, ResponseDetails } from './WorkUpdates';
import { WorkUpdateForm } from './WorkUpdateForm';
import { ago } from './taskView';
import type { TaskDeletePreview } from '../../../shared/contracts';
import { confirmTaskDeletion, countLine } from '../../lib/taskDeletion';
import { toast } from '../../lib/feedback/feedbackStore';

type FormStatus = 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED';

const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold disabled:opacity-50';
const primary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const outline = `${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
const danger = `${btn} border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100`;
const success = `${btn} bg-emerald-600 text-white hover:bg-emerald-700`;
const destroy = `${btn} border border-rose-300 bg-white text-rose-700 hover:bg-rose-50`;

const Section: React.FC<{ id?: string; title: string; hint?: string; aside?: React.ReactNode; children: React.ReactNode }> = ({ id, title, hint, aside, children }) => (
  <section id={id} aria-label={title} className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
      </div>
      {aside}
    </div>
    {children}
  </section>
);

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0">
    <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-0.5 break-words text-[13px] text-slate-900">{children}</dd>
  </div>
);

const Block: React.FC<{ label: string; text: string | null; tone?: string }> = ({ label, text, tone }) =>
  text ? (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <p className={`whitespace-pre-line break-words text-[13px] ${tone ?? 'text-slate-800'}`}>{text}</p>
    </div>
  ) : null;

const statusLabel = (s: string | null | undefined) => (s && s in STATUS_UI ? STATUS_UI[s as TaskStatus].label : '-');

/** One entry of the history: what the employee reported at that time. Nothing here is edited or removed. */
const UpdateCard: React.FC<{ u: TaskUpdateRecord; latest: boolean }> = ({ u, latest }) => (
  <li className={`rounded-xl border p-3.5 ${latest ? 'border-blue-200 bg-blue-50/30' : 'border-slate-200 bg-white'}`} data-testid="update-record">
    <div className="flex flex-wrap items-center gap-2">
      <Avatar name={u.authorName ?? '?'} id={u.authorId ?? undefined} size="sm" />
      <span className="text-[13px] font-semibold text-slate-900">{u.authorName ?? 'Unknown'}</span>
      <span className="text-[11px] text-slate-400">{fmtDateTime(u.at)}</span>
      <span className="ml-auto flex flex-wrap items-center gap-1.5">
        {latest && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">Latest</span>}
        {u.requestId && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">Answers a request</span>}
        <StatusPill status={u.status} />
        <span className="text-xs font-bold text-slate-800">{u.progress}%</span>
      </span>
    </div>
    <div className="mt-2.5 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
      <Block label="Work completed" text={u.workCompleted} />
      <Block label="Remaining work" text={u.remainingWork} />
      <Block label="Blockers" text={u.blockers} tone="text-rose-700" />
      <Block label="Next steps" text={u.nextSteps} />
      <Block label="Note" text={u.workCompleted || u.remainingWork || u.blockers || u.nextSteps ? null : u.note} />
    </div>
    {u.expectedCompletion && <p className="mt-2 text-[11px] text-slate-600">Expected completion: <strong>{fmtDate(u.expectedCompletion)}</strong></p>}
  </li>
);

interface TimelineRow { key: string; label: string; at: string; actor: string | null; detail: string | null; tone: string }

/** The activity timeline, from what the database reports: creation, assignment, each update (and the status change it made), requests and answers. */
export function timelineRows(items: TaskTimelineItem[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  items.forEach((e, i) => {
    const key = `${i}-${e.kind}`;
    if (e.kind === 'TASK_CREATED') rows.push({ key, label: 'Task created', at: e.at, actor: e.actorName, detail: null, tone: 'bg-slate-400' });
    else if (e.kind === 'TASK_ASSIGNED') rows.push({ key, label: 'Task assigned', at: e.at, actor: e.actorName, detail: e.data?.assignee ? `to ${String(e.data.assignee)}` : null, tone: 'bg-blue-500' });
    else if (e.kind === 'PROGRESS_UPDATE') {
      const status = String(e.data?.status ?? '');
      const from = (e.data?.statusChangedFrom as string | null) ?? 'ASSIGNED';
      if (status && from !== status) rows.push({ key: `${key}-s`, label: 'Status changed', at: e.at, actor: e.actorName, detail: `${statusLabel(from)} → ${statusLabel(status)}`, tone: 'bg-amber-500' });
      if (status === 'COMPLETED') rows.push({ key, label: 'Task completed', at: e.at, actor: e.actorName, detail: e.note, tone: 'bg-emerald-500' });
      else rows.push({ key, label: 'Progress update submitted', at: e.at, actor: e.actorName, detail: `${String(e.data?.progress ?? '')}%${e.note ? ` · ${e.note.length > 200 ? `${e.note.slice(0, 200)}…` : e.note}` : ''}`, tone: 'bg-blue-500' });
    }
    else if (e.kind === 'WORK_UPDATE_REQUESTED') rows.push({ key, label: 'Work update requested', at: e.at, actor: e.actorName, detail: e.note, tone: 'bg-violet-500' });
    else if (e.kind === 'WORK_UPDATE_FOLLOW_UP') rows.push({ key, label: 'Reminder sent', at: e.at, actor: e.actorName, detail: e.note, tone: 'bg-violet-300' });
    else if (e.kind === 'WORK_UPDATE_RESPONDED') rows.push({ key, label: 'Update request answered', at: e.at, actor: e.actorName, detail: e.note, tone: 'bg-emerald-400' });
  });
  return rows;
}

const goTo = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));

/**
 * The task workspace: a large panel (almost the whole screen on a computer, the whole screen on a phone) with the task's overview, progress, the complete
 * work update history, the update requests and the activity timeline, and the actions this person may take. Everything comes from one database call that only
 * answers for people who may already read the task, and says what the signed-in person may do (update it, ask for an update, answer a request).
 */
export const TaskDetails: React.FC<{ taskId: string; onClose: () => void; onChanged?: () => void }> = ({ taskId, onClose, onChanged }) => {
  const [data, setData] = useState<TaskDetailsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<FormStatus | null>(null);
  const [respondId, setRespondId] = useState<string | null>(null);
  const [reqSignal, setReqSignal] = useState(0);
  const [newestFirst, setNewestFirst] = useState(false);
  const [starting, setStarting] = useState(false);
  // whether this person may delete the task (Team Lead who gave it, Department Head / Operations Head of its scope): the server decides
  const [deletion, setDeletion] = useState<TaskDeletePreview | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      // the Delete check never holds up the task itself: the details show at once, the button follows when the server answers
      void workTasksApi.deletePreview(taskId).then(setDeletion);
      setData(await workTasksApi.details(taskId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the task.');
    }
  }, [taskId]);
  useEffect(() => { void load(); }, [load]);

  // a real overlay: the page behind does not scroll, Escape closes, focus moves in and returns to the card
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    // Escape inside a confirmation dialog closes only that dialog
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[data-testid="app-dialog-layer"]') && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [onClose]);

  const changed = (message?: string) => {
    if (message) setNotice(message);
    setForm(null);
    setRespondId(null);
    notifyWorkUpdatesChanged();
    onChanged?.();
    void load();
  };

  const t = data?.task;
  const updates = useMemo(() => {
    const list = [...(data?.updates ?? [])]; // newest first from the database
    return newestFirst ? list : list.reverse();
  }, [data, newestFirst]);
  const latest = data?.updates[0];
  const expected = data?.updates.find(u => u.expectedCompletion)?.expectedCompletion ?? null;
  const rows = useMemo(() => timelineRows(data?.timeline ?? []), [data]);
  const respondable = data?.requests.find(r => r.status === 'PENDING' && r.canRespond) ?? null;
  const pending = data?.requests.find(r => r.status === 'PENDING') ?? null;

  const start = async () => {
    if (!t || starting) return;
    setStarting(true);
    setError(null);
    try {
      // the existing status update: Pending -> In progress, with no progress claimed beyond what is already recorded
      await workTasksApi.submitUpdate(t.id, { status: 'IN_PROGRESS', progress: t.progress, note: 'Started working on this task.' });
      changed('Task started. It is now In progress.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the task.');
    } finally {
      setStarting(false);
    }
  };
  const canDelete = !!deletion?.canDelete;
  const remove = async () => {
    if (!t || !deletion?.canDelete) return;
    const done = await confirmTaskDeletion({
      title: t.title, assigneeName: t.assignee?.name, status: STATUS_UI[t.status]?.label ?? t.status, dueDate: t.dueDate ? fmtDate(t.dueDate) : null,
      alsoRemoved: [countLine(deletion.subtasks, 'sub-task'), countLine(deletion.updates, 'progress update'), countLine(deletion.dailyReports, 'daily report')],
      run: () => workTasksApi.deleteTask(t.id)
    });
    if (!done) return;
    toast.success(`Task deleted: ${t.title}`);
    notifyWorkTasksChanged();
    notifyWorkUpdatesChanged();
    onChanged?.();
    onClose();
  };
  const openForm = (s: FormStatus) => { setForm(s); setNotice(null); goTo('ws-updates'); };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex md:items-center md:justify-center" role="presentation">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden="true" />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={t?.title ?? 'Task'} tabIndex={-1} data-testid="task-workspace"
        className="relative flex h-full w-full flex-col overflow-hidden bg-slate-50 outline-none md:h-[92vh] md:w-[94vw] md:max-w-[1500px] md:rounded-2xl md:shadow-2xl">
        {/* ---------------- header ---------------- */}
        <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-3.5 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {t && <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-600" title={t.id}>ID {t.id.slice(0, 8).toUpperCase()}</span>}
                {t && <StatusPill status={t.status} />}
                {t && <PriorityPill priority={t.priority} />}
                {t?.overdue && <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700"><AlertTriangle className="h-3 w-3" aria-hidden="true" /> Overdue</span>}
              </div>
              <h2 className="mt-1.5 break-words text-xl font-bold leading-snug text-slate-900 sm:text-2xl">{t?.title ?? 'Task'}</h2>
              {t && (
                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-600">
                  {t.assignee && (
                    <span className="inline-flex items-center gap-2">
                      <Avatar name={t.assignee.name} id={t.assignee.id} size="sm" />
                      <span><strong className="text-slate-900">{t.assignee.name}</strong>{[t.assignee.designation, t.assignee.team].filter(Boolean).length ? ` · ${[t.assignee.designation, t.assignee.team].filter(Boolean).join(' · ')}` : ''}</span>
                    </span>
                  )}
                  {t.assignedBy && <span>Assigned by <strong className="text-slate-900">{t.assignedBy.name}</strong></span>}
                  <span className={t.overdue ? 'font-semibold text-rose-700' : ''}><CalendarDays className="mr-1 inline h-3 w-3" aria-hidden="true" />Due {fmtDate(t.dueDate)}</span>
                </div>
              )}
            </div>
            <button type="button" onClick={onClose} aria-label="Close task" className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
          </div>
          {t && (
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
              <div className="flex min-w-[220px] flex-1 items-center gap-3">
                <div className="flex-1"><ProgressBar value={t.progress} label={`Progress of ${t.title}`} /></div>
                <span className="w-10 text-right text-sm font-bold text-slate-900">{t.progress}%</span>
              </div>
              <span className="text-[11px] text-slate-500">Latest update: <strong className="text-slate-700">{ago(t.lastUpdateAt)}</strong></span>
            </div>
          )}
        </header>

        {/* ---------------- body ---------------- */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6" data-testid="workspace-body">
          {error && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700" role="alert">
              <span>{error}</span>
              <button type="button" className={outline} onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again</button>
            </div>
          )}
          {!data && !error && <p className="py-10 text-center text-sm text-slate-500" role="status">Loading the task…</p>}
          {data && t && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="min-w-0 space-y-5">
                {notice && <p className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800" role="status"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {notice}</p>}

                <Section id="ws-overview" title="Task overview">
                  <Block label="Description" text={t.description} />
                  {!t.description && <p className="text-xs text-slate-500">No description was given.</p>}
                  {t.assignmentNote && <div className="mt-3"><Block label="Instructions" text={t.assignmentNote} /></div>}
                  <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3.5 border-t border-slate-100 pt-4 md:grid-cols-3">
                    <Fact label="Assigned to">{t.assignee ? <>{t.assignee.name}{t.assignee.designation ? <span className="block text-[11px] text-slate-500">{t.assignee.designation}</span> : null}</> : '-'}</Fact>
                    <Fact label="Assigned by">{t.assignedBy ? <>{t.assignedBy.name}{t.assignedBy.designation ? <span className="block text-[11px] text-slate-500">{t.assignedBy.designation}</span> : null}</> : '-'}</Fact>
                    <Fact label="Department">{[t.assignee?.department, t.assignee?.team].filter(Boolean).join(' · ') || '-'}</Fact>
                    <Fact label="Related customer">{t.customer ? <>{t.customer.name} <span className="font-mono text-[11px] text-slate-400">{t.customer.code}</span></> : '-'}</Fact>
                    <Fact label="Created">{fmtDate(t.createdAt)}</Fact>
                    <Fact label="Assigned">{fmtDate(data.timeline.find(e => e.kind === 'TASK_ASSIGNED')?.at ?? t.createdAt)}</Fact>
                    <Fact label="Due date"><span className={t.overdue ? 'font-semibold text-rose-700' : ''}>{fmtDate(t.dueDate)}</span></Fact>
                    <Fact label="Progress">{t.progress}%</Fact>
                    <Fact label="Latest update">{t.lastUpdateAt ? fmtDateTime(t.lastUpdateAt) : 'No update yet'}</Fact>
                  </dl>
                </Section>

                <Section title="Progress" hint="Taken from the updates the employee submitted, never estimated.">
                  <div className="flex items-center gap-3">
                    <div className="flex-1"><ProgressBar value={t.progress} label={`Current progress of ${t.title}`} /></div>
                    <span className="text-lg font-bold text-slate-900">{t.progress}%</span>
                  </div>
                  <dl className="mt-3.5 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
                    <Fact label="Current status"><StatusPill status={t.status} /></Fact>
                    <Fact label="Last progress update">{latest ? <>{fmtDateTime(latest.at)}<span className="block text-[11px] text-slate-500">{ago(latest.at)}</span></> : 'None yet'}</Fact>
                    <Fact label="Expected completion">{expected ? fmtDate(expected) : 'Not given'}</Fact>
                    <Fact label="Updates submitted">{data.updates.length}</Fact>
                  </dl>
                  {t.blocked && latest?.blockers && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900"><strong>Blocked:</strong> {latest.blockers}</p>}
                  {data.updates.length === 0 && <p className="mt-3 text-xs text-slate-500">No update has been submitted, so progress is still {t.progress}%.</p>}
                </Section>

                <Section id="ws-updates" title={`Work updates (${data.updates.length})`} hint="Every update is kept. Earlier ones are never changed."
                  aside={data.updates.length > 1 ? (
                    <button type="button" className={outline} onClick={() => setNewestFirst(v => !v)} aria-pressed={newestFirst}><ArrowDownUp className="h-3.5 w-3.5" aria-hidden="true" /> {newestFirst ? 'Newest first' : 'Oldest first'}</button>
                  ) : undefined}>
                  <div className="space-y-3">
                    {data.canUpdate && form && (
                      <WorkUpdateForm key={form} taskId={t.id} currentStatus={t.status} currentProgress={t.progress} initialStatus={form} onDone={changed} onCancel={() => setForm(null)} />
                    )}
                    {updates.length === 0 ? <p className="text-xs text-slate-500">No work update has been submitted yet.</p> : (
                      <ol className="space-y-2.5" aria-label="Work update history">{updates.map(u => <UpdateCard key={u.id} u={u} latest={u.id === latest?.id} />)}</ol>
                    )}
                  </div>
                </Section>

                <Section id="ws-requests" title={`Update requests (${data.requests.length})`} hint="Asked for by the Department Head or Team Lead."
                  aside={data.canRequest ? <RequestUpdate taskId={t.id} employeeName={t.assignee?.name} onDone={changed} openSignal={reqSignal} /> : undefined}>
                  {data.requests.length === 0 ? <p className="text-xs text-slate-500">No update has been requested on this task.</p> : (
                    <ul className="space-y-3">
                      {data.requests.map(r => (
                        <li key={r.id} id={`req-${r.id}`} className="rounded-xl border border-slate-200 bg-white p-3.5" data-testid="request-card">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <RequestStatusPill r={r} />
                            <span className="text-slate-600">Requested {fmtDateTime(r.createdAt)}{r.requestedByName ? ` by ${r.requestedByName}` : ''}{r.dueAt ? ` · reply by ${fmtDateTime(r.dueAt)}` : ''}</span>
                          </div>
                          {r.message && <p className="mt-1.5 whitespace-pre-line text-[13px] text-slate-700"><strong>Request:</strong> {r.message}</p>}
                          <ResponseDetails r={r} />
                          {r.canRespond && respondId !== r.id && (
                            <button type="button" className={`${primary} mt-3`} onClick={() => { setRespondId(r.id); goTo(`req-${r.id}`); }}>Respond to request</button>
                          )}
                          {r.canRespond && respondId === r.id && (
                            <div className="mt-3"><WorkUpdateForm taskId={t.id} currentStatus={t.status} currentProgress={t.progress} requestId={r.id} onDone={changed} onCancel={() => setRespondId(null)} /></div>
                          )}
                          {(r.canFollowUp || (r.status === 'PENDING' && data.canManage)) && <div className="mt-2.5"><FollowUpButton r={r} onDone={() => changed()} /></div>}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              </div>

              <aside className="min-w-0">
                <Section title="Activity timeline">
                  <ol className="space-y-3.5 border-l-2 border-slate-100 pl-4" aria-label="Activity timeline">
                    {rows.map(e => (
                      <li key={e.key} className="relative text-xs text-slate-600">
                        <span className={`absolute -left-[22px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white ${e.tone}`} aria-hidden="true" />
                        <span className="font-semibold text-slate-900">{e.label}</span>
                        {e.actor ? <span> · {e.actor}</span> : null}
                        <span className="block text-[11px] text-slate-400">{fmtDateTime(e.at)}</span>
                        {e.detail && <span className="block whitespace-pre-line break-words text-slate-500">{e.detail}</span>}
                      </li>
                    ))}
                  </ol>
                </Section>
              </aside>
            </div>
          )}
        </div>

        {/* ---------------- actions: only what this person may do ---------------- */}
        {data && t && (data.canUpdate || data.canRequest || respondable || (pending && data.canManage) || canDelete) && (
          <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6" aria-label="Task actions">
            <div className="flex flex-wrap items-center gap-2">
              {data.canUpdate && t.status === 'ASSIGNED' && (
                <button type="button" className={primary} disabled={starting} onClick={() => void start()}><Play className="h-3.5 w-3.5" aria-hidden="true" /> {starting ? 'Starting…' : 'Start task'}</button>
              )}
              {data.canUpdate && <button type="button" className={t.status === 'ASSIGNED' ? outline : primary} onClick={() => openForm('IN_PROGRESS')}>Update progress</button>}
              {data.canUpdate && t.status !== 'BLOCKED' && <button type="button" className={danger} onClick={() => openForm('BLOCKED')}><Flag className="h-3.5 w-3.5" aria-hidden="true" /> Mark as blocked</button>}
              {data.canUpdate && <button type="button" className={success} onClick={() => openForm('COMPLETED')}><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Submit completion</button>}
              {respondable && respondId !== respondable.id && <button type="button" className={outline} onClick={() => { setRespondId(respondable.id); goTo(`req-${respondable.id}`); }}>Respond to request</button>}
              {data.canRequest && <button type="button" className={primary} onClick={() => { setReqSignal(n => n + 1); goTo('ws-requests'); }}><Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> Request update</button>}
              {pending && data.canManage && pending.canFollowUp && <FollowUpButton r={pending} onDone={() => changed()} />}
              {canDelete && (
                <button type="button" className={`${destroy} sm:ml-auto`} onClick={() => void remove()} data-testid="task-delete">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete task
                </button>
              )}
            </div>
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
};
