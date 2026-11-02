import React from 'react';
import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import type { WorkReportContent, WorkReportTask } from '../../../shared/contracts';
import { REPORT_FIELDS, type ReportKind } from '../../../shared/reportFields';

/** A list of the member's tasks as they were when the report was saved. */
export const TaskList: React.FC<{ tasks: WorkReportTask[]; done?: boolean; empty: string }> = ({ tasks, done, empty }) => (
  tasks.length === 0 ? <p className="text-xs text-slate-500">{empty}</p> : (
    <ul className="space-y-1">
      {tasks.map(t => (
        <li key={t.id} className="flex items-start gap-1.5 text-sm text-slate-800">
          {done ? <CheckCircle2 className="w-3.5 h-3.5 mt-1 shrink-0 text-emerald-600" aria-hidden="true" /> : <Circle className="w-3.5 h-3.5 mt-1 shrink-0 text-slate-300" aria-hidden="true" />}
          <span className="break-words">{t.title}</span>
        </li>
      ))}
    </ul>
  )
);

/** The sections of a report that have text, in the order of the form, with the attachment links. */
export const ReportContentView: React.FC<{ kind: ReportKind; content: WorkReportContent; compact?: boolean }> = ({ kind, content, compact }) => {
  // the standard form has tasks and a short remark; reports written before it (long-form Team Lead / Department Head sections) still show theirs
  const sections = REPORT_FIELDS[kind].filter(f => f.key !== 'remarks' && (content[f.key as keyof WorkReportContent] as string | undefined)?.trim());
  const remarks = content.remarks?.trim();
  const links = content.attachments ?? [];
  const hasTasks = Array.isArray(content.assignedTasks) || Array.isArray(content.completedTasks);
  if (sections.length === 0 && links.length === 0 && !hasTasks && !remarks) return <p className="text-xs text-slate-500">This report has no written sections.</p>;
  return (
    <dl className={`grid gap-3 ${compact ? 'sm:grid-cols-2' : ''}`}>
      {hasTasks ? (
        <>
          <div className="rounded-xl bg-slate-50/80 px-3 py-2">
            <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Assigned tasks ({content.assignedTasks?.length ?? 0})</dt>
            <dd className="mt-1"><TaskList tasks={content.assignedTasks ?? []} empty="No assigned tasks." /></dd>
          </div>
          <div className="rounded-xl bg-slate-50/80 px-3 py-2">
            <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Completed tasks ({content.completedTasks?.length ?? 0})</dt>
            <dd className="mt-1"><TaskList tasks={content.completedTasks ?? []} done empty="No completed tasks." /></dd>
          </div>
        </>
      ) : null}
      {remarks ? (
        <div className="rounded-xl bg-slate-50/80 px-3 py-2 sm:col-span-2">
          <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Remarks / Work Summary</dt>
          <dd className="mt-1 text-sm text-slate-800 whitespace-pre-wrap break-words">{remarks}</dd>
        </div>
      ) : null}
      {sections.map(f => (
        <div key={f.key} className="rounded-xl bg-slate-50/80 px-3 py-2">
          <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{f.label}</dt>
          <dd className="mt-1 text-sm text-slate-800 whitespace-pre-wrap break-words">{content[f.key as keyof WorkReportContent] as string}</dd>
        </div>
      ))}
      {links.length > 0 ? (
        <div className="rounded-xl bg-slate-50/80 px-3 py-2 sm:col-span-2">
          <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Supporting attachments</dt>
          <dd className="mt-1 flex flex-col gap-1">
            {links.map((a, i) => (
              <a key={`${a.url}-${i}`} href={a.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 text-sm text-indigo-700 hover:underline break-all">
                <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {a.name || a.url}
              </a>
            ))}
          </dd>
        </div>
      ) : null}
    </dl>
  );
};

/** A plain-text copy of a report, for the download button. */
export function reportAsText(r: { title: string; author: string; designation: string | null; department: string | null; team: string | null; periodStart: string; periodEnd: string; status: string; reviewedBy: string | null; reviewComment: string | null; kind: ReportKind }, content: WorkReportContent): string {
  const lines = [r.title, '='.repeat(Math.min(r.title.length, 60)), `Author: ${r.author}${r.designation ? ` (${r.designation})` : ''}`,
    `Department: ${r.department ?? '-'}${r.team ? ` / ${r.team}` : ''}`, `Period: ${r.periodStart} to ${r.periodEnd}`, `Status: ${r.status}`];
  if (r.reviewedBy) lines.push(`Reviewed by: ${r.reviewedBy}`);
  if (r.reviewComment) lines.push(`Review comment: ${r.reviewComment}`);
  lines.push('');
  if (content.assignedTasks || content.completedTasks) {
    lines.push(`ASSIGNED TASKS (${content.assignedTasks?.length ?? 0})`, ...(content.assignedTasks ?? []).map(t => `- ${t.title}`), '');
    lines.push(`COMPLETED TASKS (${content.completedTasks?.length ?? 0})`, ...(content.completedTasks ?? []).map(t => `- ${t.title}`), '');
  }
  if (content.remarks?.trim()) lines.push('REMARKS / WORK SUMMARY', content.remarks.trim(), '');
  for (const f of REPORT_FIELDS[r.kind].filter(x => x.key !== 'remarks')) {
    const v = (content[f.key as keyof WorkReportContent] as string | undefined)?.trim();
    if (v) lines.push(f.label.toUpperCase(), v, '');
  }
  for (const a of content.attachments ?? []) lines.push(`Attachment: ${a.name || ''} ${a.url}`.trim());
  return lines.join('\n');
}
