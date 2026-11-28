import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { hrReviewsApi } from '../../../lib/api/endpoints';
import type { ReviewQueue } from '../../../../shared/hrUpgrade';
import { btn, ErrorBanner, Spinner } from '../../team-member/pipeline/shared';
import { daysText, fmtDate, hours, openReview, OverallStatus, ReportStatus, StatCard, typeLabel } from './reviewUi';

const errText = (e: unknown, f: string) => (e instanceof Error && e.message ? e.message : f);

/**
 * Department Head and CEO dashboards > Employee Confirmation Reviews (Phases 1 and 4): the reviews assigned to me, soonest first, with a short
 * attendance line and my report's status. "Submit review" opens the review with my evaluation form. The database lists only my assignments.
 */
export const MyReviews: React.FC<{ title?: string; showSummary?: boolean }> = ({ title = 'Employee Confirmation Reviews', showSummary = false }) => {
  const [q, setQ] = useState<ReviewQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => hrReviewsApi.mine().then(x => { setQ(x); setError(null); }, e => setError(errText(e, 'Your reviews could not be loaded.'))), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const on = () => void load();
    window.addEventListener('crm:hr-review-changed', on);
    return () => window.removeEventListener('crm:hr-review-changed', on);
  }, [load]);
  const rows = q?.rows ?? [];
  const pending = rows.filter(r => (r.status === 'PENDING' || r.status === 'ON_HOLD') && r.myStatus !== 'SUBMITTED');
  return (
    <section className="space-y-3" aria-label={title} data-testid="my-reviews">
      <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-1.5"><ClipboardCheck className="w-4 h-4 text-indigo-600" aria-hidden />{title}</h2>
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {!q ? <Spinner /> : (
        <>
          {showSummary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatCard label="Upcoming confirmations" value={rows.filter(r => r.cycleType === 'PROBATION' && r.status === 'PENDING' && r.daysLeft >= 0).length} />
              <StatCard label="Upcoming internship completions" value={rows.filter(r => r.cycleType === 'INTERNSHIP' && r.status === 'PENDING' && r.daysLeft >= 0).length} />
              <StatCard label="Pending my review" value={pending.length} tone={pending.length ? 'warn' : 'default'} />
              <StatCard label="Overdue" value={rows.filter(r => r.myStatus === 'OVERDUE').length} tone="danger" />
            </div>
          )}
          {rows.length === 0 ? <p className="text-sm text-slate-500 rounded-2xl border border-dashed border-slate-200 p-4 text-center">No confirmation or internship reviews are assigned to you.</p> : (
            <ul className="space-y-2">
              {rows.map(r => (
                <li key={r.id} className="rounded-2xl border border-slate-200 bg-white p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-bold text-slate-900 text-sm">{r.employeeName} <span className="font-normal text-slate-500">· {r.designation ?? '–'} · {typeLabel(r.cycleType)}</span></p>
                    <p className="text-xs text-slate-600">Joined {fmtDate(r.joiningDate)} · due {fmtDate(r.dueDate)} · {daysText(r)}</p>
                    {r.attendance && <p className="text-xs text-slate-500">Attendance: {r.attendance.presentDays}/{r.attendance.workingDays} days present, {r.attendance.lateArrivals} late, {r.attendance.approvedLeaveDays} leave, {hours(r.attendance.netMinutes)} worked</p>}
                    <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-600">My report <ReportStatus status={r.myStatus ?? 'NOT_STARTED'} /> <OverallStatus status={r.overall} /></div>
                  </div>
                  <button type="button" className={r.myStatus === 'SUBMITTED' || (r.status !== 'PENDING' && r.status !== 'ON_HOLD') ? btn.secondary : btn.primary} onClick={() => openReview(r.id)}>
                    {r.myStatus === 'SUBMITTED' || (r.status !== 'PENDING' && r.status !== 'ON_HOLD') ? 'View' : r.myStatus === 'DRAFT' || r.myStatus === 'RETURNED' ? 'Continue review' : 'Submit review'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
};

export default MyReviews;
