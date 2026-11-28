import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, GraduationCap, RefreshCw } from 'lucide-react';
import { hrReviewsApi } from '../../../lib/api/endpoints';
import type { ReviewList, ReviewRow } from '../../../../shared/hrUpgrade';
import { btn, ErrorBanner, inputCls, selectCls, Spinner } from '../../team-member/pipeline/shared';
import { HrPageHeader } from '../hrUi';
import { configIssueText, daysText, fmtDate, openReview, OverallStatus, ReportStatus, StatCard } from './reviewUi';

type Filters = Record<string, string | undefined>;
const errText = (e: unknown, f: string) => (e instanceof Error && e.message ? e.message : f);

/**
 * HR dashboard > Employee Confirmations / Internship Reviews (docs/hr-dashboard-upgrade.md, Phases 1 and 4). Every card filters the list; a row opens
 * the review. The database returns only what the viewer may see (HR: everything; Department HR: their department; reviewers: theirs).
 */
export const EmployeeReviews: React.FC<{ type: 'PROBATION' | 'INTERNSHIP'; initialFilters?: Filters }> = ({ type, initialFilters }) => {
  const [filters, setFilters] = useState<Filters>(initialFilters ?? {});
  const [data, setData] = useState<ReviewList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await hrReviewsApi.list({ ...filters, type })); setError(null); }
    catch (e) { setError(errText(e, 'The reviews could not be loaded.')); setData(d => d); }
    finally { setLoading(false); }
  }, [filters, type]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const on = () => void load();
    window.addEventListener('crm:hr-review-changed', on);
    return () => window.removeEventListener('crm:hr-review-changed', on);
  }, [load]);
  const toggle = (k: string, v: string) => setFilters(f => (f[k] === v ? { ...f, [k]: undefined } : { ...f, window: undefined, pendingRole: undefined, [k]: v }));
  const c = data?.cards;
  const intern = type === 'INTERNSHIP';

  return (
    <div className="space-y-4" data-testid={intern ? 'internship-reviews' : 'employee-confirmations'}>
      <HrPageHeader icon={intern ? GraduationCap : ClipboardCheck} title={intern ? 'Internship Reviews' : 'Employee Confirmations'}
        subtitle={intern ? 'Three-month internship evaluations: Department Head, CEO and HR reports, then HR\'s decision.'
          : 'Probation completion reviews: reminders 10 and 4 days before, the Department Head and CEO reports, then HR\'s final decision.'}
        actions={<button type="button" className={btn.secondary} onClick={() => void load()} disabled={loading}><RefreshCw className="w-3.5 h-3.5" aria-hidden />Refresh</button>} />
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {c && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2" data-testid="review-cards">
          {!intern && <StatCard label="Upcoming confirmations" value={c.upcoming} active={filters.window === 'UPCOMING'} onClick={() => toggle('window', 'UPCOMING')} />}
          {intern && <StatCard label="Upcoming internship reviews" value={c.internshipsUpcoming} active={filters.window === 'UPCOMING'} onClick={() => toggle('window', 'UPCOMING')} />}
          {!intern && <StatCard label="Due within 10 days" value={c.due10} active={filters.window === 'DUE_10'} onClick={() => toggle('window', 'DUE_10')} />}
          {!intern && <StatCard label="Due within 4 days" value={c.due4} tone="warn" active={filters.window === 'DUE_4'} onClick={() => toggle('window', 'DUE_4')} />}
          <StatCard label="Pending Department Head reviews" value={c.pendingDh} active={filters.pendingRole === 'DH'} onClick={() => toggle('pendingRole', 'DH')} testId="card-pending-dh" />
          <StatCard label="Pending CEO reviews" value={c.pendingCeo} active={filters.pendingRole === 'CEO'} onClick={() => toggle('pendingRole', 'CEO')} testId="card-pending-ceo" />
          <StatCard label="Pending HR decisions" value={c.pendingHr} tone="warn" active={filters.pendingRole === 'HR'} onClick={() => toggle('pendingRole', 'HR')} />
          <StatCard label="Overdue" value={c.overdue} tone="danger" active={filters.window === 'OVERDUE'} onClick={() => toggle('window', 'OVERDUE')} />
          {!intern && <StatCard label="Confirmed" value={c.confirmed} active={filters.window === 'CONFIRMED'} onClick={() => toggle('window', 'CONFIRMED')} />}
          <StatCard label={intern ? 'Extended internships' : 'Extended probation'} value={c.extended} active={filters.window === 'EXTENDED'} onClick={() => toggle('window', 'EXTENDED')} />
          {c.configIssues > 0 && <StatCard label="Reviewer missing" value={c.configIssues} tone="danger" />}
        </div>
      )}
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-xs font-semibold text-slate-600">Department
          <select className={`${selectCls} block mt-1`} value={filters.departmentId ?? ''} onChange={e => setFilters(f => ({ ...f, departmentId: e.target.value || undefined }))}>
            <option value="">All</option>{(data?.departments ?? []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Employee
          <input className={`${inputCls} block mt-1 w-44`} placeholder="Name or ID" value={filters.employee ?? ''} onChange={e => setFilters(f => ({ ...f, employee: e.target.value || undefined }))} /></label>
        <label className="text-xs font-semibold text-slate-600">Due from<input type="date" className={`${inputCls} block mt-1`} value={filters.from ?? ''} onChange={e => setFilters(f => ({ ...f, from: e.target.value || undefined }))} /></label>
        <label className="text-xs font-semibold text-slate-600">to<input type="date" className={`${inputCls} block mt-1`} value={filters.to ?? ''} onChange={e => setFilters(f => ({ ...f, to: e.target.value || undefined }))} /></label>
        <label className="text-xs font-semibold text-slate-600">Status
          <select className={`${selectCls} block mt-1`} value={filters.status ?? ''} onChange={e => setFilters(f => ({ ...f, status: e.target.value || undefined }))}>
            <option value="">All</option><option value="UPCOMING">Upcoming</option><option value="IN_REVIEW">In review</option><option value="AWAITING_HR_DECISION">Awaiting HR decision</option>
            <option value="OVERDUE">Overdue</option><option value="ON_HOLD">On hold</option>
            {intern ? <><option value="COMPLETED">Completed</option><option value="CONVERTED">Converted</option><option value="NOT_CONTINUED">Not continued</option></>
              : <><option value="CONFIRMING">Confirming</option><option value="APPROVED">Confirmed</option><option value="NOT_CONFIRMED">Not confirmed</option></>}
          </select></label>
        <label className="text-xs font-semibold text-slate-600">Completed
          <select className={`${selectCls} block mt-1`} value={filters.window === 'COMPLETED' ? 'yes' : ''} onChange={e => setFilters(f => ({ ...f, window: e.target.value ? 'COMPLETED' : undefined }))}>
            <option value="">Any</option><option value="yes">Completed only</option></select></label>
        {Object.values(filters).some(Boolean) && <button type="button" className={btn.secondary} onClick={() => setFilters({})}>Reset filters</button>}
      </div>
      {!data ? <Spinner /> : data.rows.length === 0 ? (
        <p className="text-sm text-slate-500 rounded-2xl border border-dashed border-slate-200 p-6 text-center">No {intern ? 'internship reviews' : 'confirmations'} match these filters.</p>
      ) : (
        <>
          <ul className="sm:hidden space-y-2" data-testid="review-list-mobile">
            {data.rows.map(r => <MobileRow key={r.id} r={r} />)}
          </ul>
          <div className="hidden sm:block overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full text-xs" data-testid="review-table">
              <thead className="bg-slate-50 text-slate-600"><tr>
                {['Employee', 'Department', 'Designation', 'Type', 'Joining', intern ? 'Completion' : 'Confirmation', 'Remaining', 'Department Head', 'CEO', 'HR', 'Status', ''].map(h =>
                  <th key={h} scope="col" className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>{data.rows.map(r => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2"><p className="font-semibold text-slate-900">{r.employeeName}</p><p className="text-slate-500">{r.employeeCode}</p>
                    {r.configIssue && <p className="text-rose-700">{configIssueText(r.configIssue)}</p>}</td>
                  <td className="px-3 py-2">{r.department ?? '–'}</td><td className="px-3 py-2">{r.designation ?? '–'}</td><td className="px-3 py-2">{r.employmentType ?? '–'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.joiningDate)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.dueDate)}{r.round > 1 && <span className="block text-slate-500">was {fmtDate(r.originalEnd)}</span>}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${r.daysLeft < 0 && r.status === 'PENDING' ? 'text-rose-700 font-semibold' : ''}`}>{daysText(r)}</td>
                  <td className="px-3 py-2"><ReportStatus status={r.dh.status} /></td><td className="px-3 py-2"><ReportStatus status={r.ceo.status} /></td>
                  <td className="px-3 py-2"><ReportStatus status={r.hr.status} /></td><td className="px-3 py-2"><OverallStatus status={r.overall} /></td>
                  <td className="px-3 py-2"><button type="button" className={btn.secondary} onClick={() => openReview(r.id)}>View details</button></td>
                </tr>))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

const MobileRow: React.FC<{ r: ReviewRow }> = ({ r }) => (
  <li>
    <button type="button" onClick={() => openReview(r.id)} className="w-full text-left rounded-2xl border border-slate-200 bg-white p-3 space-y-1">
      <div className="flex items-start justify-between gap-2"><p className="font-bold text-slate-900 text-sm">{r.employeeName}</p><OverallStatus status={r.overall} /></div>
      <p className="text-xs text-slate-500">{r.employeeCode} · {r.department ?? '–'} · {r.designation ?? '–'}</p>
      <p className="text-xs text-slate-700">Due {fmtDate(r.dueDate)} · {daysText(r)}</p>
      <div className="flex flex-wrap gap-1 text-[11px] text-slate-600">DH <ReportStatus status={r.dh.status} /> CEO <ReportStatus status={r.ceo.status} /> HR <ReportStatus status={r.hr.status} /></div>
    </button>
  </li>
);

export default EmployeeReviews;
