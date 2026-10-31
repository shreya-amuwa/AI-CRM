import React, { useCallback, useEffect, useState } from 'react';
import type { ReportContext, WorkReportDetail } from '../../../shared/contracts';
import type { ReportKind } from '../../../shared/reportFields';
import { ApiError } from '../../lib/api/client';
import { workReportsApi } from '../../lib/api/workReports';
import { ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { DepartmentReports } from './DepartmentReports';
import { MyReports } from './MyReports';
import { OperationsReports } from './OperationsReports';
import { ReportDetailDialog } from './ReportDetailDialog';
import { ReportForm } from './ReportForm';
import { OPEN_REPORTS_EVENT, notifyReportsChanged, takePendingReport } from './reportEvents';
import { ReviewInbox } from './ReviewInbox';
import { TeamCollectiveBox } from './TeamLeadReports';
import { Tabs } from './reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

const SUBTITLE: Record<ReportContext['level'], string> = {
  MEMBER: 'Write your report and send it to your Team Lead.',
  TEAM_LEAD: 'Review your team\'s reports and send your own to your Department Head.',
  DEPARTMENT_HEAD: 'See every Team Lead\'s box, add your own report and send the department package to the Operations Head.',
  OPERATIONS_HEAD: 'Open a department to follow the whole chain: Department Head, Team Leads and Team Members.',
  SUPER_ADMIN: 'Every department\'s reports, from the Department Head down to each Team Member.'
};

/**
 * The Reports page, one for every dashboard in the reporting chain. What it shows follows the person's place in the chain (the database
 * says which: nothing here trusts a role chosen in the browser):
 *   Team Member: submit a report, my reports.
 *   Team Lead: the team's reports (to review) with the team box, and my own individual report.
 *   Department Head: the Team Lead boxes and the consolidated package, and my own individual report.
 *   Operations Head: one box per department, opening down to every Team Member.
 */
const ReportsWorkspace: React.FC = () => {
  const [ctx, setCtx] = useState<ReportContext | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorkReportDetail | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [banner, setBanner] = useState('');

  const loadCtx = useCallback(() => {
    setError('');
    workReportsApi.context().then(c => { setCtx(c); setTab(t => t || (c.level === 'MEMBER' ? 'submit' : c.level === 'OPERATIONS_HEAD' || c.level === 'SUPER_ADMIN' ? 'departments' : 'team')); }, e => setError(errText(e)));
  }, []);
  useEffect(loadCtx, [loadCtx]);

  // a notification can ask for one report, whether the page is already open or not
  useEffect(() => {
    const take = () => { const id = takePendingReport(); if (id) setOpenId(id); };
    take();
    window.addEventListener(OPEN_REPORTS_EVENT, take);
    return () => window.removeEventListener(OPEN_REPORTS_EVENT, take);
  }, []);

  const changed = useCallback(() => { setReloadKey(k => k + 1); notifyReportsChanged(); loadCtx(); }, [loadCtx]);
  const mineTab = ctx?.level === 'MEMBER' ? 'mine' : 'own';
  const formTab = ctx?.level === 'MEMBER' ? 'submit' : 'own';

  const startEdit = (id: string) => {
    workReportsApi.get(id).then(r => { setEditing(r); setFormKey(k => k + 1); setBanner(''); setTab(formTab); }, e => setBanner(errText(e)));
  };
  const onFormDone = (r: WorkReportDetail, submitted: boolean) => {
    setReloadKey(k => k + 1);
    loadCtx();
    if (submitted) {
      setEditing(null);
      setFormKey(k => k + 1);
      setBanner(`"${r.title}" was submitted${ctx?.reportsTo.length ? ` to ${ctx.reportsTo.map(x => x.name).join(', ')}` : ''}.`);
      if (ctx?.level === 'MEMBER') setTab('mine');
    } else {
      setEditing(r);
      setBanner('');
    }
  };

  if (error) return <div className="p-6"><ErrorBanner message={error} onRetry={loadCtx} /></div>;
  if (!ctx) return <Spinner />;

  const kind: ReportKind | null = ctx.level === 'MEMBER' ? 'MEMBER' : ctx.level === 'TEAM_LEAD' ? 'TEAM_LEAD' : ctx.level === 'DEPARTMENT_HEAD' ? 'DEPARTMENT_HEAD' : null;
  const reportsTo = ctx.reportsTo.map(r => r.name);
  const tabs =
    ctx.level === 'MEMBER' ? [{ id: 'submit', label: 'Submit report' }, { id: 'mine', label: 'My reports', badge: ctx.needsRevision }]
    : ctx.level === 'TEAM_LEAD' ? [{ id: 'team', label: 'Team member reports', badge: ctx.pendingReview }, { id: 'own', label: 'My individual report', badge: ctx.needsRevision }]
    : ctx.level === 'DEPARTMENT_HEAD' ? [{ id: 'team', label: 'Team reports', badge: ctx.pendingReview }, { id: 'own', label: 'My individual report', badge: ctx.needsRevision }]
    : [{ id: 'departments', label: 'Department reports', badge: ctx.pendingReview }];

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-6xl mx-auto" data-testid="reports-workspace">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500">{SUBTITLE[ctx.level]}</p>
      </header>
      <Tabs tabs={tabs} value={tab} onChange={t => { setTab(t); setBanner(''); }} />
      {banner ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{banner}</div> : null}

      {tab === formTab && kind ? (
        <div className="space-y-4">
          <ReportForm key={`${kind}-${formKey}`} kind={kind} reportsTo={reportsTo} initial={editing} onDone={onFormDone} onCancel={editing ? () => { setEditing(null); setFormKey(k => k + 1); } : undefined} />
          {ctx.level !== 'MEMBER' ? <MyReports reportsTo={reportsTo} reloadKey={reloadKey} onOpen={setOpenId} onEdit={startEdit} /> : null}
        </div>
      ) : null}
      {tab === mineTab && ctx.level === 'MEMBER' ? <MyReports reportsTo={reportsTo} reloadKey={reloadKey} onOpen={setOpenId} onEdit={startEdit} /> : null}

      {tab === 'team' && ctx.level === 'TEAM_LEAD' ? (
        <div className="space-y-4">
          <ReviewInbox title="Team member reports" emptyText="No team member report is waiting for you." reloadKey={reloadKey} onOpen={setOpenId} />
          <TeamCollectiveBox reloadKey={reloadKey} onOpen={setOpenId} />
        </div>
      ) : null}
      {tab === 'team' && ctx.level === 'DEPARTMENT_HEAD' ? <DepartmentReports reloadKey={reloadKey} onOpen={setOpenId} /> : null}
      {tab === 'departments' && (ctx.level === 'OPERATIONS_HEAD' || ctx.level === 'SUPER_ADMIN') ? <OperationsReports reloadKey={reloadKey} onOpen={setOpenId} /> : null}

      {openId ? (
        <ReportDetailDialog
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={changed}
          onEdit={r => { setOpenId(null); setEditing(r); setFormKey(k => k + 1); setTab(formTab); }}
        />
      ) : null}
    </div>
  );
};

export default ReportsWorkspace;
