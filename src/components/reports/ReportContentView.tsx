import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { WorkReportContent } from '../../../shared/contracts';
import { REPORT_FIELDS, type ReportKind } from '../../../shared/reportFields';

/** The sections of a report that have text, in the order of the form, with the attachment links. */
export const ReportContentView: React.FC<{ kind: ReportKind; content: WorkReportContent; compact?: boolean }> = ({ kind, content, compact }) => {
  const sections = REPORT_FIELDS[kind].filter(f => (content[f.key as keyof WorkReportContent] as string | undefined)?.trim());
  const links = content.attachments ?? [];
  if (sections.length === 0 && links.length === 0) return <p className="text-xs text-slate-500">This report has no written sections.</p>;
  return (
    <dl className={`grid gap-3 ${compact ? 'sm:grid-cols-2' : ''}`}>
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
  for (const f of REPORT_FIELDS[r.kind]) {
    const v = (content[f.key as keyof WorkReportContent] as string | undefined)?.trim();
    if (v) lines.push(f.label.toUpperCase(), v, '');
  }
  for (const a of content.attachments ?? []) lines.push(`Attachment: ${a.name || ''} ${a.url}`.trim());
  return lines.join('\n');
}
