import React, { useEffect, useState } from 'react';
import { BugReportSection } from '../issues/BugReport';
import { takePendingIssues, useOpenIssuesRequest } from '../issues/issueEvents';
import { EmployeeIssuesManagement } from './EmployeeIssuesManagement';

/**
 * HR dashboard > Raise an Issue (migration 20270128000200). Two sections, one recipient each:
 *  A. Report to Developer Team: HR's own issue to the developers (category, priority, the affected department / employee, files), its
 *     status and the developers' replies, and HR's follow-ups. The issues HR escalated from an employee issue are listed here too.
 *  B. Employee Issues – Received by HR: the existing Employee Issues workspace (filters, search, sorting, the conversation with the employee,
 *     status, close, and "Escalate to Developer Team").
 * The Super Admin reads section B; only an employee reports in section A (the database refuses anyone else).
 */
type Section = 'DEV' | 'EMPLOYEE';
const SECTIONS: { id: Section; label: string }[] = [{ id: 'EMPLOYEE', label: 'B. Employee Issues – Received by HR' }, { id: 'DEV', label: 'A. Report to Developer Team' }];

export const HrRaiseIssuePage: React.FC<{ canReport?: boolean }> = ({ canReport = true }) => {
  const [section, setSection] = useState<Section>(canReport ? 'DEV' : 'EMPLOYEE');
  const [openBug, setOpenBug] = useState<string | null>(null);
  // a notification about one of HR's issues to the Developer Team (a reply, a status) opens it in section A
  const take = () => { const p = takePendingIssues(); if (p?.kind === 'BUG' && canReport) { setSection('DEV'); setOpenBug(p.id ?? null); } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(take, []);
  useOpenIssuesRequest(React.useCallback(take, [canReport]));
  const shown = canReport ? [SECTIONS[1], SECTIONS[0]] : [SECTIONS[0]];
  return (
    <div className="space-y-5" data-testid="hr-raise-issue-page">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Raise an Issue</h1>
        <p className="text-sm text-slate-500 mt-0.5">Report a problem to the Developer Team, and handle the issues employees raised to HR.</p>
      </div>
      <div role="tablist" aria-label="Raise an Issue sections" className="flex flex-wrap gap-1 border-b border-slate-200">
        {shown.map(s => (
          <button key={s.id} type="button" role="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)} data-testid={`hr-section-${s.id}`}
            className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px ${section === s.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {s.label}
          </button>
        ))}
      </div>
      {section === 'DEV' && canReport ? <BugReportSection hr openId={openBug} /> : <EmployeeIssuesManagement embedded />}
    </div>
  );
};

export default HrRaiseIssuePage;
