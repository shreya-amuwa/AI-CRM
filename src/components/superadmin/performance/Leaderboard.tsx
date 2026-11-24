import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LEADERBOARD_CATEGORIES, LEADERBOARD_CATEGORY_LABEL, type LeaderboardCategory } from '../../../../shared/reportFields';
import type { Leaderboard as LeaderboardData, LeaderboardDepartment, LeaderboardOptions, LeaderboardRow, ScoringMethod } from '../../../../shared/contracts';
import { reportSettingsSchema } from '../../../../shared/validation';
import { ApiError } from '../../../lib/api/client';
import { reportPerformanceApi, type LeaderboardQuery } from '../../../lib/api/reportPerformance';
import { btn, Card, ErrorBanner, inputCls, selectCls, Spinner } from '../../team-member/pipeline/shared';
import { dateLabel, pctLabel, todayIso } from '../../reports/reportUi';
import { LeaderboardTable } from './parts';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

interface Filters {
  periodType: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM'; from: string; to: string; category: LeaderboardCategory;
  department: string; team: string; designation: string; role: string; person: string; teamLead: string; departmentHead: string; operationsHead: string;
  performance: string; ratingMin: string; ratingMax: string; complianceMin: string; complianceMax: string; completionMin: string; completionMax: string;
}
const EMPTY: Filters = {
  periodType: 'WEEKLY', from: '', to: '', category: 'TOP10', department: '', team: '', designation: '', role: '', person: '', teamLead: '', departmentHead: '', operationsHead: '',
  performance: '', ratingMin: '', ratingMax: '', complianceMin: '', complianceMax: '', completionMin: '', completionMax: ''
};
const toQuery = (f: Filters): LeaderboardQuery => {
  const q: LeaderboardQuery = {};
  for (const [k, v] of Object.entries(f)) if (v !== '') q[k] = v as string;
  return q;
};

const WEIGHT_LABEL: Record<string, string> = { taskCompletion: 'Task completion', compliance: 'Daily reporting compliance', onTime: 'On-time submission', approvalQuality: 'Approvals without revision', hrRating: 'HR review rating' };

/** The scoring method in words, with the weights; the Super Admin changes them here (the leaderboard recalculates at once). */
export const Methodology: React.FC<{ method: ScoringMethod; canEdit: boolean; onChanged: () => void }> = ({ method, canEdit, onChanged }) => {
  const [edit, setEdit] = useState(false);
  const [w, setW] = useState<Record<string, string>>({});
  const [minTasks, setMinTasks] = useState('');
  const [minReports, setMinReports] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const total = Object.values(method.weights).reduce((a, b) => a + b, 0) || 1;
  const open = () => { setW(Object.fromEntries(Object.entries(method.weights).map(([k, v]) => [k, String(v)]))); setMinTasks(String(method.minTasks)); setMinReports(String(method.minExpectedReports)); setProblem(''); setEdit(true); };
  const save = async () => {
    const body = { weights: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Number(v)])), minTasks: Number(minTasks), minExpectedReports: Number(minReports), workingDays: [1, 2, 3, 4, 5, 6] };
    const parsed = reportSettingsSchema.safeParse(body);
    if (!parsed.success) { setProblem(parsed.error.issues[0]?.message ?? 'Check the values.'); return; }
    setBusy(true);
    try {
      const current = await reportPerformanceApi.settings();
      await reportPerformanceApi.updateSettings({ ...parsed.data, workingDays: current.workingDays });
      setEdit(false);
      onChanged();
    } catch (e) { setProblem(errText(e)); } finally { setBusy(false); }
  };
  return (
    <details className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3" data-testid="methodology">
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">How the score is calculated</summary>
      <div className="mt-3 space-y-2 text-xs text-slate-700">
        <p>The score (0 to 100) is a weighted average of measures taken from real records. A measure with no data is left out and the others are scaled up: it is never counted as zero.</p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {Object.entries(method.weights).map(([k, v]) => <li key={k} className="flex justify-between rounded-lg bg-white px-3 py-1.5 ring-1 ring-slate-200"><span>{WEIGHT_LABEL[k] ?? k}</span><b className="tabular-nums">{v} ({Math.round((100 * v) / total)}%)</b></li>)}
        </ul>
        <p>Not penalised: tasks that were not assigned to the person, days of approved leave, work outside the chosen period. A person needs at least {method.minExpectedReports} expected report days and two measures with data to be scored; otherwise the status is <b>Insufficient data</b>, which is not a low score. HR ratings are shown as HR gave them (scale {method.ratingScale[0]?.value} to {method.ratingScale[method.ratingScale.length - 1]?.value}) and the analysis never changes them.</p>
        {canEdit && !edit ? <button type="button" className={btn.secondary} onClick={open}>Change the weights</button> : null}
        {edit ? (
          <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
            <div className="grid gap-2 sm:grid-cols-3">
              {Object.keys(method.weights).map(k => (
                <label key={k} className="text-xs text-slate-600">{WEIGHT_LABEL[k] ?? k}
                  <input className={`${inputCls} mt-1`} type="number" min={0} max={100} value={w[k] ?? ''} onChange={e => setW(x => ({ ...x, [k]: e.target.value }))} />
                </label>
              ))}
              <label className="text-xs text-slate-600">Minimum tasks to score task completion<input className={`${inputCls} mt-1`} type="number" min={1} max={100} value={minTasks} onChange={e => setMinTasks(e.target.value)} /></label>
              <label className="text-xs text-slate-600">Minimum expected report days<input className={`${inputCls} mt-1`} type="number" min={1} max={100} value={minReports} onChange={e => setMinReports(e.target.value)} /></label>
            </div>
            {problem ? <p role="alert" className="text-xs text-rose-700">{problem}</p> : null}
            <div className="flex gap-2"><button type="button" className={btn.primary} onClick={() => void save()} disabled={busy}>{busy ? 'Saving...' : 'Save weights'}</button><button type="button" className={btn.secondary} onClick={() => setEdit(false)} disabled={busy}>Cancel</button></div>
          </div>
        ) : null}
      </div>
    </details>
  );
};

const DEPT_HEADS = ['Rank', 'Department', 'Score', 'People ranked', 'Insufficient data', 'Assigned', 'Completed', 'Completion', 'Reporting compliance', 'HR rating'];
const DepartmentTable: React.FC<{ rows: LeaderboardDepartment[]; empty: string }> = ({ rows, empty }) => (
  rows.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">{empty}</p> : (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full text-xs" data-testid="department-ranking">
        <caption className="sr-only">Department ranking</caption>
        <thead className="bg-slate-50 text-slate-500"><tr>{DEPT_HEADS.map(h => <th key={h} scope="col" className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(d => (
            <tr key={d.departmentId}>
              <td className="px-3 py-2 font-bold tabular-nums">{d.rank ?? '-'}</td>
              <th scope="row" className="px-3 py-2 text-left font-semibold text-slate-800">{d.department}</th>
              <td className="px-3 py-2 tabular-nums font-bold">{d.status === 'RANKED' ? d.score : 'Insufficient data'}</td>
              <td className="px-3 py-2 tabular-nums">{d.ranked}</td><td className="px-3 py-2 tabular-nums">{d.insufficient}</td>
              <td className="px-3 py-2 tabular-nums">{d.assignedTasks}</td><td className="px-3 py-2 tabular-nums">{d.completedTasks}</td>
              <td className="px-3 py-2 tabular-nums">{pctLabel(d.completionRate)}</td><td className="px-3 py-2 tabular-nums">{pctLabel(d.compliance)}</td>
              <td className="px-3 py-2 tabular-nums">{d.hrRating ?? 'Not reviewed'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
);

/**
 * The Performance Leaderboard. Everything is calculated now from the records for the chosen period and filters (nothing is stored or typed):
 * Top / Bottom 10, Team Members, Team Leads and departments. The people without enough data are listed apart as Insufficient Data.
 */
export const Leaderboard: React.FC<{ reloadKey: number; onOpenEmployee: (id: string, period: { type: string; from?: string; to?: string }) => void }> = ({ reloadKey, onOpenEmployee }) => {
  const [f, setF] = useState<Filters>(EMPTY);
  const [more, setMore] = useState(false);
  const [opts, setOpts] = useState<LeaderboardOptions | null>(null);
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF(x => ({ ...x, [k]: v }));

  useEffect(() => { reportPerformanceApi.options().then(setOpts, e => setError(errText(e))); }, []);
  const load = useCallback(() => {
    setError('');
    reportPerformanceApi.leaderboard(toQuery(f)).then(setData, e => setError(errText(e)));
  }, [f]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load, reloadKey, tick]);

  const teams = useMemo(() => (opts?.teams ?? []).filter(t => !f.department || t.departmentId === f.department), [opts, f.department]);
  const people = useMemo(() => (opts?.people ?? []).filter(p => (!f.department || p.departmentId === f.department) && (!f.team || p.teamId === f.team)), [opts, f.department, f.team]);
  const leads = people.filter(p => p.role === 'TEAM_HEAD');
  const heads = (opts?.people ?? []).filter(p => p.role === 'DEPARTMENT_HEAD');
  const isDepts = f.category === 'TOP_DEPARTMENTS' || f.category === 'LOWEST_DEPARTMENTS';
  const rows = (data?.rows ?? []) as LeaderboardRow[];
  const scopeLabel = f.person ? 'Individual employee' : f.team ? 'Individual team' : f.department ? 'Individual department' : 'Entire company';
  const selectAny = (id: string, label: string, value: string, onChange: (v: string) => void, options: { value: string; label: string }[]) => (
    <label className="text-[11px] font-semibold text-slate-500" htmlFor={id}>{label}
      <select id={id} className={`${selectCls} mt-1 w-full`} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
  const num = (id: string, label: string, k: keyof Filters, max: number) => (
    <label className="text-[11px] font-semibold text-slate-500" htmlFor={id}>{label}
      <input id={id} type="number" min={0} max={max} className={`${inputCls} mt-1 !py-1.5`} value={f[k]} onChange={e => set(k, e.target.value as never)} />
    </label>
  );

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h2 className="text-base font-bold text-slate-900">Performance Leaderboard</h2><p className="text-xs text-slate-500">{scopeLabel} - calculated from task records, daily reports, approvals and HR reviews.</p></div>
          <button type="button" className={btn.secondary} onClick={() => { setF(EMPTY); }}>Reset filters</button>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Leaderboard category">
          {LEADERBOARD_CATEGORIES.filter(c => c !== 'ALL').map(c => (
            <button key={c} type="button" aria-pressed={f.category === c} onClick={() => set('category', c)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 transition-colors ${f.category === c ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}>{LEADERBOARD_CATEGORY_LABEL[c]}</button>
          ))}
          <button type="button" aria-pressed={f.category === 'ALL'} onClick={() => set('category', 'ALL')} className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${f.category === 'ALL' ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}>{LEADERBOARD_CATEGORY_LABEL.ALL}</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="group" aria-label="Filters">
          {selectAny('lb-period', 'Reporting period', f.periodType, v => set('periodType', v as Filters['periodType']), [{ value: 'DAILY', label: 'Daily' }, { value: 'WEEKLY', label: 'Weekly' }, { value: 'MONTHLY', label: 'Monthly' }, { value: 'CUSTOM', label: 'Custom date range' }])}
          <label className="text-[11px] font-semibold text-slate-500" htmlFor="lb-from">{f.periodType === 'CUSTOM' ? 'From' : f.periodType === 'DAILY' ? 'Day' : f.periodType === 'WEEKLY' ? 'Any day of the week' : 'Any day of the month'}
            <input id="lb-from" type="date" className={`${inputCls} mt-1 !py-1.5`} value={f.from} max={todayIso()} onChange={e => set('from', e.target.value)} />
          </label>
          {f.periodType === 'CUSTOM' ? (
            <label className="text-[11px] font-semibold text-slate-500" htmlFor="lb-to">To<input id="lb-to" type="date" className={`${inputCls} mt-1 !py-1.5`} value={f.to} max={todayIso()} min={f.from || undefined} onChange={e => set('to', e.target.value)} /></label>
          ) : <div />}
          <div />
          {selectAny('lb-dept', 'Department', f.department, v => setF(x => ({ ...x, department: v, team: '', person: '', teamLead: '' })), (opts?.departments ?? []).map(d => ({ value: d.id, label: d.name })))}
          {selectAny('lb-team', 'Team', f.team, v => setF(x => ({ ...x, team: v, person: '', teamLead: '' })), teams.map(t => ({ value: t.id, label: t.name })))}
          {selectAny('lb-role', 'Employee role', f.role, v => set('role', v), [{ value: 'TEAM_MEMBER', label: 'Team Member' }, { value: 'TEAM_LEAD', label: 'Team Lead' }, { value: 'DEPARTMENT_HEAD', label: 'Department Head' }])}
          {selectAny('lb-perf', 'Performance category', f.performance, v => set('performance', v), [{ value: 'STRONG', label: 'Strong (75+)' }, { value: 'AVERAGE', label: 'Average (50-74)' }, { value: 'NEEDS_ATTENTION', label: 'Needs attention (below 50)' }, { value: 'INSUFFICIENT_DATA', label: 'Insufficient data' }])}
        </div>
        <button type="button" className="text-xs font-semibold text-indigo-700 hover:underline" onClick={() => setMore(m => !m)} aria-expanded={more}>{more ? 'Fewer filters' : 'More filters'}</button>
        {more ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {selectAny('lb-desig', 'Designation', f.designation, v => set('designation', v), (opts?.designations ?? []).map(d => ({ value: d, label: d })))}
            {selectAny('lb-person', 'Individual employee', f.person, v => set('person', v), people.map(p => ({ value: p.id, label: p.name })))}
            {selectAny('lb-lead', 'Team Lead', f.teamLead, v => set('teamLead', v), leads.map(p => ({ value: p.id, label: p.name })))}
            {selectAny('lb-head', 'Department Head', f.departmentHead, v => set('departmentHead', v), heads.map(p => ({ value: p.id, label: p.name })))}
            {selectAny('lb-oh', 'CEO', f.operationsHead, v => set('operationsHead', v), (opts?.operationsHeads ?? []).map(p => ({ value: p.id, label: p.name })))}
            {num('lb-rmin', 'HR rating from', 'ratingMin', 10)}{num('lb-rmax', 'HR rating to', 'ratingMax', 10)}<div />
            {num('lb-cmin', 'Reporting compliance from %', 'complianceMin', 100)}{num('lb-cmax', 'Reporting compliance to %', 'complianceMax', 100)}
            {num('lb-tmin', 'Task completion from %', 'completionMin', 100)}{num('lb-tmax', 'Task completion to %', 'completionMax', 100)}
          </div>
        ) : null}
        {error ? <ErrorBanner message={error} onRetry={() => setTick(t => t + 1)} /> : null}
        {data ? <p className="text-xs text-slate-600">Period {dateLabel(data.period.from)} to {dateLabel(data.period.to)} (compared with {dateLabel(data.period.previousFrom)} to {dateLabel(data.period.previousTo)}). {data.counts.people} people: {data.counts.ranked} ranked, {data.counts.insufficient} with insufficient data.</p> : null}
        {!data && !error ? <Spinner /> : null}
        {data ? (
          <section aria-label={LEADERBOARD_CATEGORY_LABEL[f.category]} className="space-y-3">
            <h3 className="text-sm font-bold text-slate-900">{LEADERBOARD_CATEGORY_LABEL[f.category]}</h3>
            {isDepts ? <DepartmentTable rows={data.rows as LeaderboardDepartment[]} empty="No department has enough data for this period." /> : (
              <LeaderboardTable rows={rows} onOpen={id => onOpenEmployee(id, { type: data.period.type, from: data.period.from, to: data.period.to })} empty={f.category === 'ALL' ? 'Nobody matches the filters.' : 'Nobody has enough data to be ranked with these filters.'} />
            )}
            {!isDepts && data.insufficientData.length > 0 ? (
              <details className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3" open>
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">Insufficient data - not ranked and not judged ({data.insufficientData.length})</summary>
                <p className="text-xs text-slate-500 my-2">These people do not have enough reports or tasks in the period to be scored fairly (for example new joiners or long leave). This is not a low score.</p>
                <ul className="flex flex-wrap gap-1.5">{data.insufficientData.map(r => <li key={r.id}><button type="button" className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100" onClick={() => onOpenEmployee(r.id, { type: data.period.type, from: data.period.from, to: data.period.to })}>{r.name} <span className="text-slate-400">({r.department})</span></button></li>)}</ul>
              </details>
            ) : null}
          </section>
        ) : null}
      </Card>
      {data ? <Methodology method={data.methodology} canEdit onChanged={() => setTick(t => t + 1)} /> : null}
    </div>
  );
};
