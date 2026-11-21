import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, Users } from 'lucide-react';
import { SideDrawer } from '../common/SideDrawer';
import { workTasksApi, type TaskDetailsData, type TaskTimelineItem, type TaskUpdateRecord } from '../../lib/workTasks';
import { notifyWorkUpdatesChanged } from '../../lib/workUpdates';
import { fmtDate, fmtDateTime, PriorityPill, ProgressBar, StatusPill } from './TaskParts';
import { Avatar } from './PeoplePicker';
import { FollowUpButton, RequestStatusPill, RequestUpdate, ResponseDetails } from './WorkUpdates';
import { WorkUpdateForm } from './WorkUpdateForm';
import { ago } from './taskView';

type Tab = 'OVERVIEW' | 'PROGRESS' | 'REQUESTS' | 'TIMELINE';
const TABS: [Tab, string][] = [['OVERVIEW', 'Overview'], ['PROGRESS', 'Work Progress'], ['REQUESTS', 'Update Requests'], ['TIMELINE', 'Activity Timeline']];

const TIMELINE_LABEL: Record<TaskTimelineItem['kind'], string> = {
  TASK_CREATED: 'Task created',
  TASK_ASSIGNED: 'Task assigned',
  PROGRESS_UPDATE: 'Progress update',
  WORK_UPDATE_REQUESTED: 'Update requested',
  WORK_UPDATE_FOLLOW_UP: 'Reminder sent',
  WORK_UPDATE_RESPONDED: 'Employee responded'
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-0.5 text-xs text-slate-800">{children}</dd>
  </div>
);

const Block: React.FC<{ label: string; text: string | null; tone?: string }> = ({ label, text, tone }) =>
  text ? (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <p className={`text-xs whitespace-pre-line break-words ${tone ?? 'text-slate-800'}`}>{text}</p>
    </div>
  ) : null;

/** One entry of the task's history: every update the employee sent, newest first. Nothing in it is edited or removed. */
const UpdateCard: React.FC<{ u: TaskUpdateRecord }> = ({ u }) => (
  <li className="rounded-xl border border-slate-200 bg-white p-3 space-y-2" data-testid="update-record">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-slate-900">{u.authorName ?? 'Unknown'}</span>
      <StatusPill status={u.status} />
      <span className="text-xs font-bold text-slate-700">{u.progress}%</span>
      <span className="text-[11px] text-slate-400">{fmtDateTime(u.at)}</span>
      {u.requestId && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">Answers a request</span>}
    </div>
    <ProgressBar value={u.progress} label={`Progress ${u.progress}%`} />
    <Block label="Work completed" text={u.workCompleted} />
    <Block label="Remaining work" text={u.remainingWork} />
    <Block label="Blockers" text={u.blockers} tone="text-rose-700" />
    <Block label="Next steps" text={u.nextSteps} />
    <Block label="Note" text={u.workCompleted || u.remainingWork || u.blockers || u.nextSteps ? null : u.note} />
    {u.expectedCompletion && <p className="text-[11px] text-slate-600">Expected completion: <strong>{fmtDate(u.expectedCompletion)}</strong></p>}
  </li>
);

/**
 * One task in full, in a side panel: Overview, Work Progress, Update Requests and the Activity Timeline. The data comes from one database call that
 * only answers for people who may already see the task, and says what the signed-in person may do here (update it, ask for an update).
 */
export const TaskDetails: React.FC<{ taskId: string; onClose: () => void; onChanged?: () => void; initialTab?: Tab }> = ({ taskId, onClose, onChanged, initialTab = 'OVERVIEW' }) => {
  const [data, setData] = useState<TaskDetailsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await workTasksApi.details(taskId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the task.');
    }
  }, [taskId]);
  useEffect(() => { void load(); }, [load]);

  const changed = (message?: string) => {
    if (message) setNotice(message);
    setShowForm(false);
    notifyWorkUpdatesChanged();
    onChanged?.();
    void load();
  };

  const t = data?.task;
  const open = data?.requests.filter(r => r.status === 'PENDING').length ?? 0;
  return (
    <SideDrawer title={t?.title ?? 'Task'} subtitle={t ? `${t.assignee?.name ?? 'Unassigned'}${t.assignedBy ? ` · assigned by ${t.assignedBy.name}` : ''}` : undefined} onClose={onClose}>
      <div className="flex min-h-full flex-col" data-testid="task-details">
        {error && <p className="m-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700" role="alert">{error}</p>}
        {!data && !error && <p className="p-5 text-xs text-slate-500">Loading…</p>}
        {data && t && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
              <StatusPill status={t.status} />
              {t.overdue && <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700"><AlertTriangle className="h-3 w-3" aria-hidden="true" /> Overdue</span>}
              <PriorityPill priority={t.priority} />
              <span className="ml-auto text-xs font-bold text-slate-700">{t.progress}%</span>
            </div>
            <div role="tablist" aria-label="Task sections" className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 pt-2">
              {TABS.map(([id, label]) => (
                <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-xs font-bold ${tab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                  {label}{id === 'REQUESTS' && open ? ` (${open})` : id === 'PROGRESS' ? ` (${data.updates.length})` : ''}
                </button>
              ))}
            </div>
            <div className="flex-1 space-y-4 p-5">
              {notice && <p className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800" role="status"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {notice}</p>}

              {tab === 'OVERVIEW' && (
                <div className="space-y-4" role="tabpanel" aria-label="Overview">
                  <div><ProgressBar value={t.progress} label={`Progress of ${t.title}`} /></div>
                  {t.description && <Block label="Description" text={t.description} />}
                  {t.assignmentNote && <Block label="Instructions" text={t.assignmentNote} />}
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Field label="Assigned to">
                      {t.assignee ? (
                        <span className="flex items-center gap-2"><Avatar name={t.assignee.name} id={t.assignee.id} size="sm" /><span><span className="block font-semibold">{t.assignee.name}</span>
                          <span className="block text-[11px] text-slate-500">{[t.assignee.designation, t.assignee.team, t.assignee.department].filter(Boolean).join(' · ')}</span></span></span>
                      ) : '-'}
                    </Field>
                    <Field label="Assigned by">{t.assignedBy ? <>{t.assignedBy.name}{t.assignedBy.designation ? <span className="block text-[11px] text-slate-500">{t.assignedBy.designation}</span> : null}</> : '-'}</Field>
                    <Field label="Due date"><span className={t.overdue ? 'font-semibold text-rose-700' : ''}><CalendarDays className="mr-1 inline h-3 w-3" aria-hidden="true" />{fmtDate(t.dueDate)}</span></Field>
                    <Field label="Created">{fmtDate(t.createdAt)}</Field>
                    <Field label="Latest update"><Clock3 className="mr-1 inline h-3 w-3" aria-hidden="true" />{ago(t.lastUpdateAt)}</Field>
                    <Field label="Completed">{t.completedAt ? fmtDate(t.completedAt) : '-'}</Field>
                    {t.customer && <Field label="Related customer">{t.customer.name} <span className="font-mono text-slate-400">{t.customer.code}</span></Field>}
                  </dl>
                  {t.lastUpdateNote && <Block label="Last update" text={t.lastUpdateNote} />}
                  {t.blocked && data.updates[0]?.blockers && <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900"><strong>Blocked:</strong> {data.updates[0].blockers}</p>}
                  <div className="flex flex-wrap items-start gap-2 border-t border-slate-100 pt-4">
                    {data.canUpdate && !showForm && (
                      <button type="button" onClick={() => { setShowForm(true); setTab('PROGRESS'); }} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700">Submit work update</button>
                    )}
                    {data.canRequest && <RequestUpdate taskId={t.id} employeeName={t.assignee?.name} onDone={changed} />}
                    {!data.canUpdate && !data.canRequest && <p className="text-[11px] text-slate-500"><Users className="mr-1 inline h-3 w-3" aria-hidden="true" />You can follow this task here.</p>}
                  </div>
                </div>
              )}

              {tab === 'PROGRESS' && (
                <div className="space-y-3" role="tabpanel" aria-label="Work Progress">
                  {data.canUpdate && (showForm || data.updates.length === 0) && (
                    <WorkUpdateForm taskId={t.id} currentStatus={t.status} currentProgress={t.progress} onDone={changed} onCancel={data.updates.length ? () => setShowForm(false) : undefined} />
                  )}
                  {data.canUpdate && !showForm && data.updates.length > 0 && (
                    <button type="button" onClick={() => setShowForm(true)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700">Submit work update</button>
                  )}
                  {data.updates.length === 0 ? <p className="text-xs text-slate-500">No work update has been submitted yet.</p> : (
                    <ol className="space-y-2.5" aria-label="Work update history">{data.updates.map(u => <UpdateCard key={u.id} u={u} />)}</ol>
                  )}
                </div>
              )}

              {tab === 'REQUESTS' && (
                <div className="space-y-3" role="tabpanel" aria-label="Update Requests">
                  {data.canRequest && <RequestUpdate taskId={t.id} employeeName={t.assignee?.name} onDone={changed} />}
                  {data.requests.length === 0 ? <p className="text-xs text-slate-500">No update has been requested on this task.</p> : data.requests.map(r => (
                    <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3" data-testid="request-card">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <RequestStatusPill r={r} />
                        <span className="text-slate-600">Requested {fmtDateTime(r.createdAt)}{r.requestedByName ? ` by ${r.requestedByName}` : ''}{r.dueAt ? ` · reply by ${fmtDateTime(r.dueAt)}` : ''}</span>
                      </div>
                      {r.message && <p className="mt-1.5 whitespace-pre-line text-xs text-slate-700"><strong>Request:</strong> {r.message}</p>}
                      <ResponseDetails r={r} />
                      {r.canRespond && (
                        <div className="mt-3"><WorkUpdateForm taskId={t.id} currentStatus={t.status} currentProgress={t.progress} requestId={r.id} onDone={changed} /></div>
                      )}
                      {(r.canFollowUp || (r.status === 'PENDING' && data.canManage)) && <div className="mt-2"><FollowUpButton r={r} onDone={() => changed()} /></div>}
                    </div>
                  ))}
                </div>
              )}

              {tab === 'TIMELINE' && (
                <ol className="space-y-3 border-l-2 border-slate-100 pl-4" role="tabpanel" aria-label="Activity Timeline">
                  {data.timeline.map((e, i) => (
                    <li key={i} className="relative text-xs text-slate-600">
                      <span className="absolute -left-[22px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-blue-500" aria-hidden="true" />
                      <span className="font-semibold text-slate-900">{TIMELINE_LABEL[e.kind]}</span>
                      {e.actorName ? ` · ${e.actorName}` : ''}
                      {e.kind === 'TASK_ASSIGNED' && e.data?.assignee ? ` · to ${String(e.data.assignee)}` : ''}
                      {e.kind === 'PROGRESS_UPDATE' && e.data?.progress !== undefined ? ` · ${String(e.data.progress)}%${e.data?.status ? ` · ${String(e.data.status).replace('_', ' ').toLowerCase()}` : ''}` : ''}
                      <span className="block text-[11px] text-slate-400">{fmtDateTime(e.at)}</span>
                      {e.note && <span className="block whitespace-pre-line text-slate-500">{e.note.length > 280 ? `${e.note.slice(0, 280)}…` : e.note}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </div>
    </SideDrawer>
  );
};

