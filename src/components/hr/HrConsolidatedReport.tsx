import React, { useCallback, useEffect, useState } from 'react';
import { Send, Save } from 'lucide-react';
import type { ConsolidatedDepartment, HrConsolidated } from '../../../shared/contracts';
import { PERFORMANCE_STAGE_LABEL, WEEKLY_STATUS_LABEL } from '../../../shared/reportFields';
import { ApiError } from '../../lib/api/client';
import { hrReviewsApi } from '../../lib/api/reportPerformance';
import { btn, Card, Dialog, ErrorBanner, inputCls, Spinner } from '../team-member/pipeline/shared';
import { timeLabel } from '../reports/reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

const DeptLine: React.FC<{ d: ConsolidatedDepartment; tone: 'good' | 'warn' }> = ({ d, tone }) => (
  <li className={`rounded-xl border px-3 py-2 text-sm ${tone === 'good' ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-semibold text-slate-900">{d.department}</span>
      <span className="text-xs text-slate-600">{d.reviews.submitted}/{d.reviews.expected} reviews submitted{d.reviews.drafts ? `, ${d.reviews.drafts} draft` : ''} - {WEEKLY_STATUS_LABEL[d.status]}{d.alreadySubmitted ? ' (already with the Super Admin)' : ''}</span>
    </div>
    {d.openApprovals || d.openRevisions ? <p className="text-xs text-amber-900 mt-1">Outstanding in the department that week: {d.openApprovals} report{d.openApprovals === 1 ? '' : 's'} waiting for an approval, {d.openRevisions} sent back for a revision.</p> : null}
    {d.missingReviews.length > 0 ? (
      <p className="text-xs text-slate-700 mt-1">Missing reviews: {d.missingReviews.map(m => `${m.name}${m.draft ? ' (draft)' : ''}`).join(', ')}</p>
    ) : null}
  </li>
);

/**
 * The consolidated company performance report for a week: what is complete (every Team Lead and Team Member reviewed), what is still pending
 * and which departments' weekly reports have not reached HR. Pending sections stay unfinished and are never marked as finalised. HR saves
 * a draft or submits the completed departments to the Super Admin.
 */
export const HrConsolidatedReport: React.FC<{ week: string; reloadKey: number }> = ({ week, reloadKey }) => {
  const [data, setData] = useState<HrConsolidated | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'' | 'draft' | 'submit'>('');
  const [done, setDone] = useState('');
  const [preview, setPreview] = useState(false);

  const load = useCallback(() => {
    hrReviewsApi.consolidated(week).then(d => { setError(''); setData(d); setNote(n => n || d.report?.note || ''); }, e => setError(errText(e)));
  }, [week]);
  useEffect(() => { setData(null); setNote(''); setDone(''); }, [week]);
  useEffect(load, [load, reloadKey]);

  const run = async (submit: boolean) => {
    setBusy(submit ? 'submit' : 'draft');
    setError('');
    setDone('');
    try {
      const r = await hrReviewsApi.saveConsolidated({ weekStart: week, note: note.trim() || undefined, submit });
      setDone(submit ? `Submitted: ${r.submittedDepartments} department${r.submittedDepartments === 1 ? '' : 's'} sent to the Super Admin.` : 'Draft saved.');
      setPreview(false);
      load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
    }
  };

  const r = data?.readiness;
  const sendable = r ? r.complete.filter(d => !d.alreadySubmitted).length : 0;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Consolidated Performance Report</h2>
          <p className="text-xs text-slate-500">The weekly packages, the individual reviews and the figures, for the Super Admin.</p>
        </div>
        {data ? <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200" data-testid="performance-stage">{PERFORMANCE_STAGE_LABEL[data.stage]}</span> : null}
      </div>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {!data && !error ? <Spinner /> : null}
      {data && r ? (
        <div className="space-y-4">
          <section aria-label="Complete departments">
            <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-700 mb-2">Complete ({r.complete.length})</h3>
            {r.complete.length === 0 ? <p className="text-xs text-slate-500">No department has every review submitted yet.</p> : <ul className="space-y-2">{r.complete.map(d => <DeptLine key={d.packageId} d={d} tone="good" />)}</ul>}
          </section>
          <section aria-label="Departments with pending reviews">
            <h3 className="text-xs font-bold uppercase tracking-wide text-amber-700 mb-2">Pending ({r.pending.length})</h3>
            {r.pending.length === 0 ? <p className="text-xs text-slate-500">Nothing pending.</p> : <ul className="space-y-2">{r.pending.map(d => <DeptLine key={d.packageId} d={d} tone="warn" />)}</ul>}
          </section>
          <section aria-label="Departments whose weekly report has not reached HR">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600 mb-2">Weekly report not received ({r.notReceived.length})</h3>
            {r.notReceived.length === 0 ? <p className="text-xs text-slate-500">Every department's weekly report was approved and sent to HR.</p> : (
              <ul className="space-y-1">{r.notReceived.map(d => <li key={d.departmentId} className="rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-700"><b>{d.department}</b> - {d.status === 'NOT_SUBMITTED' ? 'no weekly report yet' : WEEKLY_STATUS_LABEL[d.status as keyof typeof WEEKLY_STATUS_LABEL] ?? d.status}</li>)}</ul>
            )}
          </section>
          <div>
            <label htmlFor="consolidated-note" className="block text-xs font-semibold text-slate-700 mb-1">Note to the Super Admin</label>
            <textarea id="consolidated-note" className={`${inputCls} min-h-20`} value={note} maxLength={4000} disabled={!!busy} onChange={e => setNote(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btn.secondary} onClick={() => void run(false)} disabled={!!busy}><Save className="w-3.5 h-3.5" aria-hidden="true" /> {busy === 'draft' ? 'Saving...' : 'Save as draft'}</button>
            <button type="button" className={btn.primary} onClick={() => setPreview(true)} disabled={!!busy || sendable === 0}><Send className="w-3.5 h-3.5" aria-hidden="true" /> Submit Consolidated Performance Report to Superadmin</button>
            {sendable === 0 ? <span className="text-xs text-slate-500">Nothing complete is waiting to be sent.</span> : null}
            {data.report?.submittedAt ? <span className="text-xs text-slate-500">Last submitted {timeLabel(data.report.submittedAt)} by {data.report.submittedBy} (revision {data.report.revision})</span> : null}
            {done ? <span role="status" className="text-xs text-emerald-700">{done}</span> : null}
          </div>
        </div>
      ) : null}
      {preview && r ? (
        <Dialog title="Review before submitting" description="Check what goes to the Super Admin." onClose={() => setPreview(false)}>
          <div className="space-y-3 text-sm" data-testid="consolidated-preview">
            <p><b>{sendable}</b> department{sendable === 1 ? '' : 's'} with every review submitted will be sent: {r.complete.filter(d => !d.alreadySubmitted).map(d => d.department).join(', ')}.</p>
            {r.pending.length > 0 ? <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900"><b>Not included (reviews pending):</b> {r.pending.map(d => d.department).join(', ')}. They stay with HR and are not marked as finalised.</p> : null}
            {r.notReceived.length > 0 ? <p className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-slate-700"><b>Weekly report not received:</b> {r.notReceived.map(d => d.department).join(', ')}.</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" className={btn.secondary} onClick={() => setPreview(false)}>Cancel</button>
              <button type="button" className={btn.primary} onClick={() => void run(true)} disabled={!!busy}>{busy === 'submit' ? 'Submitting...' : 'Submit to Superadmin'}</button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </Card>
  );
};
