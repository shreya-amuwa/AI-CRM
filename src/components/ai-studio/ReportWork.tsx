import React from 'react';
import { ExternalLink, GitBranch } from 'lucide-react';
import type { AiStudioReportWorkEntry, AiStudioReportWorkSummary, AiStudioReportWorkTask } from '../../../shared/contracts';
import { TaskStatusBadge, dateText, dateTimeText } from './ui';
import { Paged } from '../common/Paged';

/**
 * The work of a consolidated daily report (20270219000100), read straight from the tasks' history: nothing here is typed again or copied.
 * Shown in the report form (the preview), in the report window (Team Lead, Department Head) and in a task's window (its own part only).
 * Everything is read-only: a correction is made on the task itself ("Open task").
 */

const timeText = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** Only http(s) links are kept by the database; this is a second check before a link becomes clickable. */
const safeLink = (url: string) => /^https?:\/\/[^\s]+$/i.test(url);
const linkLabel = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname !== '/' ? u.pathname : ''}`.slice(0, 80);
  } catch { return url; }
};

export const LinkList: React.FC<{ links: string[] }> = ({ links }) => {
  const shown = Array.from(new Set(links.filter(safeLink)));
  if (shown.length === 0) return null;
  return (
    <ul className="space-y-1" aria-label="Submitted links">
      {shown.map(l => (
        <li key={l} className="flex items-center gap-1.5 text-sm min-w-0">
          {/github\.com/i.test(l) ? <GitBranch className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" /> : <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />}
          <a href={l} target="_blank" rel="noopener noreferrer nofollow" className="text-blue-700 hover:underline truncate" title={l}>{linkLabel(l)}</a>
        </li>
      ))}
    </ul>
  );
};

export const WorkEntries: React.FC<{ entries: AiStudioReportWorkEntry[]; showDate?: boolean }> = ({ entries, showDate }) => (
  <Paged items={entries} noun="entries">{rows => (
  <ol className="space-y-2" aria-label="Work updates">
    {rows.map(e => (
      <li key={e.id} className="border-l-2 border-slate-200 pl-3">
        <div className="text-xs text-slate-500">
          {showDate ? dateTimeText(e.at) : timeText(e.at)} · {e.status === 'COMPLETED' ? 'Completed' : e.status === 'ON_HOLD' ? 'On hold' : 'In progress'} · {e.progress}%
        </div>
        {e.note ? <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{e.note}</p> : <p className="text-sm text-slate-400">No note</p>}
      </li>
    ))}
  </ol>
  )}</Paged>
);

const TaskBlock: React.FC<{ t: AiStudioReportWorkTask; frozen?: boolean; onOpenTask?: (taskId: string) => void }> = ({ t, frozen, onOpenTask }) => {
  const completedNote = t.completedAt ? t.entries.filter(e => e.status === 'COMPLETED').slice(-1)[0] : undefined;
  const otherEntries = completedNote ? t.entries.filter(e => e.id !== completedNote.id) : t.entries;
  const onHold = t.entries.filter(e => e.status === 'ON_HOLD');
  return (
    <details open className="group rounded-xl border border-slate-200 bg-white" data-testid="report-task">
      <summary className="flex flex-wrap items-center gap-2 px-4 py-3 cursor-pointer list-none">
        <span className="font-bold text-slate-900 break-words min-w-0">{t.title}</span>
        <TaskStatusBadge status={t.status} />
        <span className="text-xs font-semibold text-slate-600">{t.progressBefore != null && t.progressBefore !== t.progress ? `${t.progressBefore}% → ${t.progress}%` : `${t.progress}%`}</span>
        {t.crossTeam && <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">Cross-team</span>}
      </summary>
      <div className="px-4 pb-4 space-y-3 text-sm">
        <div className="text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
          <span>Assigned by {t.assignedByName ?? '-'} · {dateText(t.assignedAt)}</span>
          {t.dueDate && <span>Deadline {dateText(t.dueDate)}</span>}
          {t.completedAt && <span className="text-emerald-700 font-semibold">Completed {dateTimeText(t.completedAt)}</span>}
          {frozen && t.currentProgress !== t.progress && <span>Now {t.currentProgress}% (after this report)</span>}
        </div>
        {t.noUpdate ? (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800 flex flex-wrap items-center gap-2" role="note">
            <span>No work update has been recorded for this task on the selected reporting date.</span>
            {onOpenTask && <button type="button" className="font-bold underline" onClick={() => onOpenTask(t.taskId)}>Open task</button>}
          </div>
        ) : (
          <>
            {completedNote && (
              <div>
                <div className="text-xs font-semibold text-slate-500 mb-1">Completion details</div>
                <p className="text-slate-800 whitespace-pre-wrap break-words" data-testid="completion-details">{completedNote.note}</p>
              </div>
            )}
            {otherEntries.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-slate-500 mb-1">Work updates</div>
                <WorkEntries entries={otherEntries} />
              </div>
            )}
            {onHold.length > 0 && <p className="text-xs font-semibold text-amber-700">Blocker: the task was put on hold ({onHold.length === 1 ? 'see the update above' : `${onHold.length} updates`}).</p>}
          </>
        )}
        {t.links.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-1">Submitted links</div>
            <LinkList links={t.links} />
          </div>
        )}
        {onOpenTask && !t.noUpdate && <button type="button" className="text-xs font-bold text-blue-700 hover:underline" onClick={() => onOpenTask(t.taskId)}>Open original task</button>}
      </div>
    </details>
  );
};

/** The tasks grouped by project, then by task (the order the person picked them within a project). */
export const ReportWorkView: React.FC<{ work: AiStudioReportWorkTask[]; frozen?: boolean; onOpenTask?: (taskId: string) => void }> = ({ work, frozen, onOpenTask }) => {
  const groups: { projectId: string; projectName: string; tasks: AiStudioReportWorkTask[] }[] = [];
  for (const t of work) {
    const g = groups.find(x => x.projectId === t.projectId);
    if (g) g.tasks.push(t);
    else groups.push({ projectId: t.projectId, projectName: t.projectName, tasks: [t] });
  }
  return (
    <div className="space-y-4" data-testid="report-work">
      {groups.map((g, i) => (
        <section key={g.projectId} aria-label={`Project ${g.projectName}`} className="space-y-2">
          <h4 className="text-xs font-extrabold uppercase tracking-[0.05em] text-slate-500">Project {i + 1} · {g.projectName}</h4>
          {g.tasks.map(t => <TaskBlock key={t.taskId} t={t} frozen={frozen} onOpenTask={onOpenTask} />)}
        </section>
      ))}
    </div>
  );
};

export const WorkSummary: React.FC<{ s: AiStudioReportWorkSummary }> = ({ s }) => {
  const items: [string, number][] = [['Projects', s.projects], ['Tasks', s.tasks], ['Completed', s.completed], ['In progress', s.inProgress], ['Cross-team', s.crossTeam], ['Work updates', s.updates], ['Linked resources', s.links]];
  return (
    <dl className="grid grid-cols-3 sm:grid-cols-7 gap-2" data-testid="report-summary">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-lg border border-slate-200 px-2.5 py-2">
          <dt className="text-[11px] text-slate-500">{k}</dt>
          <dd className="text-base font-extrabold text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
};
