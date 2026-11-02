import React, { useCallback, useEffect, useState } from 'react';
import type { ReportContext, WorkReportDetail } from '../../../shared/contracts';
import type { ReportKind } from '../../../shared/reportFields';
import { ApiError } from '../../lib/api/client';
import { workReportsApi } from '../../lib/api/workReports';
import { ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { DailyReportForm } from './DailyReportForm';
import { DailySummary } from './DailySummary';
import { DepartmentReports } from './DepartmentReports';
import { MemberApprovals } from './MemberApprovals';
import { MyReports } from './MyReports';
import { OperationsReports, ReportingOverview } from './OperationsReports';
import { ReportDetailDialog } from './ReportDetailDialog';
import { WeeklyApprovals } from './WeeklyApprovals';
import { WeeklyDepartmentReport } from './WeeklyDepartmentReport';
import { OPEN_REPORTS_EVENT, notifyReportsChanged, takePendingReport, useReportsLive } from './reportEvents';
import { ReviewInbox } from './ReviewInbox';
import { TeamCollectiveBox } from './TeamLeadReports';
import { Tabs } from './reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

const SUBTITLE: Record<ReportContext['level'], string> = {
  MEMBER: 'Report your tasks each day. Your Team Lead and then your Department Head approve it.',
  TEAM_LEAD: 'Approve your team\'s daily reports and send your own to your Department Head.',
  DEPARTMENT_HEAD: 'Approve the daily reports your Team Leads passed on, follow every team and send the weekly report to the Operations Head.',
  OPERATIONS_HEAD: 'Review the weekly department reports and open a department down to every Team Member.',
  SUPER_ADMIN: 'Every department\'s reports, from the Department Head down to each Team Member.'
};

/**
 * The Reports page, one for every dashboard in the reporting chain. What it shows follows the person's place in the chain (the database
 * says which: nothing here trusts a role chosen in the browser):
 *   Team Member: submit report, my reports.
 *   Team Lead: team member reports (first approval), my individual report.
 *   Department Head: team reports (a box per Team Lead and the package), pending approvals (second approval of Team Member reports,
 *   and the Team Leads' own reports), my individual report.
 *   Operations Head: one box per department, opening down to every Team Member.
 * Every form is the same standard daily form (DailyReportForm); the weekly cycle (Department Head -> Operations Head) has its own tabs.
 * Everything refreshes by itself when a report changes (useReportsLive): only the section on screen is read again.
 */
const ReportsWorkspace: React.FC = () => {
  const [ctx, setCtx] = useState<ReportContext | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [liveKey, setLiveKey] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  // the report dialog without Download and History (a Team Lead's own submission screen)
  const [openSimple, setOpenSimple] = useState(false);
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
    const take = () => { const id = takePendingReport(); if (id) { setOpenSimple(false); setOpenId(id); } };
    take();
    window.addEventListener(OPEN_REPORTS_EVENT, take);
    return () => window.removeEventListener(OPEN_REPORTS_EVENT, take);
  }, []);

  // a report changed for this person (submitted, approved, sent back...): read the section on screen and the counts again
  useReportsLive(useCallback(() => { setLiveKey(k => k + 1); loadCtx(); }, [loadCtx]));
  const refresh = reloadKey + liveKey;
  const openReport = (id: string) => { setOpenSimple(false); setOpenId(id); };
  const openOwn = (id: string) => { setOpenSimple(true); setOpenId(id); };

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
      setBanner(`"${r.title}" was submitted${ctx?.reportsTo.length ? ` to ${ctx.reportsTo.map(x => x.name).join(', ')}` : ''}.${ctx?.level === 'MEMBER' ? ' It is now Pending Team Lead Approval.' : ''}`);
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
    ctx.level === 'MEMBER' ? [{ id: 'submit', label: 'Submit Daily Report' }, { id: 'mine', label: 'My Reports', badge: ctx.needsRevision }]
    : ctx.level === 'TEAM_LEAD' ? [{ id: 'team', label: 'Team Member Reports', badge: ctx.pendingReview }, { id: 'own', label: 'My Daily Report', badge: ctx.needsRevision }, { id: 'overview', label: 'Team Reporting Overview' }]
    : ctx.level === 'DEPARTMENT_HEAD' ? [{ id: 'team', label: 'Team Reports' }, { id: 'approvals', label: 'Pending Approvals', badge: ctx.pendingReview }, { id: 'own', label: 'My Daily Report', badge: ctx.needsRevision },
        { id: 'summary', label: 'Daily Department Summary' }, { id: 'weekly', label: 'Weekly Department Report', badge: ctx.weeklyPending }]
    : [{ id: 'departments', label: 'Department Reports' }, { id: 'weeklyApprovals', label: 'Weekly Approvals', badge: ctx.level === 'OPERATIONS_HEAD' ? ctx.weeklyPending : 0 }, { id: 'overview', label: 'Reporting Overview' }];

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
          <DailyReportForm key={`${kind}-${formKey}`} kind={kind} reportsTo={reportsTo} initial={editing} onDone={onFormDone} onCancel={editing ? () => { setEditing(null); setFormKey(k => k + 1); } : undefined} />
          {ctx.level !== 'MEMBER' ? <MyReports reportsTo={reportsTo} reloadKey={refresh} onOpen={ctx.level === 'TEAM_LEAD' ? openOwn : openReport} onEdit={startEdit} kind={kind} /> : null}
        </div>
      ) : null}
      {tab === mineTab && ctx.level === 'MEMBER' ? <MyReports reportsTo={reportsTo} reloadKey={refresh} onOpen={openReport} onEdit={startEdit} kind="MEMBER" /> : null}

      {tab === 'team' && ctx.level === 'TEAM_LEAD' ? <ReviewInbox member title="Team Member daily reports" emptyText="No team member report is waiting for your approval." reloadKey={refresh} onOpen={openReport} /> : null}
      {tab === 'overview' && ctx.level === 'TEAM_LEAD' ? <TeamCollectiveBox reloadKey={refresh} onOpen={openReport} /> : null}
      {tab === 'summary' && ctx.level === 'DEPARTMENT_HEAD' ? <DailySummary reloadKey={refresh} /> : null}
      {tab === 'weekly' && ctx.level === 'DEPARTMENT_HEAD' ? <WeeklyDepartmentReport reloadKey={refresh} /> : null}
      {tab === 'team' && ctx.level === 'DEPARTMENT_HEAD' ? <DepartmentReports reloadKey={refresh} onOpen={openReport} /> : null}
      {tab === 'approvals' && ctx.level === 'DEPARTMENT_HEAD' ? (
        <div className="space-y-4">
          <MemberApprovals reloadKey={refresh} onOpen={openReport} />
          <ReviewInbox title="Team Lead reports" emptyText="No Team Lead report is waiting for you." reloadKey={refresh} onOpen={openReport} />
        </div>
      ) : null}
      {tab === 'departments' && (ctx.level === 'OPERATIONS_HEAD' || ctx.level === 'SUPER_ADMIN') ? <OperationsReports reloadKey={refresh} onOpen={openReport} canDecide={ctx.level === 'OPERATIONS_HEAD'} withInbox={ctx.level === 'OPERATIONS_HEAD'} /> : null}
      {tab === 'weeklyApprovals' && ctx.level === 'OPERATIONS_HEAD' ? (
        <div className="space-y-4">
          <WeeklyApprovals reloadKey={refresh} />
          <ReviewInbox title="Department Head daily reports" emptyText="No Department Head daily report is waiting for you." reloadKey={refresh} onOpen={openReport} />
        </div>
      ) : null}
      {tab === 'weeklyApprovals' && ctx.level === 'SUPER_ADMIN' ? <p className="text-sm text-slate-500">Weekly approvals are decided by the Operations Head.</p> : null}
      {tab === 'overview' && (ctx.level === 'OPERATIONS_HEAD' || ctx.level === 'SUPER_ADMIN') ? <ReportingOverview reloadKey={refresh} /> : null}

      {openId ? (
        <ReportDetailDialog
          id={openId}
          simple={openSimple}
          refreshKey={liveKey}
          onClose={() => setOpenId(null)}
          onChanged={changed}
          onEdit={r => { setOpenId(null); setEditing(r); setFormKey(k => k + 1); setTab(formTab); }}
        />
      ) : null}
    </div>
  );
};

export default ReportsWorkspace;
