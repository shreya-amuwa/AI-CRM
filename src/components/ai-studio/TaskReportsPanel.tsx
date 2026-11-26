import React from 'react';
import type { AiStudioTaskReportEntry } from '../../../shared/contracts';
import { aiStudioApi } from '../../lib/api/aiStudio';
import { WorkEntries } from './ReportWork';
import { ReportStatusBadge, dateText, useLoad } from './ui';

/**
 * In a task's window: the daily reports that mention this task, with only THIS task's part of each (20270216000100). The Team Lead who gave a
 * cross-team task sees the work reported on it here, without getting the rest of the employee's report.
 */
export const TaskReportsPanel: React.FC<{ taskId: string; onOpenReport?: (reportId: string) => void }> = ({ taskId, onOpenReport }) => {
  const { data, error } = useLoad<AiStudioTaskReportEntry[]>(() => aiStudioApi.taskReports(taskId), [taskId]);
  if (error || !Array.isArray(data) || data.length === 0) return null;
  return (
    <div data-testid="task-reports">
      <h3 className="text-sm font-extrabold text-slate-900 mb-2">Reported in daily reports</h3>
      <ul className="space-y-3">
        {data.map(r => (
          <li key={r.reportId} className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-slate-800">{dateText(r.reportDate)} · {r.authorName}</span>
              <ReportStatusBadge status={r.status} />
              {r.canOpen && onOpenReport && <button type="button" className="text-xs font-bold text-blue-700 hover:underline" onClick={() => onOpenReport(r.reportId)}>Open report</button>}
            </div>
            {r.entries.length > 0 ? <WorkEntries entries={r.entries} showDate /> : <p className="text-xs text-slate-500">Reported without a recorded update for that day.</p>}
          </li>
        ))}
      </ul>
    </div>
  );
};
