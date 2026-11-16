import React from 'react';
import { AI_STUDIO_REPORT_STATUS_LABELS, type AiStudioOverview as Overview } from '../../../shared/contracts';
import { useAuth } from '../../context/AuthContext';
import { aiStudioApi } from '../../lib/api/aiStudio';
import { PageTitle } from '../layout/shell';
import { ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { Card, CardHead, StatCard } from '../tasks/head/headParts';
import { useAiStudioChanged } from './aiStudioEvents';
import { PriorityBadge, ProgressBar, ProjectStatusBadge, TaskStatusBadge, dateText, dateTimeText, useLoad } from './ui';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

type Go = (page: 'projects' | 'reports' | 'team') => void;

/**
 * Overview: every number is counted from the records by the database (tasks, reports, people); nothing is a placeholder.
 * "Pending" = not started or on hold; "Ongoing" = in progress.
 */
export const AiStudioOverviewPage: React.FC<{ go: Go }> = ({ go }) => {
  const { profile } = useAuth();
  const { data, error, loading, reload } = useLoad<Overview>(() => aiStudioApi.overview(), []);
  useAiStudioChanged(reload);
  const first = (profile?.fullName || '').split(' ')[0];
  const head = data?.role === 'HEAD' || data?.role === 'ADMIN';
  return (
    <div className="space-y-6">
      <PageTitle
        title={head ? 'AI Studio Overview' : `${greeting()}${first ? `, ${first}` : ''}`}
        subtitle={head ? 'Your people, projects, tasks and daily reports at a glance.' : 'Your projects, tasks and daily report.'}
      />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Loading the overview…" />}
      {data?.myTasks && <MyWork data={data} go={go} />}
      {data?.team && <TeamBlock data={data} go={go} />}
      {data?.department && <DepartmentBlock data={data} go={go} />}
    </div>
  );
};

const MyWork: React.FC<{ data: Overview; go: Go }> = ({ data, go }) => {
  const t = data.myTasks!;
  const dr = data.dailyReport!;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Assigned projects" value={data.projects?.length ?? 0} tone="blue" />
        <StatCard label="Assigned tasks" value={t.total} />
        <StatCard label="Ongoing tasks" value={t.ongoing} tone="blue" />
        <StatCard label="Completed tasks" value={t.completed} tone="green" />
        <StatCard label="Pending tasks" value={t.pending} tone="amber" foot="Not started or on hold" />
        <StatCard label="Overdue" value={t.overdue} tone={t.overdue ? 'red' : 'neutral'} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHead title="Upcoming deadlines" hint="Open tasks due in the next 14 days, and anything overdue." right={<button type="button" onClick={() => go('projects')} className="text-xs font-bold text-blue-600 hover:underline">All tasks</button>} />
          {(data.upcoming ?? []).length === 0
            ? <p className="px-5 pb-6 text-sm text-slate-500">No deadline coming up.</p>
            : (
              <ul className="divide-y divide-slate-100">
                {data.upcoming!.map(u => (
                  <li key={u.id} className="px-5 py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <div className="min-w-0 flex-1"><div className="text-sm font-bold text-slate-900 truncate">{u.title}</div><div className="text-xs text-slate-500">{u.projectName}</div></div>
                    <PriorityBadge priority={u.priority} /><TaskStatusBadge status={u.status} />
                    <span className={`text-xs font-bold ${u.overdue ? 'text-rose-700' : 'text-slate-600'}`}>{dateText(u.dueDate)}{u.overdue ? ' · overdue' : ''}</span>
                  </li>
                ))}
              </ul>
            )}
        </Card>
        <Card>
          <CardHead title="Daily report" />
          <div className="px-5 pb-5 space-y-3 text-sm">
            <p className="text-slate-700">
              Today: <strong>{dr.todayStatus ? AI_STUDIO_REPORT_STATUS_LABELS[dr.todayStatus] : 'Not written yet'}</strong>
            </p>
            <ul className="text-slate-600 space-y-1">
              <li>{dr.returned} returned for changes</li>
              <li>{dr.pendingApproval} waiting for approval</li>
              <li>{dr.approved} approved</li>
            </ul>
            <button type="button" onClick={() => go('reports')} className="text-sm font-bold text-blue-600 hover:underline">{dr.todayStatus ? 'Open Daily Report' : 'Write today\'s report'}</button>
          </div>
        </Card>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHead title="Assigned projects" />
          {(data.projects ?? []).length === 0
            ? <p className="px-5 pb-6 text-sm text-slate-500">You are not on a project yet.</p>
            : (
              <ul className="divide-y divide-slate-100">
                {data.projects!.map(p => (
                  <li key={p.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0"><div className="text-sm font-bold text-slate-900 truncate">{p.name}</div><div className="text-xs text-slate-500">{p.completed} of {p.tasks} of your tasks completed</div></div>
                    <ProjectStatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            )}
        </Card>
        <Card>
          <CardHead title="Recent activity" />
          {(data.recent ?? []).length === 0
            ? <p className="px-5 pb-6 text-sm text-slate-500">Nothing yet.</p>
            : (
              <ul className="divide-y divide-slate-100">
                {data.recent!.map((r, i) => (
                  <li key={`${r.entityId}-${i}`} className="px-5 py-3"><div className="text-sm text-slate-800">{r.text}</div><div className="text-xs text-slate-500">{dateTimeText(r.at)}</div></li>
                ))}
              </ul>
            )}
        </Card>
      </div>
    </>
  );
};

const TeamBlock: React.FC<{ data: Overview; go: Go }> = ({ data, go }) => {
  const t = data.team!;
  return (
    <section aria-label="My team" className="space-y-3">
      <h2 className="text-base font-extrabold text-slate-900">My team</h2>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Team Members" value={t.members} tone="blue" />
        <StatCard label="Team tasks" value={t.tasks.total} />
        <StatCard label="Ongoing" value={t.tasks.ongoing} tone="blue" />
        <StatCard label="Completed" value={t.tasks.completed} tone="green" />
        <StatCard label="Overdue" value={t.tasks.overdue} tone={t.tasks.overdue ? 'red' : 'neutral'} />
        <StatCard label="Reports to review" value={t.reportsToReview} tone={t.reportsToReview ? 'amber' : 'neutral'} foot={`${t.reportsToday} submitted today`} />
      </div>
      {t.reportsToReview > 0 && <button type="button" onClick={() => go('reports')} className="text-sm font-bold text-blue-600 hover:underline">Review the reports of your team</button>}
    </section>
  );
};

const DepartmentBlock: React.FC<{ data: Overview; go: Go }> = ({ data, go }) => {
  const d = data.department!;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="AI Studio employees" value={d.employees} tone="blue" />
        <StatCard label="Team Leads" value={d.leads} />
        <StatCard label="Team Members" value={d.members} foot={d.unassignedMembers ? `${d.unassignedMembers} without a Team Lead` : undefined} tone={d.unassignedMembers ? 'amber' : 'neutral'} />
        <StatCard label="Active projects" value={d.activeProjects} tone="green" />
        <StatCard label="Assigned tasks" value={d.tasks.assigned} />
        <StatCard label="Ongoing tasks" value={d.tasks.ongoing} tone="blue" />
        <StatCard label="Completed tasks" value={d.tasks.completed} tone="green" />
        <StatCard label="Pending tasks" value={d.tasks.pending} tone="amber" foot={d.tasks.overdue ? `${d.tasks.overdue} overdue` : 'Not started or on hold'} />
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label="Reports awaiting my approval" value={d.reportsAwaitingHead} tone={d.reportsAwaitingHead ? 'amber' : 'neutral'} />
        <StatCard label="Reports with Team Leads" value={d.reportsAwaitingLead} />
        <StatCard label="Reports submitted today" value={d.reportsToday} foot={`${d.reportsApproved} approved in all`} />
      </div>
      {d.reportsAwaitingHead > 0 && <button type="button" onClick={() => go('reports')} className="text-sm font-bold text-blue-600 hover:underline">Review reports</button>}
      <Card>
        <CardHead title="Project-wise progress" right={<button type="button" onClick={() => go('projects')} className="text-xs font-bold text-blue-600 hover:underline">Manage projects</button>} />
        {d.projects.length === 0
          ? <p className="px-5 pb-6 text-sm text-slate-500">No project yet.</p>
          : (
            <ul className="divide-y divide-slate-100">
              {d.projects.map(p => (
                <li key={p.id} className="px-5 py-3 grid sm:grid-cols-[1fr_16rem] gap-2 sm:items-center">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 flex items-center gap-2">{p.name}<ProjectStatusBadge status={p.status} /></div>
                    <div className="text-xs text-slate-500">{p.completed} of {p.total} tasks completed · {p.ongoing} in progress{p.leads.length ? ` · ${p.leads.join(', ')}` : ''}</div>
                  </div>
                  <ProgressBar value={p.progress} label={`${p.name}: ${p.progress}% complete`} />
                </li>
              ))}
            </ul>
          )}
      </Card>
    </>
  );
};
