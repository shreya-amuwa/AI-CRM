import React, { useState } from 'react';
import type { HrPerson, HrReview, HrReviewDepartment, HrReviewSaved, HrTeamLead } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { hrReviewsApi } from '../../lib/api/reportPerformance';
import type { WorkReportSummary } from '../../../shared/contracts';
import { ReportRow } from '../reports/ReportRow';
import { StatsGrid, TeamStatsTable } from '../reports/DailySummary';
import { Box, Chip, pctLabel } from '../reports/reportUi';
import { WeeklyPackageView } from '../reports/WeeklyPackageView';
import { PersonFigures, ReviewForm } from './ReviewForm';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

export const reviewTone = (r: HrReview | null): { label: string; tone: 'neutral' | 'warn' | 'good' } =>
  r?.status === 'SUBMITTED' ? { label: 'Review submitted', tone: 'good' } : r ? { label: 'Draft review', tone: 'warn' } : { label: 'Pending HR review', tone: 'neutral' };

/** The person's daily reports of the week, read when asked (the list can be long). Read only: HR never changes a report. */
const DailyHistory: React.FC<{ packageId: string; personId: string; onOpen: (id: string) => void }> = ({ packageId, personId, onOpen }) => {
  const [items, setItems] = useState<WorkReportSummary[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const toggle = () => {
    if (!open && !items) hrReviewsApi.personReports(packageId, personId).then(setItems, e => setError(errText(e)));
    setOpen(o => !o);
  };
  return (
    <div>
      <button type="button" className="text-xs font-semibold text-indigo-700 hover:underline" onClick={toggle} aria-expanded={open}>{open ? 'Hide daily report history' : 'Daily report history'}</button>
      {open ? (
        error ? <p role="alert" className="text-xs text-rose-700 mt-1">{error}</p> : !items ? <p className="text-xs text-slate-500 mt-1">Loading...</p> : items.length === 0 ? <p className="text-xs text-slate-500 mt-1">No daily report in this week.</p> : (
          <ul className="mt-2 space-y-2" data-testid="daily-history">{items.map(r => <li key={r.id}><ReportRow r={r} onOpen={onOpen} /></li>)}</ul>
        )
      ) : null}
    </div>
  );
};

/** One person (Team Lead or Team Member): the figures, the daily report history and their own review form. */
export const PersonBox: React.FC<{
  detail: HrReviewDepartment;
  person: HrPerson;
  kind: 'TEAM_LEAD' | 'TEAM_MEMBER';
  level?: 2 | 3;
  extra?: React.ReactNode;
  onSaved: (r: HrReviewSaved) => void;
  onOpenReport: (id: string) => void;
  department?: string;
  defaultOpen?: boolean;
}> = ({ detail, person, kind, level = 3, extra, onSaved, onOpenReport, department, defaultOpen }) => {
  const t = reviewTone(person.review);
  return (
    <Box
      level={level}
      defaultOpen={defaultOpen}
      title={person.name}
      subtitle={<>{kind === 'TEAM_LEAD' ? 'Team Lead' : person.designation ?? 'Team Member'}{department ? ` - ${department}` : ''}</>}
      chips={
        <>
          <Chip label={t.label} value={person.review?.rating ?? '-'} tone={t.tone} />
          <Chip label="task completion" value={pctLabel(person.stats.taskCompletionRate)} />
          <Chip label="reporting compliance" value={pctLabel(person.stats.compliance)} tone={typeof person.stats.compliance === 'number' && person.stats.compliance < 80 ? 'warn' : 'neutral'} />
        </>
      }
    >
      <div className="space-y-3">
        <PersonFigures stats={person.stats} />
        {extra}
        <DailyHistory packageId={detail.package.id as string} personId={person.id} onOpen={onOpenReport} />
        <ReviewForm
          packageId={detail.package.id as string}
          subject={{ id: person.id, name: person.name, kind }}
          review={person.review}
          scale={detail.scale}
          periodStart={detail.periodStart}
          periodEnd={detail.periodEnd}
          canReview={detail.canReview}
          stats={person.stats}
          onSaved={onSaved}
        />
      </div>
    </Box>
  );
};

/** A department's week opened for review: the weekly summary, then a box per Team Lead (the lead's review first, then every Team Member). */
export const DepartmentReview: React.FC<{ detail: HrReviewDepartment; onSaved: (r: HrReviewSaved) => void; onOpenReport: (id: string) => void }> = ({ detail, onSaved, onOpenReport }) => (
  <div className="space-y-4">
    <WeeklyPackageView pkg={detail.package} showHistory={false} />
    <StatsGrid stats={detail.stats} />
    <section aria-label="Team Leads">
      <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Team Leads and their Team Members</h4>
      {detail.teamLeads.length === 0 && detail.otherMembers.length === 0 ? <p className="text-xs text-slate-500">No Team Leads or Team Members in this department.</p> : (
        <div className="space-y-2">
          {detail.teamLeads.map((l: HrTeamLead) => {
            const done = l.members.filter(m => m.review?.status === 'SUBMITTED').length + (l.review?.status === 'SUBMITTED' ? 1 : 0);
            return (
              <Box key={l.id} level={2} title={l.name} subtitle={<>Team Lead - {l.team ?? 'No team'}</>}
                chips={<><Chip label="reviewed" value={`${done}/${l.members.length + 1}`} tone={done === l.members.length + 1 ? 'good' : 'warn'} /><Chip label="team compliance" value={pctLabel(l.teamStats?.compliance)} /></>}>
                <div className="space-y-4">
                  <section aria-label={`Team Lead performance review of ${l.name}`}>
                    <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Section A - Team Lead performance review</h5>
                    <PersonBox detail={detail} person={l} kind="TEAM_LEAD" level={3} onSaved={onSaved} onOpenReport={onOpenReport}
                      extra={l.teamStats ? <p className="text-xs text-slate-600">Team reporting: {l.teamStats.submitted} of {l.teamStats.expected} reports ({pctLabel(l.teamStats.compliance)}), {l.teamStats.completedTasks} of {l.teamStats.assignedTasks} reported tasks completed.</p> : null} />
                  </section>
                  <section aria-label={`Team Members of ${l.name}`}>
                    <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Section B - Individual Team Member performance reviews</h5>
                    {l.members.length === 0 ? <p className="text-xs text-slate-500">No Team Members in this team.</p> : (
                      <div className="space-y-2">{l.members.map(m => <PersonBox key={m.id} detail={detail} person={m} kind="TEAM_MEMBER" onSaved={onSaved} onOpenReport={onOpenReport} />)}</div>
                    )}
                  </section>
                </div>
              </Box>
            );
          })}
          {detail.otherMembers.length > 0 ? (
            <Box level={2} title="Team Members without a Team Lead" subtitle="Still reviewed individually">
              <div className="space-y-2">{detail.otherMembers.map(m => <PersonBox key={m.id} detail={detail} person={m} kind="TEAM_MEMBER" onSaved={onSaved} onOpenReport={onOpenReport} />)}</div>
            </Box>
          ) : null}
        </div>
      )}
    </section>
    <section aria-label="Team-wise reporting"><h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Team-wise reporting</h4><TeamStatsTable stats={detail.stats} /></section>
  </div>
);
