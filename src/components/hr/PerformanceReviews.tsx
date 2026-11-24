import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HrPerson, HrReviewDepartment, HrReviewSaved, HrReviewsOverview } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { hrReviewsApi } from '../../lib/api/reportPerformance';
import { Card, ErrorBanner, inputCls, Spinner } from '../team-member/pipeline/shared';
import { ReportDetailDialog } from '../reports/ReportDetailDialog';
import { notifyReportsChanged, useReportsLive } from '../reports/reportEvents';
import { Box, Chip, dateLabel, Tabs, todayIso, WeekPicker, weekOf, WeeklyStatusPill } from '../reports/reportUi';
import { HrConsolidatedReport } from './HrConsolidatedReport';
import { HrReviewHistory } from './HrReviewHistory';
import { HrPageHeader } from './hrUi';
import { ClipboardCheck } from 'lucide-react';
import { DepartmentReview, PersonBox, reviewTone } from './ReviewPeople';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

type Flat = { person: HrPerson; detail: HrReviewDepartment; department: string };
const FILTERS = [
  { id: 'ALL', label: 'All', match: () => true },
  { id: 'PENDING', label: 'Pending HR review', match: (p: HrPerson) => !p.review },
  { id: 'DRAFT', label: 'Draft', match: (p: HrPerson) => p.review?.status === 'DRAFT' },
  { id: 'SUBMITTED', label: 'Submitted', match: (p: HrPerson) => p.review?.status === 'SUBMITTED' }
] as const;

/** Every Team Lead (or every Team Member) of every department that reached HR, one review form each. */
const PeopleList: React.FC<{ kind: 'TEAM_LEAD' | 'TEAM_MEMBER'; overview: HrReviewsOverview; details: Record<string, HrReviewDepartment>; load: (packageId: string) => void; onSaved: (packageId: string, r: HrReviewSaved) => void; onOpenReport: (id: string) => void }> = ({ kind, overview, details, load, onSaved, onOpenReport }) => {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('PENDING');
  const [search, setSearch] = useState('');
  useEffect(() => { for (const d of overview.departments) if (!details[d.packageId]) load(d.packageId); }, [overview, details, load]);
  const all = useMemo<Flat[]>(() => overview.departments.flatMap(d => {
    const det = details[d.packageId];
    if (!det) return [];
    const people: HrPerson[] = kind === 'TEAM_LEAD' ? det.teamLeads : [...det.teamLeads.flatMap(l => l.members), ...det.otherMembers];
    return people.map(person => ({ person, detail: det, department: d.name }));
  }), [overview, details, kind]);
  const active = FILTERS.find(f => f.id === filter) ?? FILTERS[0];
  const rows = all.filter(x => active.match(x.person)).filter(x => !search.trim() || x.person.name.toLowerCase().includes(search.trim().toLowerCase()));
  const loading = overview.departments.some(d => !details[d.packageId]);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-base font-bold text-slate-900">{kind === 'TEAM_LEAD' ? 'Team Lead Reviews' : 'Team Member Reviews'}</h2>
        <input className={`${inputCls} !w-52 !py-1.5`} placeholder="Search by name" aria-label="Search people by name" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3" role="group" aria-label="Filter by review status">
        {FILTERS.map(f => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 transition-colors ${filter === f.id ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}>
            {f.label} <span className="tabular-nums opacity-80">{all.filter(x => f.match(x.person)).length}</span>
          </button>
        ))}
      </div>
      {loading && all.length === 0 ? <Spinner /> : rows.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">{all.length === 0 ? 'Nobody to review for this week yet.' : 'Nobody matches.'}</p> : (
        <div className="space-y-2" data-testid={kind === 'TEAM_LEAD' ? 'lead-reviews' : 'member-reviews'}>
          {rows.map(x => (
            <PersonBox key={`${x.detail.package.id}-${x.person.id}`} detail={x.detail} person={x.person} kind={kind} level={2} department={x.department}
              onSaved={r => onSaved(x.detail.package.id as string, r)} onOpenReport={onOpenReport} />
          ))}
        </div>
      )}
      {rows.length > 0 ? <p className="mt-3 text-[11px] text-slate-500">{rows.filter(x => reviewTone(x.person.review).tone === 'good').length} of {rows.length} shown are submitted.</p> : null}
    </Card>
  );
};

/**
 * HR's Reports / Performance Reviews page. A weekly department report reaches it once the Operations Head approved it; HR then reviews every
 * Team Lead and every Team Member separately, and sends the consolidated report to the Super Admin. HR reads the daily reports but never
 * changes them or their approvals: a review is a separate record.
 */
const PerformanceReviews: React.FC = () => {
  const [tab, setTab] = useState('departments');
  const [week, setWeek] = useState<string | null>(null);
  const [overview, setOverview] = useState<HrReviewsOverview | null>(null);
  const [details, setDetails] = useState<Record<string, HrReviewDepartment>>({});
  const [error, setError] = useState('');
  const [openReport, setOpenReport] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const loadOverview = useCallback(() => {
    hrReviewsApi.overview(week ?? undefined).then(o => { setError(''); setOverview(o); setWeek(w => w ?? o.weekStart); }, e => setError(errText(e)));
  }, [week]);
  useEffect(() => { setOverview(null); setDetails({}); }, [week]);
  useEffect(loadOverview, [loadOverview, tick]);
  // the live signal: new weekly reports and reviews by a colleague arrive without a refresh
  useReportsLive(useCallback(() => { setTick(t => t + 1); setDetails({}); }, []));

  // one read per department at a time (the lists ask for every department when they open)
  const inflight = useRef(new Set<string>());
  const load = useCallback((packageId: string) => {
    if (inflight.current.has(packageId)) return;
    inflight.current.add(packageId);
    hrReviewsApi.department(packageId).then(d => setDetails(prev => ({ ...prev, [packageId]: d })), e => setError(errText(e))).finally(() => inflight.current.delete(packageId));
  }, []);
  const saved = useCallback((packageId: string, _r: HrReviewSaved) => { notifyReportsChanged(); load(packageId); setTick(t => t + 1); }, [load]);

  const tabs = [
    { id: 'departments', label: 'Department Reviews' },
    { id: 'leads', label: 'Team Lead Reviews' },
    { id: 'members', label: 'Team Member Reviews' },
    { id: 'consolidated', label: 'Consolidated Performance Report' },
    { id: 'history', label: 'Review History' }
  ];
  const effectiveWeek = week ?? overview?.weekStart ?? weekOf(todayIso()).start;

  return (
    <div className="space-y-4" data-testid="hr-performance-reviews">
      <HrPageHeader icon={ClipboardCheck} title="Performance Reviews"
        subtitle="Weekly department reports approved by the CEO. Review each Team Lead and Team Member, then send the consolidated report to the Managing Director."
        actions={<WeekPicker value={effectiveWeek} onChange={setWeek} />} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {error ? <ErrorBanner message={error} onRetry={loadOverview} /> : null}
      {!overview && !error ? <Spinner /> : null}

      {overview && tab === 'departments' ? (
        overview.departments.length === 0 ? (
          <Card className="p-8 text-center text-sm text-slate-500">No weekly department report was approved by an CEO for {dateLabel(effectiveWeek)} - {dateLabel(weekOf(effectiveWeek).end)}. Reports appear here as soon as they are approved.</Card>
        ) : (
          <div className="space-y-3" data-testid="hr-department-boxes">
            {overview.departments.map(d => (
              <Box key={d.packageId} level={1} title={d.name} onOpen={() => { if (!details[d.packageId]) load(d.packageId); }}
                subtitle={<>Department Head: {d.departmentHeads.join(', ') || 'none'} - {d.teamLeads} Team Lead{d.teamLeads === 1 ? '' : 's'}, {d.teamMembers} Team Member{d.teamMembers === 1 ? '' : 's'}</>}
                chips={<><Chip label="reviews submitted" value={`${d.reviews.submitted}/${d.reviews.expected}`} tone={d.reviews.submitted === d.reviews.expected && d.reviews.expected > 0 ? 'good' : 'warn'} />{d.reviews.drafts ? <Chip label="drafts" value={d.reviews.drafts} tone="info" /> : null}</>}
                right={<WeeklyStatusPill status={d.package.status} />}>
                {details[d.packageId] ? <DepartmentReview detail={details[d.packageId]} onSaved={r => saved(d.packageId, r)} onOpenReport={setOpenReport} /> : <Spinner />}
              </Box>
            ))}
          </div>
        )
      ) : null}
      {overview && tab === 'leads' ? <PeopleList kind="TEAM_LEAD" overview={overview} details={details} load={load} onSaved={saved} onOpenReport={setOpenReport} /> : null}
      {overview && tab === 'members' ? <PeopleList kind="TEAM_MEMBER" overview={overview} details={details} load={load} onSaved={saved} onOpenReport={setOpenReport} /> : null}
      {tab === 'consolidated' ? <HrConsolidatedReport week={effectiveWeek} reloadKey={tick} /> : null}
      {tab === 'history' ? <HrReviewHistory reloadKey={tick} departments={(overview?.departments ?? []).map(d => ({ id: d.id, name: d.name }))} /> : null}

      {openReport ? <ReportDetailDialog id={openReport} simple onClose={() => setOpenReport(null)} /> : null}
    </div>
  );
};

export default PerformanceReviews;
